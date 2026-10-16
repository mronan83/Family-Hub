#!/usr/bin/env bash
# [CHR-20] Reports why approval alerts did or did not go, since yesterday in each household's own
# time (reminders-report workflow). Read only, and counts and reasons only: households and parents
# are numbered, nothing is named. Needs SUPABASE_DB_URL; psql 15+.
set -euo pipefail

: "${SUPABASE_DB_URL:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
PGOPTIONS='-c default_transaction_read_only=on' \
  psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$root/scripts/reminders-report.sql"
