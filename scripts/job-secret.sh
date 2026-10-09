#!/usr/bin/env bash
# Creates or rotates the job secret (01 §5.6, D-38), run by the job-secret workflow. pg_cron sends the
# secret to the job endpoints through pg_net; they refuse calls without it. It is generated here and
# written straight to Vercel's production environment and to Supabase Vault, and never printed:
# nobody sees or pastes it.
#
# Order matters: Vercel first, then a production deploy so the app holds the new secret, then a check
# that production accepts it, and only then Vault, so pg_cron switches to it once the app has. Last,
# a heartbeat through pg_cron's own path proves the whole chain. Running it again is always safe.
#
# Needs SUPABASE_DB_URL, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, PRODUCTION_URL, GH_TOKEN
# (actions: write), psql 15+, gh, jq, openssl.
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
for v in SUPABASE_DB_URL VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID PRODUCTION_URL GH_TOKEN; do
  [ -n "${!v:-}" ] || fail "missing $v (docs/01-technical-architecture.md §9.8)"
done
db() { psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }
umask 077

secret=$(openssl rand -hex 32)
echo "::add-mask::$secret"

echo "1/5 Vercel: JOB_SIGNING_SECRET for Production (sensitive)"
response="$RUNNER_TEMP/vercel-env.json"
status=$(jq -n --arg v "$secret" '[{key: "JOB_SIGNING_SECRET", value: $v, type: "sensitive", target: ["production"],
    comment: "pg_cron job calls (01 §5.6); set by the job-secret workflow"}]' \
  | curl -sS -o "$response" -w '%{http_code}' -X POST \
      -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' --data @- \
      "https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env?upsert=true&teamId=$VERCEL_ORG_ID")
problem=$(jq -r '(.error.message // empty), (.failed // [] | .[] | .error.message // .error.code // "failed")' "$response" 2>/dev/null || true)
rm -f "$response"
{ [ "$status" = 200 ] || [ "$status" = 201 ]; } && [ -z "$problem" ] \
  || fail "Vercel did not store the secret (HTTP $status): ${problem:-no detail}"

echo "2/5 Deploy production so the app holds it"
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run deploy.yml --ref main
run=""
for _ in $(seq 1 30); do
  run=$(gh run list --workflow deploy.yml --event workflow_dispatch --limit 5 --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$since\")][0].databaseId // empty")
  [ -n "$run" ] && break
  sleep 5
done
[ -n "$run" ] || fail "the production deploy did not start"
gh run watch "$run" --exit-status --interval 15 >/dev/null \
  || fail "the production deploy (run $run) failed; Vault still holds the old secret, so jobs keep working once production is back; run this workflow again"

echo "3/5 Production accepts the new secret"
header="$RUNNER_TEMP/job-auth"
printf 'Authorization: Bearer %s\n' "$secret" > "$header"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H @"$header" -H 'Content-Type: application/json' \
  -d '{}' "$PRODUCTION_URL/api/jobs/heartbeat" || true)
rm -f "$header"
[ "$code" = 202 ] || fail "production answered $code to the new secret (expected 202); Vault is unchanged"

echo "4/5 Vault: job_signing_secret and job_base_url"
JOB_SECRET="$secret" JOB_BASE_URL="$PRODUCTION_URL" db --single-transaction >/dev/null <<'SQL'
\getenv secret JOB_SECRET
\getenv base JOB_BASE_URL
select vault.update_secret(id, :'secret') from vault.secrets where name = 'job_signing_secret';
select vault.create_secret(:'secret', 'job_signing_secret', 'Bearer secret for /api/jobs/* (01 §5.6); set by the job-secret workflow')
 where not exists (select from vault.secrets where name = 'job_signing_secret');
select vault.update_secret(id, :'base') from vault.secrets where name = 'job_base_url';
select vault.create_secret(:'base', 'job_base_url', 'Address job calls go to (01 §5.6); set by the job-secret workflow')
 where not exists (select from vault.secrets where name = 'job_base_url');
SQL

echo "5/5 A heartbeat through pg_cron's path: private.call_job, pg_net, the endpoint, job_run"
start=$(db -c "select now()")
[ -n "$(db -c "select private.call_job('heartbeat')")" ] || fail "call_job is still off after writing Vault"
for _ in $(seq 1 24); do
  done_runs=$(db -c "select count(*) from public.job_run where job_type = 'heartbeat' and started_at >= '$start' and status <> 'running'")
  [ "$done_runs" -gt 0 ] && break
  sleep 5
done
db -F ' | ' -c "select household_id, status, stats, coalesce(error, '') from public.job_run
                 where job_type = 'heartbeat' and started_at >= '$start' order by started_at"
[ "$(db -c "select count(*) from public.job_run where job_type = 'heartbeat' and started_at >= '$start' and status = 'ok'")" -gt 0 ] \
  || fail "the heartbeat did not finish ok within 2 minutes"
echo "Job secret in place; pg_cron jobs run."
