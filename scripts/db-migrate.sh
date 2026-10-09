#!/usr/bin/env bash
# Applies this commit's pending migrations to the database (01 §9.5, §9.6, D-37). Used by the deploy
# (every pending migration) and by e2e on a pull request's preview (--additive-only).
#
# One database serves production and every preview, so the database can hold migrations this commit
# does not have: an open pull request's preview applied them before it merged. `supabase db push`
# refuses to run then; this runner reports them and carries on. Each migration runs in its own
# transaction together with its history row in supabase_migrations.schema_migrations, so a failed
# migration leaves neither behind. Pending migrations run in filename order, including any older
# than the newest one already applied (migrations are forward-only and independent; §9.6).
#
# --additive-only: if any pending migration drops, renames, retypes, truncates or deletes, apply
# none; they wait for approval and ship with the deploy.
#
# Needs SUPABASE_DB_URL (session pooler URI) and psql. MIGRATIONS_DIR overrides the directory (tests).
set -euo pipefail
shopt -s nullglob

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="${MIGRATIONS_DIR:-$root/supabase/migrations}"
additive_only=false
[ "${1:-}" = --additive-only ] && additive_only=true

# Statements that remove or change what the running app may use (comments are ignored).
CHANGES='drop[[:space:]]+(table|column|schema|type|view|materialized)|truncate[[:space:]]|rename[[:space:]]+(to|column|constraint)|alter[[:space:]]+column[^;]*[[:space:]]type[[:space:]]|delete[[:space:]]+from'

psql_q=(psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1)

# The history table the Supabase CLI keeps; created here only on a database that has never had one.
"${psql_q[@]}" -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key);
  alter table supabase_migrations.schema_migrations add column if not exists statements text[];
  alter table supabase_migrations.schema_migrations add column if not exists name text;" >/dev/null

applied=$("${psql_q[@]}" -c "select version from supabase_migrations.schema_migrations order by version")

pending=()
local_versions=()
for f in "$dir"/*.sql; do
  file=$(basename "$f")
  [[ "$file" =~ ^([0-9]{14})_([a-z0-9_]+)\.sql$ ]] \
    || { echo "::error::migration file name must be <14 digits>_<snake_case>.sql: $file"; exit 1; }
  # The runner wraps each migration in its own transaction; a file must not commit part of itself.
  if sed 's/--.*$//' "$f" | grep -qiE '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction)[[:space:]]*;'; then
    echo "::error::$file controls its own transaction; remove BEGIN/COMMIT (each migration already runs in one)"; exit 1
  fi
  local_versions+=("${BASH_REMATCH[1]}")
  grep -qx "${BASH_REMATCH[1]}" <<<"$applied" || pending+=("$f")
done

others=()
while read -r v; do
  [ -n "$v" ] || continue
  printf '%s\n' "${local_versions[@]}" | grep -qx "$v" || others+=("$v")
done <<<"$applied"
if [ ${#others[@]} -gt 0 ]; then
  echo "::notice::${#others[@]} migration(s) in the database are not in this commit (applied by an open pull request's preview): ${others[*]}"
fi

if [ ${#pending[@]} -eq 0 ]; then
  echo "no pending migrations"
  exit 0
fi

if $additive_only; then
  changing=()
  for f in "${pending[@]}"; do
    if sed 's/--.*$//' "$f" | grep -qiE "$CHANGES"; then changing+=("$(basename "$f")"); fi
  done
  if [ ${#changing[@]} -gt 0 ]; then
    echo "::notice::not applying ${#pending[@]} pending migration(s) before approval; they ship with the deploy: ${changing[*]}"
    exit 0
  fi
fi

for f in "${pending[@]}"; do
  file=$(basename "$f")
  version=${file%%_*}
  name=${file#*_}
  name=${name%.sql}
  # Validated above: version is digits and name is snake_case, so both are safe as literals.
  psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')" >/dev/null
  echo "applied $file"
done
