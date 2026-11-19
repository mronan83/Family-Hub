#!/usr/bin/env bash
# [NFR-12] Tests for scripts/db-health.sh on native Postgres (CI database job; no Docker), on the demo
# family with a board paired: the report runs read only, has every section, times the board's read
# as the board, and names no member, item or household.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="db_health_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
q() { psql "$(url)" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1 ($2)"; sed 's/^/#   /' "$work/log"; failures=$((failures + 1)); fi; }
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

"${admin[@]}" -c "create database $db" >/dev/null
"${admin[@]}" -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
for f in "$root"/supabase/tests/bootstrap/*.sql; do psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
SUPABASE_DB_URL=$(url) bash "$root/scripts/db-migrate.sh" >/dev/null
psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase/seed.sql" >/dev/null 2>&1
# The demo family's board.
q "insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000000b1', null);
   insert into public.device (household_id, name, auth_user_id)
   select id, 'Kitchen', 'd0000000-0000-4000-8000-0000000000b1' from public.household limit 1;" >/dev/null
before=$(q "select count(*) from public.device")

SUPABASE_DB_URL="$(url)" READS=3 bash "$root/scripts/db-health.sh" > "$work/log" 2>&1; rc=$?
check "[NFR-12-h] runs and exits cleanly" "$(is "$rc" 0)"
for section in 'Server' 'Statement timeouts per role' 'Cache and work' 'The largest relations' \
               'The system catalogs' 'Rows that grow with use' 'Connections now' 'Replication slots' \
               'Logical decoding' 'Disk reads and writes' 'A trivial query' "The board's read"; do
  check "[NFR-12-h] has the section \"$section\"" "$(grep -qF "## $section" "$work/log" && echo ok || echo missing)"
done
check "[NFR-12-h] times the board's snapshot as the board, numbered" \
  "$(grep -qE '^board 1 \| board_snapshot ms \| min [0-9.]+ \| median [0-9.]+ \| max [0-9.]+$' "$work/log" && echo ok || echo missing)"
check "[NFR-12-h] ... and its grocery list" \
  "$(grep -qE '^board 1 \| board_groceries ms \| min ' "$work/log" && echo ok || echo missing)"
check "[NFR-12-h] reports no error" "$(is "$(grep -ciE 'error|permission denied' "$work/log")" 0)"
check "[NFR-12-h] the demo family has names to look for" "$(is "$(q "select count(*) > 3 from public.member")" t)"
named=$(q "select display_name from public.member union select title from public.chore union select name from public.household" |
        while IFS= read -r name; do [ -n "$name" ] && grep -qiF -- "$name" "$work/log" && echo "$name"; done)
check "[NFR-12-h] names no member, item or household" "$(is "$named" '')"
check "[NFR-12-h] names no id" "$(is "$(grep -cE '[0-9a-f]{8}-[0-9a-f]{4}-' "$work/log")" 0)"
check "[NFR-12-h] changes nothing" "$(is "$(q "select count(*) from public.device")" "$before")"
check "[NFR-12-h] reads only: a session it opens refuses a write" \
  "$(is "$(PGOPTIONS='-c default_transaction_read_only=on' psql "$(url)" -X -A -t -q -c "create table t (x int)" 2>&1 | grep -c 'read-only transaction')" 1)"
check "[NFR-12-h] ... and the script opens its sessions that way" \
  "$(grep -q "export PGOPTIONS='-c default_transaction_read_only=on'" "$root/scripts/db-health.sh" && echo ok || echo 'not read only')"

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
echo "db-health: all passed"
