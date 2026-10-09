#!/usr/bin/env bash
# Runs one job now through pg_cron's own path and reports its runs and health (job-run workflow,
# 01 §5.6). Exits non-zero if a run did not end as expected: ok or skipped normally, error when
# FORCE_FAILURE=true. Needs SUPABASE_DB_URL, JOB, FORCE_FAILURE; psql 15+.
set -euo pipefail

fail() { echo "::error::$*"; exit 1; }
: "${SUPABASE_DB_URL:?}" "${JOB:?}"
[[ "$JOB" =~ ^[a-z][a-z0-9_]*$ ]] || fail "job must be a snake_case name from schedule.json"
FORCE_FAILURE=${FORCE_FAILURE:-false}
[[ "$FORCE_FAILURE" =~ ^(true|false)$ ]] || fail "force_failure must be true or false"
export JOB FORCE_FAILURE
db() { psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }

start=$(db -c "select now()")
call=$(db <<'SQL'
\getenv job JOB
\getenv force FORCE_FAILURE
select private.call_job(:'job', jsonb_build_object('force_failure', :'force'::boolean));
SQL
)
[ -n "$call" ] || fail "jobs are off: run the job-secret workflow first"

for _ in $(seq 1 24); do
  pending=$(db -c "select count(*) from public.job_run where job_type = '$JOB' and started_at >= '$start' and status = 'running'")
  total=$(db -c "select count(*) from public.job_run where job_type = '$JOB' and started_at >= '$start'")
  [ "$total" -gt 0 ] && [ "$pending" -eq 0 ] && break
  sleep 5
done
[ "$total" -gt 0 ] || fail "no run started within 2 minutes (is $JOB in schedule.json and deployed?)"

echo "Runs (household | status | stats | error):"
db -F ' | ' -c "select household_id, status, stats, coalesce(error, '') from public.job_run
                 where job_type = '$JOB' and started_at >= '$start' order by household_id"
echo "Health (household | state | last ok | message):"
db -F ' | ' -c "select r.household_id, h.state, coalesce(h.last_ok_at::text, '-'), coalesce(h.message, '')
                  from (select distinct household_id from public.job_run where job_type = '$JOB' and started_at >= '$start') r,
                       public.job_health(r.household_id) h
                 where h.job_type = '$JOB' order by r.household_id"

expected="status in ('ok', 'skipped')"
[ "$FORCE_FAILURE" = true ] && expected="status = 'error'"
unexpected=$(db -c "select count(*) from public.job_run where job_type = '$JOB' and started_at >= '$start' and not ($expected)")
[ "$unexpected" -eq 0 ] || fail "$unexpected run(s) did not end as expected ($expected)"
echo "$JOB ran as expected."
