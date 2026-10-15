#!/usr/bin/env bash
# [NFR-14][D-104] Holds the test database for one e2e run at a time (01 §9.5). Pull requests' runs,
# the full suite on main after a deploy and the nightly run all share the one free test database, so
# each takes this lock first: a session on that database holding a Postgres advisory lock for the
# whole job. Waiters queue in order on the database; nothing is cancelled or replaced, unlike a
# GitHub concurrency group, which keeps only one waiting run. The lock goes when the session ends:
# `release` ends it on the database itself; if the runner dies instead, the session ends within 10 s
# of its connection dropping (client_connection_check_interval), and in any case after 4 hours.
#
#   e2e-lock.sh acquire   wait for the lock (up to E2E_LOCK_WAIT seconds, default 3 h), then return
#   e2e-lock.sh release   end the session
#
# Requires SUPABASE_DB_URL and psql. E2E_LOCK_NAME says who holds it, for the runs that wait.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/e2e-lock"
key=8585085
mkdir -p "$dir"

case "${1:-}" in
  acquire)
    rm -f "$dir/held"
    name="${E2E_LOCK_NAME:-e2e}"
    # statement_timeout off for this session only: the loop below is the lock's lifetime, 4 hours at
    # most. A dropped connection is noticed within 10 s even mid-loop.
    PGAPPNAME="e2e-lock: ${name:0:50}" nohup psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 \
      > "$dir/log" 2>&1 <<SQL &
set statement_timeout = 0;
set client_connection_check_interval = '10s';
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
      if ! kill -0 "$(cat "$dir/pid")" 2>/dev/null; then
        echo "::error::the lock's session on the test database ended before it held the lock: $(head -c 300 "$dir/log")"
        exit 1
      fi
      waited=$(($(date +%s) - started))
      if [ "$waited" -ge "${E2E_LOCK_WAIT:-10800}" ]; then
        echo "::error::waited ${waited} s for the test database; giving up"
        exit 1
      fi
      if [ $((waited / 60)) -gt "$said" ]; then
        said=$((waited / 60))
        holder=$(psql "$SUPABASE_DB_URL" -X -A -t -q -c \
          "select application_name from pg_stat_activity a join pg_locks l on l.pid = a.pid
            where l.locktype = 'advisory' and l.objid = $key and l.granted limit 1" 2>/dev/null || true)
        echo "waiting ${said} min for the test database (held by ${holder#e2e-lock: })"
      fi
      sleep 2
    done
    echo "holding the test database after $(($(date +%s) - started)) s"
    ;;
  release)
    # On the database first: a killed client alone leaves a busy session, and its lock, running.
    if [ -s "$dir/held" ]; then
      psql "$SUPABASE_DB_URL" -X -A -t -q -c "select pg_terminate_backend($(cat "$dir/held"))" > /dev/null || true
    fi
    [ -f "$dir/pid" ] && kill "$(cat "$dir/pid")" 2>/dev/null || true
    rm -f "$dir/held" "$dir/pid"
    echo "released the test database"
    ;;
  *)
    echo "usage: $0 acquire|release" >&2
    exit 2
    ;;
esac
