#!/usr/bin/env bash
# Prepares the test database for an e2e run on a pull request's preview (01 §9.5, D-85). Previews and
# e2e use their own Supabase project, never production's, and every run starts from the same place:
#
# 1. Refuses any database but the test project's (TEST_PROJECT_REF, the pooler user
#    postgres.<ref>) or a throwaway local one (this script's own tests). Production is never reset.
# 2. Empties the test database (scripts/test-db-reset.sql), applies every migration in this commit
#    (scripts/db-migrate.sh) and lists the jobs (scripts/job-schedules.mjs --table-only: System
#    Health reads them; none runs here), so the run sees exactly this pull request's schema and
#    nothing a run before it left behind.
# 3. Loads the demo family (supabase/seed.sql), the made-up household previews and e2e run as.
# 4. In the same transaction, gives each demo sign-in its password (WP-03, D-39): the HMAC-SHA256 of
#    "familywise demo sign-in <email>" keyed with the deployment-protection bypass secret, in hex.
#    The preview derives the same password for its one-tap sign-in, so nobody stores or types it.
#    The secret stays on this runner (never on a command line or in a query); the database gets
#    only the derived passwords and stores their bcrypt hashes.
#
# --demo-family-only skips 2: e2e uses it to load the demo family again before a retry
# (e2e/support/test.ts), so a retried test starts where the first attempt did.
#
# Requires SUPABASE_DB_URL (the test project's session pooler URI), TEST_PROJECT_REF,
# VERCEL_AUTOMATION_BYPASS_SECRET, python3 and psql.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${VERCEL_AUTOMATION_BYPASS_SECRET:?VERCEL_AUTOMATION_BYPASS_SECRET is required}"
root="$(cd "$(dirname "$0")/.." && pwd)"

# The host and user of the URL, without its password: postgresql://user[:password]@host[:port]/db.
authority=${SUPABASE_DB_URL#*://}
authority=${authority%%/*}
user=${authority%%@*}
user=${user%%:*}
host=${authority##*@}
host=${host%%:*}
case "$host" in
  localhost | 127.0.0.1 | '') ;; # a throwaway local database (scripts/preview-db.test.sh)
  *)
    # Production's project, refused by name as well, whatever TEST_PROJECT_REF says.
    if [ "$user" = postgres.jpzwmibrsvsxcimbxtmb ]; then
      echo "::error::this is the production database; refusing to reset it" >&2
      exit 1
    fi
    : "${TEST_PROJECT_REF:?TEST_PROJECT_REF is required}"
    if [ "$user" != "postgres.$TEST_PROJECT_REF" ]; then
      echo "::error::not the test database (expected the pooler user postgres.$TEST_PROJECT_REF); refusing to reset it" >&2
      exit 1
    fi
    ;;
esac

if [ "${1:-}" != --demo-family-only ]; then
  # The pooler's host names the project's region (aws-0-<region>.pooler.supabase.com); no secret.
echo "test database: ${host:-local} (user ${user:-local})"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X --single-transaction -f "$root/scripts/test-db-reset.sql"
  echo "test database emptied"
  bash "$root/scripts/db-migrate.sh" | tail -n 1
  # The jobs System Health lists (job_health reads private.job_schedule); none is scheduled here.
  node "$root/scripts/job-schedules.mjs" --table-only | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X --single-transaction
fi

# {"<email>": "<password>", ...} for the four demo sign-ins in supabase/seed.sql.
DEMO_PASSWORDS=$(python3 -I -c '
import hashlib, hmac, json, os
key = os.environ["VERCEL_AUTOMATION_BYPASS_SECRET"].encode()
emails = [n + "@demo.familywise.invalid" for n in ("alex", "sam", "jordan", "riley")]
print(json.dumps({e: hmac.new(key, ("familywise demo sign-in " + e).encode(), hashlib.sha256).hexdigest() for e in emails}))
')
export DEMO_PASSWORDS

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X --single-transaction -f "$root/supabase/seed.sql" -f - <<'SQL'
\getenv demo_passwords DEMO_PASSWORDS
update auth.users u
   set encrypted_password = extensions.crypt(p.value, extensions.gen_salt('bf', 10))
  from jsonb_each_text(:'demo_passwords'::jsonb) p
 where u.email = p.key;
do $$
begin
  if exists (select from auth.users where email like '%@demo.familywise.invalid' and encrypted_password is null) then
    raise exception 'a demo sign-in has no password';
  end if;
end $$;
SQL
echo "demo family reset; demo sign-ins ready"
