#!/usr/bin/env bash
# [NFR-14][ACC-02] Tests for scripts/preview-db.sh on native Postgres (CI database job; no Docker):
# the guard that keeps it to the test database, the reset, migrations, the demo family and the demo
# sign-ins' passwords, on a throwaway database with the
# Supabase compatibility bootstrap. Uses the libpq variables like scripts/db-test.sh.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
admin=(psql -X -q -v ON_ERROR_STOP=1 -d "${PGDATABASE_ADMIN:-postgres}")
work=$(mktemp -d)
db="preview_db_test_$$"
failures=0
trap '"${admin[@]}" -c "drop database if exists $db with (force)" >/dev/null 2>&1; rm -rf "$work"' EXIT

url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"; }
run() { SUPABASE_DB_URL=$(url) bash "$root/scripts/preview-db.sh" > "$work/out" 2>&1; }
q() { psql "$(url)" -X -A -t -q -c "$1"; }
check() { # name, condition result
  if [ "$2" = ok ]; then echo "ok - $1"; else echo "not ok - $1"; sed 's/^/#   /' "$work/out"; failures=$((failures + 1)); fi
}
is() { [ "$1" = "$2" ] && echo ok || echo "got '$1', expected '$2'"; }

"${admin[@]}" -c "create database $db" >/dev/null
"${admin[@]}" -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
for f in "$root"/supabase/tests/bootstrap/*.sql; do psql "$(url)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done

(unset VERCEL_AUTOMATION_BYPASS_SECRET; run); rc=$?
check "[ACC-02] refuses to run without the bypass secret, before touching the database" \
  "$(is "$([ $rc -ne 0 ] && echo failed):$(q "select to_regclass('supabase_migrations.schema_migrations') is null")" "failed:t")"

export VERCEL_AUTOMATION_BYPASS_SECRET=test-secret
# [D-85] Only the test project is ever reset: any other remote database is refused before a
# connection is made (the host below does not exist, so reaching it would fail differently).
guard() { SUPABASE_DB_URL="$1" TEST_PROJECT_REF="${2-}" bash "$root/scripts/preview-db.sh" > "$work/out" 2>&1; }
guard "postgresql://postgres.prodref1234:pw@db.invalid:5432/postgres" testref5678; rc=$?
check "[D-85] refuses another project's database (production's) before connecting" \
  "$(is "$rc:$(grep -c 'not the test database' "$work/out")" "1:1")"
guard "postgresql://postgres.jpzwmibrsvsxcimbxtmb:pw@db.invalid:5432/postgres" jpzwmibrsvsxcimbxtmb; rc=$?
check "[D-85] refuses production's database by name, even if it is named as the test project" \
  "$(is "$rc:$(grep -c 'this is the production database' "$work/out")" "1:1")"
guard "postgresql://postgres.testref5678:p@ss:w@rd@db.invalid:5432/postgres"; rc=$?
check "[D-85] refuses a remote database when the test project is not named" \
  "$(is "$rc:$(grep -c 'TEST_PROJECT_REF is required' "$work/out")" "1:1")"

run; rc=$?
check "[NFR-14] applies the migrations and resets the demo family" \
  "$(is "$rc:$(q "select count(*) from public.member where household_id = '0de00000-0000-4000-8000-000000000001'")" "0:4")"
check "[NFR-07][D-85] lists the jobs System Health reads, and schedules none" \
  "$(is "$(q "select (select count(*) > 0 from private.job_schedule where job_type = 'heartbeat')::text")" "true")"

# The same vector is asserted for the app's derivation (apps/web/lib/auth/demo.test.ts).
vector=045626f96e2913b275eee7347abe26d196002e0fec0d237641b91979c093c14d
check "[ACC-02] each demo sign-in's password is derived from the bypass secret" \
  "$(is "$(q "select string_agg(split_part(email, '@', 1), ',' order by email) from auth.users
              where email like '%@demo.familywise.invalid'
                and encrypted_password = extensions.crypt(encode(extensions.hmac('familywise demo sign-in ' || email, 'test-secret', 'sha256'), 'hex'), encrypted_password)")" "alex,jordan,riley,sam")"
check "[ACC-02] the derivation matches the app's test vector" \
  "$(is "$(q "select encrypted_password = extensions.crypt('$vector', encrypted_password) from auth.users where email = 'alex@demo.familywise.invalid'")" "t")"
check "[ACC-02] passwords are stored as bcrypt hashes, never in clear" \
  "$(is "$(q "select count(*) from auth.users where email like '%@demo.familywise.invalid' and encrypted_password like '\$2a\$10\$%'")" "4")"

# Leftovers from a run before: an extra household, a sign-in, a board paired to it (a device's
# sign-in is referenced from public.device) and a migration only that run had.
q "insert into public.household (id, name, timezone) values ('99999999-0000-4000-8000-000000000001', 'Leftover', 'UTC');
   insert into auth.users (id, email) values ('99999999-0000-4000-8000-000000000002', 'left@example.com');
   insert into public.device (household_id, name, auth_user_id) values
     ('99999999-0000-4000-8000-000000000001', 'Leftover board', '99999999-0000-4000-8000-000000000002');
   insert into supabase_migrations.schema_migrations (version, name) values ('29990101000000', 'another_branch');" >/dev/null
run; rc=$?
check "[D-85] a second run starts from an empty database: nothing a run before left behind stays" \
  "$(is "$rc:$(q "select (select count(*) from public.household where name = 'Leftover')
                     + (select count(*) from auth.users where email = 'left@example.com')
                     + (select count(*) from supabase_migrations.schema_migrations where version = '29990101000000')")" "0:0")"
check "[NFR-14] a second run resets again" \
  "$(is "$rc:$(q "select count(*) from auth.users where email like '%@demo.familywise.invalid' and encrypted_password is not null")" "0:4")"
check "[ACC-02] the secret is not printed" "$(is "$(grep -c 'test-secret\|045626f9' "$work/out")" "0")"

# A session left idle in a transaction, holding the demo household's row: the reset ends it rather
# than waiting behind it (e2e runs 238 to 242), logs who waited on it, and later sessions end
# themselves after 60 s.
(echo "begin; select id from public.household where id = '0de00000-0000-4000-8000-000000000001' for update;"; sleep 300) |
  psql "$(url)" -X -q > /dev/null 2>&1 &
holder=$!
for _ in $(seq 50); do
  [ "$(q "select count(*) from pg_stat_activity where datname = '$db' and state = 'idle in transaction'")" = 1 ] && break
  sleep 0.2
done
# A second session waits on the holder's row: the log names who waits on whom before the holder is ended.
psql "$(url)" -X -q -c "update public.household set name = name where id = '0de00000-0000-4000-8000-000000000001'" > /dev/null 2>&1 &
waiter=$!
for _ in $(seq 50); do
  [ "$(q "select count(*) from pg_stat_activity where datname = '$db' and wait_event_type = 'Lock'")" = 1 ] && break
  sleep 0.2
done
sleep 1.5
SUPABASE_DB_URL=$(url) IDLE_TX_SECONDS=1 timeout 120 bash "$root/scripts/preview-db.sh" > "$work/out" 2>&1; rc=$?
check "[NFR-14] a session idle in a transaction is ended, not waited behind" \
  "$(is "$rc:$(grep -c 'ended 1 session(s) idle in a transaction' "$work/out"):$(q "select count(*) from pg_stat_activity where datname = '$db' and state like 'idle in transaction%'")" "0:1:0")"
check "[NFR-14] new sessions end themselves after 60 s idle in a transaction" \
  "$(is "$(q "show idle_in_transaction_session_timeout")" "1min")"
check "[NFR-14] the log names a session waiting on one held in a transaction" \
  "$(is "$(grep -c '^waiting: .* -> held by .*idle in transaction' "$work/out")" "1")"
kill "$holder" "$waiter" 2> /dev/null

[ "$failures" -eq 0 ] && echo "preview-db: all checks passed" || { echo "preview-db: $failures check(s) failed"; exit 1; }
