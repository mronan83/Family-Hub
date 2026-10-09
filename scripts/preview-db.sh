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
# 3. In the same transaction, gives each demo sign-in its password (WP-03, D-39): the HMAC-SHA256 of
#    "familywise demo sign-in <email>" keyed with the deployment-protection bypass secret, in hex.
#    The preview derives the same password for its one-tap sign-in, so nobody stores or types it.
#    The secret stays on this runner (never on a command line or in a query); the database gets
#    only the derived passwords and stores their bcrypt hashes.
#
# Requires SUPABASE_DB_URL (session pooler URI), VERCEL_AUTOMATION_BYPASS_SECRET, python3 and psql.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${VERCEL_AUTOMATION_BYPASS_SECRET:?VERCEL_AUTOMATION_BYPASS_SECRET is required}"
root="$(cd "$(dirname "$0")/.." && pwd)"

bash "$root/scripts/db-migrate.sh" --additive-only

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
