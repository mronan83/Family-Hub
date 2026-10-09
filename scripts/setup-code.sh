#!/usr/bin/env bash
# Issues a one-time setup code for a new household (setup-code workflow, WP-03, D-39). The code is
# 12 characters from an alphabet without look-alikes (about 59 bits), works once, for 24 hours. Only its
# SHA-256 hash is stored. The code is written to SETUP_CODE_OUT (the run's summary page in the
# workflow), never to the log. Needs SUPABASE_DB_URL, SETUP_CODE_OUT, python3 and psql 15+.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${SETUP_CODE_OUT:?SETUP_CODE_OUT is required}"

SETUP_CODE=$(python3 -I -c '
import secrets
alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
code = "".join(secrets.choice(alphabet) for _ in range(12))
print("-".join(code[i:i + 4] for i in range(0, 12, 4)))
')
export SETUP_CODE
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$SETUP_CODE"

expires=$(psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv code SETUP_CODE
insert into private.household_setup_code (code_hash, expires_at)
values (private.code_hash(:'code'), now() + interval '24 hours')
returning to_char(expires_at at time zone 'UTC', 'Dy, Mon FMDD at FMHH12:MI am "UTC"');
SQL
)

cat >> "$SETUP_CODE_OUT" <<MD
## Household setup code

\`$SETUP_CODE\`

Open \`/setup\` on the app and enter this code. It works once, until $expires.
MD
echo "setup code issued; it expires $expires (the code is on the run's summary page)"
