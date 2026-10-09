#!/usr/bin/env bash
# [ACC-01] Tests for scripts/setup-code.sh on native Postgres (CI database job; no Docker), on a
# throwaway database with the Supabase compatibility bootstrap and every migration.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="setup_code_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
q() { psql "$(url)" -X -A -t -q -c "$1"; }
check() { # name, condition result
  if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1 ($2)"; sed 's/^/#   /' "$work/log"; failures=$((failures + 1)); fi
}
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

"${admin[@]}" -c "create database $db" >/dev/null
"${admin[@]}" -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
for f in "$root"/supabase/tests/bootstrap/*.sql; do psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
SUPABASE_DB_URL=$(url) bash "$root/scripts/db-migrate.sh" >/dev/null

SUPABASE_DB_URL=$(url) SETUP_CODE_OUT="$work/summary" bash "$root/scripts/setup-code.sh" > "$work/log" 2>&1; rc=$?
code=$(grep -oE '[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}' "$work/summary" | head -1)
check "[ACC-01] issues a code in the form XXXX-XXXX-XXXX" "$(is "$rc:${#code}" "0:14")"
check "[ACC-01] the code is written to the summary only, never to the log" "$(is "$(grep -c "${code:-none}" "$work/log")" "0")"
check "[ACC-01] only the code's hash is stored, for 24 hours" \
  "$(is "$(q "select count(*) from private.household_setup_code
              where code_hash = private.code_hash('$code') and code_hash <> '$code'
                and expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'")" "1")"
check "[ACC-01] the code works as typed, in any case" \
  "$(is "$(q "set role service_role; select public.setup_code_usable(lower('$code'))")" "t")"

[ "$failures" -eq 0 ] && echo "setup-code: all checks passed" || { echo "setup-code: $failures check(s) failed"; exit 1; }
