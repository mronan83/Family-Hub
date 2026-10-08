#!/usr/bin/env bash
# Rebuilds the shared PREVIEW database for an e2e run (01 §9.5): wipe, apply every migration, seed.
# Requires PREVIEW_DB_URL (session pooler URI of the preview project), SUPABASE_PREVIEW_PROJECT_ID and
# SUPABASE_PROJECT_ID (production). Refuses to touch anything that is not the preview project.
set -euo pipefail

: "${PREVIEW_DB_URL:?PREVIEW_DB_URL is required}"
: "${SUPABASE_PREVIEW_PROJECT_ID:?SUPABASE_PREVIEW_PROJECT_ID is required}"
: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID (production) is required}"

if [ "$SUPABASE_PREVIEW_PROJECT_ID" = "$SUPABASE_PROJECT_ID" ]; then
  echo "refusing: preview and production project ids are the same" >&2; exit 1
fi
case "$PREVIEW_DB_URL" in
  *"$SUPABASE_PROJECT_ID"*) echo "refusing: PREVIEW_DB_URL points at production" >&2; exit 1 ;;
  *"$SUPABASE_PREVIEW_PROJECT_ID"*) ;;
  *) echo "refusing: PREVIEW_DB_URL does not name the preview project" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -X -f "$root/scripts/preview-reset.sql"
supabase db push --db-url "$PREVIEW_DB_URL" --include-all --yes
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -X -f "$root/supabase/seed.sql"
echo "preview database rebuilt from $(ls "$root"/supabase/migrations/*.sql | wc -l) migration(s)"
