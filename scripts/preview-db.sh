#!/usr/bin/env bash
# Prepares the one Supabase database for an e2e run on a pull request's preview (01 §9.5, D-37).
#
# 1. Applies the pull request's new migrations, so the preview runs on its schema. If any of them
#    drops, renames, retypes, truncates or deletes, none are applied now: they wait for approval and
#    ship with the deploy, and the preview runs on the current schema (expand and contract, §9.6).
# 2. Resets the demo family (supabase/seed.sql), the household previews and e2e run as. RLS keeps it
#    apart from every real household. No other household is touched, and nothing here wipes the
#    database.
#
# Requires SUPABASE_DB_URL (session pooler URI) and the Supabase CLI.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
root="$(cd "$(dirname "$0")/.." && pwd)"
# Statements that remove or change what the running app may use (comments are ignored).
CHANGES='drop[[:space:]]+(table|column|schema|type|view|materialized)|truncate[[:space:]]|rename[[:space:]]+(to|column|constraint)|alter[[:space:]]+column[^;]*[[:space:]]type[[:space:]]|delete[[:space:]]+from'

applied=$(psql "$SUPABASE_DB_URL" -X -A -t -c "select version from supabase_migrations.schema_migrations" 2>/dev/null || true)
new=()
for f in "$root"/supabase/migrations/*.sql; do
  version=$(basename "$f")
  version=${version%%_*}
  grep -qx "$version" <<<"$applied" || new+=("$f")
done

if [ ${#new[@]} -eq 0 ]; then
  echo "no new migrations"
else
  changing=()
  for f in "${new[@]}"; do
    if sed 's/--.*$//' "$f" | grep -qiE "$CHANGES"; then changing+=("$(basename "$f")"); fi
  done
  if [ ${#changing[@]} -gt 0 ]; then
    echo "::notice::not applying ${#new[@]} new migration(s) before approval; they ship with the deploy: ${changing[*]}"
  else
    supabase db push --db-url "$SUPABASE_DB_URL" --include-all --yes
  fi
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X --single-transaction -f "$root/supabase/seed.sql"
echo "demo family reset"
