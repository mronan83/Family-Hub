#!/usr/bin/env bash
# [NFR-14][ACC-02] Tests for scripts/preview-db.sh on native Postgres (CI database job; no Docker):
# migrations, the demo family and the demo sign-ins' passwords, on a throwaway database with the
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
run; rc=$?
check "[NFR-14] applies the migrations and resets the demo family" \
  "$(is "$rc:$(q "select count(*) from public.member where household_id = '0de00000-0000-4000-8000-000000000001'")" "0:4")"

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

run; rc=$?
check "[NFR-14] a second run resets again" \
  "$(is "$rc:$(q "select count(*) from auth.users where email like '%@demo.familywise.invalid' and encrypted_password is not null")" "0:4")"
check "[ACC-02] the secret is not printed" "$(is "$(grep -c 'test-secret\|045626f9' "$work/out")" "0")"

[ "$failures" -eq 0 ] && echo "preview-db: all checks passed" || { echo "preview-db: $failures check(s) failed"; exit 1; }
