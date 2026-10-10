#!/usr/bin/env bash
# Database tests on native Postgres, no Docker (01 §9.4, D-26).
# Creates a throwaway database, applies the Supabase compatibility bootstrap and every migration
# (through scripts/db-migrate.sh, as the deploy does), runs pgTAP via pg_prove, then drops the database.
# Connection comes from the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); the user must
# be able to create databases and switch roles (a superuser locally and in CI).
set -euo pipefail
shopt -s nullglob

root="$(cd "$(dirname "$0")/.." && pwd)"
db="familywise_test_$$"
psql_admin=(psql -v ON_ERROR_STOP=1 -q -X -d "${PGDATABASE_ADMIN:-postgres}")

"${psql_admin[@]}" -c "create database ${db}"
trap '"${psql_admin[@]}" -c "drop database if exists ${db} with (force)" >/dev/null' EXIT
"${psql_admin[@]}" -c "alter database ${db} set search_path = \"\$user\", public, extensions"

apply() { psql -v ON_ERROR_STOP=1 -q -X -d "$db" -f "$1" >/dev/null; }

for f in "$root"/supabase/tests/bootstrap/*.sql; do apply "$f"; done
# Through the same runner as the deploy, so CI exercises it on every real migration.
migrations=("$root"/supabase/migrations/*.sql)
SUPABASE_DB_URL="postgresql:///${db}" bash "$root/scripts/db-migrate.sh" >/dev/null
psql -v ON_ERROR_STOP=1 -q -X -d "$db" -c "create extension if not exists pgtap with schema extensions"

tests=("$root"/supabase/tests/*.test.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "no pgTAP tests found" >&2
  exit 1
fi
echo "applied ${#migrations[@]} migration(s); running ${#tests[@]} test file(s)"
pg_prove -d "$db" --failures "${tests[@]}"
# Concurrency, which pgTAP in one session cannot show (WP-18).
echo "redemption race"
bash "$root/scripts/redemption-race.sh" "$db"
