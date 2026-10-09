#!/usr/bin/env bash
# [NFR-08] Tests for scripts/usage-sample.sh on native Postgres (CI database job; no Docker), with a
# saved billing response instead of the Vercel API.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="usage_sample_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
q() { psql "$(url)" -X -A -t -q -c "$1"; }
check() { if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1 ($2)"; sed 's/^/#   /' "$work/log"; failures=$((failures + 1)); fi; }
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

"${admin[@]}" -c "create database $db" >/dev/null
"${admin[@]}" -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
for f in "$root"/supabase/tests/bootstrap/*.sql; do psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
SUPABASE_DB_URL=$(url) bash "$root/scripts/db-migrate.sh" >/dev/null

cat > "$work/charges.jsonl" <<'JSONL'
{"ServiceName":"Function Invocations","ConsumedQuantity":1200,"ConsumedUnit":"Invocations","Tags":{"ProjectId":"prj_family"}}
{"ServiceName":"Function Invocations","ConsumedQuantity":300,"ConsumedUnit":"Invocations","Tags":{"ProjectId":"prj_other"}}
{"ServiceName":"Fluid Active CPU","ConsumedQuantity":0.125,"ConsumedUnit":"hour","Tags":{"ProjectId":"prj_family"}}
{"ServiceName":"Fluid Active CPU","ConsumedQuantity":0.5,"ConsumedUnit":"hour","Tags":{}}
{"ServiceName":"Build CPU Minutes","ConsumedQuantity":99,"ConsumedUnit":"Minutes","Tags":{"ProjectId":"prj_family"}}
not json at all
JSONL
q "insert into private.usage_sample (taken_at, source, period_start, service, unit, account_quantity, project_quantity)
   values (now() - interval '91 days', 'vercel', now()::date, 'Old', 'u', 1, 1)" >/dev/null

env SUPABASE_DB_URL="$(url)" VERCEL_ORG_ID=team_x VERCEL_PROJECT_ID=prj_family USAGE_JSONL_FILE="$work/charges.jsonl" \
  GITHUB_STEP_SUMMARY="$work/summary" bash "$root/scripts/usage-sample.sh" > "$work/log" 2>&1; rc=$?
check "[NFR-08] reads a billing response and exits cleanly" "$(is "$rc" 0)"
check "[NFR-08] keeps the services with Hobby limits, for the account and for FamilyWise" \
  "$(is "$(q "select string_agg(service || ':' || unit || ':' || account_quantity::float8 || ':' || project_quantity::float8, ',' order by service)
              from private.usage_sample where service <> 'Old'")" \
        "Fluid Active CPU:hour:0.625:0.125,Function Invocations:Invocations:1500:1200")"
check "[NFR-08] one reading shares one time and the 30-day window it covers" \
  "$(is "$(q "select count(distinct taken_at) || ':' || bool_and(period_start = (now() - interval '30 days')::date)
              from private.usage_sample where service <> 'Old'")" "1:true")"
check "[NFR-08] readings older than 90 days are removed" "$(is "$(q "select count(*) from private.usage_sample where service = 'Old'")" 0)"
check "[NFR-08] the reading goes to the run summary" "$(is "$(grep -c '| Function Invocations | Invocations | 1500.000000 | 1200.000000 |' "$work/summary")" 1)"

: > "$work/empty.jsonl"
env SUPABASE_DB_URL="$(url)" VERCEL_ORG_ID=team_x VERCEL_PROJECT_ID=prj_family USAGE_JSONL_FILE="$work/empty.jsonl" \
  bash "$root/scripts/usage-sample.sh" > "$work/log" 2>&1; rc=$?
check "[NFR-08] a response without the tracked services fails the run, so a stale reading shows" "$(is "$rc" 1)"

[ "$failures" -eq 0 ] && echo "usage-sample: all checks passed" || { echo "usage-sample: $failures check(s) failed"; exit 1; }
