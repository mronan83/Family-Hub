#!/usr/bin/env bash
# Prepares the one Supabase database for an e2e run on a pull request's preview (01 §9.5, D-37).
#
# 1. Applies the pull request's new migrations (scripts/db-migrate.sh --additive-only), so the
#    preview runs on its schema. If any of them drops, renames, retypes, truncates or deletes, none are
#    applied now: they wait for approval and ship with the deploy, and the preview runs on the current
#    schema (expand and contract, §9.6).
# 2. Resets the demo family (supabase/seed.sql), the household previews and e2e run as. RLS keeps it
#    apart from every real household. No other household is touched, and nothing here wipes the
#    database.
#
# Requires SUPABASE_DB_URL (session pooler URI) and psql.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
root="$(cd "$(dirname "$0")/.." && pwd)"

bash "$root/scripts/db-migrate.sh" --additive-only

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X --single-transaction -f "$root/supabase/seed.sql"
echo "demo family reset"
