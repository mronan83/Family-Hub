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
# --demo-family-only skips 2, to load the demo family again by hand. e2e no longer uses it: each spec
# makes its own household afresh as it starts (scripts/e2e-household.mjs, D-136). It was used to load
# the demo family again before a retry
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

# Sessions stuck in an open transaction hold their locks until they end: one left "idle in transaction
# (aborted)" by the data API held a demo row, and the reset, the seed and Supabase Auth's sign-ins all
# waited behind it until their statement timeouts (e2e runs 238 to 242). On the test database only:
# end any session idle in a transaction for 30 s (IDLE_TX_SECONDS, for this script's tests), and have
# new sessions end themselves after 60 s.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -X -A -t -v idle="${IDLE_TX_SECONDS:-30}" <<'SQL'
-- Who waits on whom, for the log, before anything is ended: user, app, wait -> holder, its state.
select 'waiting: ' || coalesce(w.usename, '-') || ', ' || coalesce(nullif(w.application_name, ''), '-')
       || ', ' || coalesce(w.wait_event_type || '/' || w.wait_event, '-') || ' -> held by '
       || coalesce(h.usename, '-') || ', ' || coalesce(nullif(h.application_name, ''), '-') || ', '
       || coalesce(h.state, '-') || ' for ' || coalesce(extract(epoch from now() - h.state_change)::int, 0) || ' s'
  from pg_stat_activity w
 cross join lateral unnest(pg_blocking_pids(w.pid)) b(pid)
  join pg_stat_activity h on h.pid = b.pid
 where w.datname = current_database();
select 'ended ' || count(pg_terminate_backend(pid)) || ' session(s) idle in a transaction'
  from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid()
   and state in ('idle in transaction', 'idle in transaction (aborted)')
   and state_change < now() - make_interval(secs => :idle);
do $$
begin
  execute format('alter database %I set idle_in_transaction_session_timeout = %L',
                 current_database(), '60s');
exception when insufficient_privilege then
  raise notice 'idle_in_transaction_session_timeout left as it is: %', sqlerrm;
end $$;
SQL

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
