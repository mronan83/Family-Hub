#!/usr/bin/env bash
# [NFR-14] Tests for scripts/db-migrate.sh on native Postgres (CI database job; no Docker). Each case
# uses a throwaway database and a directory of small migrations. Uses the libpq variables
# (PGHOST, PGPORT, PGUSER, PGPASSWORD) like scripts/db-test.sh.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="migrate_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
fresh() {
  "${admin[@]}" -c "drop database if exists $db with (force)" -c "create database $db" >/dev/null
  rm -rf "$work/m" && mkdir -p "$work/m"
}
migration() { printf '%s\n' "$2" > "$work/m/$1.sql"; }
run() { SUPABASE_DB_URL=$(url) MIGRATIONS_DIR="$work/m" bash "$root/scripts/db-migrate.sh" "$@" > "$work/out" 2>&1; }
q() { psql "$(url)" -X -A -t -q -c "$1"; }
check() { # name, condition result
  if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1"; sed 's/^/#   /' "$work/out"; failures=$((failures + 1)); fi
}
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

fresh
migration 20260101000000_one "create table one (id int);"
migration 20260102000000_two "create table two (id int);"
run; rc=$?
check "[NFR-14] applies every pending migration and records each" "$(is "$rc:$(q "select string_agg(version || ' ' || name, ',' order by version) from supabase_migrations.schema_migrations")" "0:20260101000000 one,20260102000000 two")"
run; rc=$?
check "[NFR-14] a second run applies nothing" "$(is "$rc:$(grep -c '^applied' "$work/out")" "0:0")"

q "insert into supabase_migrations.schema_migrations (version, name) values ('20260103000000', 'from_an_open_pr')" >/dev/null
run; rc=$?
check "[NFR-14] a migration only in the database (an open PR's preview) is reported, not fatal" \
  "$(is "$rc:$(grep -c 'not in this commit.*20260103000000' "$work/out")" "0:1")"

migration 20260101500000_older "create table older (id int);"
run; rc=$?
check "[NFR-14] a pending migration older than the newest applied one still runs" "$(is "$rc:$(q "select to_regclass('older') is not null")" "0:t")"

migration 20260104000000_broken "create table half (id int); select no_such_function();"
run; rc=$?
check "[NFR-14] a failing migration stops the run and leaves neither its changes nor its history row" \
  "$(is "$([ $rc -ne 0 ] && echo failed):$(q "select to_regclass('half') is null")$(q "select count(*) from supabase_migrations.schema_migrations where version = '20260104000000'")" "failed:t0")"
rm "$work/m/20260104000000_broken.sql"

migration 20260105000000_drop_two "-- a comment that says drop table is ignored
drop table two;"
migration 20260105000001_three "create table three (id int);"
run --additive-only; rc=$?
check "[NFR-14] --additive-only applies none when any pending migration removes something" \
  "$(is "$rc:$(q "select to_regclass('two') is not null and to_regclass('three') is null")" "0:t")"
rm "$work/m/20260105000000_drop_two.sql"
migration 20260105000002_note "-- rename to is only mentioned in a comment
create table four (id int);"
run --additive-only; rc=$?
check "[NFR-14] --additive-only applies additive migrations (comments are ignored)" \
  "$(is "$rc:$(q "select to_regclass('three') is not null and to_regclass('four') is not null")" "0:t")"

migration 20260105000003_fn_deletes "create function clear_three() returns void language sql as \$fn\$
  delete from three;
\$fn\$;
create table five (id int);"
run --additive-only; rc=$?
check "[NFR-14] --additive-only applies a function whose body deletes (it runs when called, not now)" \
  "$(is "$rc:$(q "select to_regclass('five') is not null")" "0:t")"
migration 20260105000004_do_deletes "do \$\$ begin delete from three; end \$\$;
create table six (id int);"
run --additive-only; rc=$?
check "[NFR-14] --additive-only still holds back a DO block that deletes (it runs when applied)" \
  "$(is "$rc:$(q "select to_regclass('six') is null")" "0:t")"
migration 20260105000005_fn_then_delete "create function noop() returns int language sql as \$\$ select 1 \$\$;
delete from three;"
run --additive-only; rc=$?
check "[NFR-14] --additive-only holds back a delete that follows a function body" \
  "$(is "$rc:$(grep -c '20260105000005_fn_then_delete' "$work/out")" "0:1")"

fresh
migration 20260101000000_own_tx "begin;
create table x (id int);
commit;"
run; rc=$?
check "[NFR-14] a migration that controls its own transaction is refused" "$(is "$([ $rc -ne 0 ] && echo refused):$(grep -c 'controls its own transaction' "$work/out")" "refused:1")"

fresh
migration 20260101000000_Bad-Name "select 1;"
run; rc=$?
check "[NFR-14] a badly named migration file is refused" "$(is "$([ $rc -ne 0 ] && echo refused):$(grep -c 'file name must be' "$work/out")" "refused:1")"

fresh
migration 20260101000000_fn "create function f() returns int language plpgsql as \$\$
begin
  return 1;
end;
\$\$;"
run; rc=$?
check "[NFR-14] PL/pgSQL begin/end blocks are not mistaken for transaction control" "$(is "$rc:$(q "select f()")" "0:1")"

echo "# $failures failure(s)"
[ "$failures" -eq 0 ]
