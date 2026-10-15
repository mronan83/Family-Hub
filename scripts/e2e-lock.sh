#!/usr/bin/env bash
# [NFR-14][D-104] Holds the test database for one e2e run at a time (01 §9.5). Pull requests' runs,
# the full suite on main after a deploy and the nightly run all share the one free test database, so
# each takes this lock first: a session on that database holding a Postgres advisory lock for the
# whole job. Waiters queue in order on the database; nothing is cancelled or replaced, unlike a
# GitHub concurrency group, which keeps only one waiting run.
#
# Through Supabase's pooler (Supavisor, session mode) a session is named "Supavisor" whatever the
# client says, and a client that dies can leave its session, and its lock, alive. So:
#   - the holding session names itself from inside ("e2e-lock run=<GitHub run id>");
#   - a waiting run ends a hold whose GitHub run has finished, or, when the hold doesn't say whose it
#     is, one held while no other e2e run is in progress (a stale lock from before this rule);
#   - `release` ends the session on the database and checks it has gone, retrying for a minute;
#   - every hold ends after 4 hours in any case.
# Before it waits, it prints the test database's connections by user, name and state (counts only).
#
#   e2e-lock.sh acquire   wait for the lock (up to E2E_LOCK_WAIT seconds, default 3 h), then return
#   e2e-lock.sh release   end the session
#
# Requires SUPABASE_DB_URL and psql. E2E_LOCK_RUN is this GitHub run's id; with GH_TOKEN and
# GITHUB_REPOSITORY, a waiting run can tell a finished run's hold from a live one.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/e2e-lock"
key=8585085
run="${E2E_LOCK_RUN:-0}"
mkdir -p "$dir"

q() { psql "$SUPABASE_DB_URL" -X -A -t -q -F ' ' -c "$1" 2> "$dir/q.err"; }

# The connections on the test database, for the log: who holds the pool when it is full.
connections() {
  echo "test database connections (user, name, state: count; max_connections $(q 'show max_connections' || echo '?')):"
  q "select coalesce(usename, '-') || ', ' || coalesce(nullif(application_name, ''), '-') || ', '
            || coalesce(state, '-') || coalesce(' (' || wait_event_type || ')', '') || ': ' || count(*)
       from pg_stat_activity group by usename, application_name, state, wait_event_type
      order by count(*) desc" | sed 's/^/  /' || echo "  (could not read: $(head -c 200 "$dir/q.err"))"
}

# The session holding the lock: "<pid> <application_name>", or nothing.
holder() {
  q "select a.pid || ' ' || coalesce(a.application_name, '') from pg_stat_activity a
       join pg_locks l on l.pid = a.pid
      where l.locktype = 'advisory' and l.objid = $key and l.granted limit 1" || true
}

# Whether a GitHub run is still going: "yes", "no", or "unknown" (no token, or GitHub didn't answer).
run_live() {
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || { echo unknown; return; }
  local status
  status=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$1" --jq .status 2> /dev/null) || { echo unknown; return; }
  [ "$status" = completed ] && echo no || echo yes
}

# Whether another e2e run (a pull request's or main's) is in progress: "yes", "no" or "unknown".
others_live() {
  [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || { echo unknown; return; }
  local n=0 c
  for wf in e2e.yml e2e-main.yml; do
    c=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?status=in_progress&per_page=50" \
      --jq "[.workflow_runs[] | select(.id != $run)] | length" 2> /dev/null) || { echo unknown; return; }
    n=$((n + c))
  done
  [ "$n" -gt 0 ] && echo yes || echo no
}

# Ends the hold of a run that is over. Returns 0 when it ended one.
break_stale() {
  local h pid name owner live
  h=$(holder)
  [ -n "$h" ] || return 1
  pid=${h%% *}
  name=${h#* }
  if [[ "$name" =~ run=([0-9]+) ]]; then
    owner=${BASH_REMATCH[1]}
    live=$(run_live "$owner")
    [ "$live" = no ] || return 1
    echo "the lock's holder, run $owner, has finished; ending its session ($pid)"
  else
    live=$(others_live)
    [ "$live" = no ] || return 1
    echo "the lock is held by a session that names no run ($name), and no other e2e run is in progress; ending it ($pid)"
  fi
  q "select pg_terminate_backend($pid)" > /dev/null || return 1
}

case "${1:-}" in
  acquire)
    rm -f "$dir/held"
    connections
    # statement_timeout off for this session only: the loop below is the lock's lifetime, 4 hours at
    # most. Its name is set from inside, since the pooler replaces the client's.
    nohup psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 > "$dir/log" 2>&1 <<SQL &
set statement_timeout = 0;
set client_connection_check_interval = '10s';
set application_name = 'e2e-lock run=$run';
select pg_advisory_lock($key);
\\pset tuples_only on
\\pset format unaligned
\\o '$dir/held'
select pg_backend_pid();
\\o
do \$\$ begin for i in 1..240 loop perform pg_sleep(60); end loop; end \$\$;
SQL
    echo $! > "$dir/pid"
    started=$(date +%s)
    said=0
    until [ -s "$dir/held" ]; do
      if ! kill -0 "$(cat "$dir/pid")" 2> /dev/null; then
        echo "::error::the lock's session on the test database ended before it held the lock: $(head -c 300 "$dir/log")"
        exit 1
      fi
      waited=$(($(date +%s) - started))
      if [ "$waited" -ge "${E2E_LOCK_WAIT:-10800}" ]; then
        echo "::error::waited ${waited} s for the test database; giving up"
        connections
        exit 1
      fi
      if [ $((waited / 60)) -gt "$said" ]; then
        said=$((waited / 60))
        h=$(holder)
        echo "waiting ${said} min for the test database (held by ${h:-nobody we can see})"
        break_stale || true
      fi
      sleep 2
    done
    echo "holding the test database after $(($(date +%s) - started)) s"
    ;;
  release)
    # On the database: a killed client alone can leave its session, and the lock, running.
    if [ -s "$dir/held" ]; then
      pid=$(cat "$dir/held")
      for attempt in 1 2 3 4 5 6; do
        q "select pg_terminate_backend($pid)" > /dev/null || true
        gone=$(q "select count(*) = 0 from pg_stat_activity where pid = $pid" || echo f)
        [ "$gone" = t ] && break
        echo "the lock's session ($pid) is still there (attempt $attempt): $(head -c 200 "$dir/q.err")"
        sleep 10
      done
      if [ "$gone" != t ]; then
        echo "::warning::could not end the lock's session ($pid); the next run ends it once this run has finished"
      fi
    fi
    [ -f "$dir/pid" ] && kill "$(cat "$dir/pid")" 2> /dev/null || true
    rm -f "$dir/held" "$dir/pid"
    echo "released the test database"
    ;;
  *)
    echo "usage: $0 acquire|release" >&2
    exit 2
    ;;
esac
