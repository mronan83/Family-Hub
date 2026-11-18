#!/usr/bin/env bash
# [NFR-12][DEV-05] Where a database spends its time (WP-124): run by the db-health workflow on the
# test project or production, read only, timings, sizes and counts only (households and boards
# numbered, nothing named).
#
# 1. The report in scripts/db-health.sql: settings, sizes and dead rows, counts, connections, a
#    trivial query timed, and pg_stat_statements' heaviest statements.
# 2. The board's read, as each of up to BOARDS active boards (default 3): board_snapshot() and
#    board_groceries() timed READS times each in a read-only transaction that is rolled back, and
#    where the snapshot's time goes by function (when the role may set track_functions).
# 3. With WATCH_MINUTES > 0: samples pg_stat_activity every 2 s for that long (say, while an e2e run
#    is going) and reports what the busy connections were waiting on, the most busy at once in each
#    minute, and the statements that took the most time in that window.
#
# Needs SUPABASE_DB_URL; psql 15+, python3.
set -euo pipefail

: "${SUPABASE_DB_URL:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
BOARDS=${BOARDS:-3}
READS=${READS:-10}
WATCH_MINUTES=${WATCH_MINUTES:-0}

# Every session is read only: PGOPTIONS reaches Postgres through the session pooler as well.
export PGOPTIONS='-c default_transaction_read_only=on'
sql() { psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }

psql "$SUPABASE_DB_URL" -X -q -f "$root/scripts/db-health.sql"

echo
echo "## The board's read, as up to $BOARDS active boards, $READS reads each (ms)"
n=0
while IFS='|' read -r device user; do
  [ -n "$device" ] || continue
  n=$((n + 1))
  psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 -F' | ' \
    -v device="$device" -v user="$user" -v reads="$READS" -f "$root/scripts/db-health-board.sql" 2>&1 \
    | sed -e 's/^.*NOTICE:  //' -e "s/^/board $n | /"
done < <(sql -c "select id, auth_user_id from public.device where status = 'active' order by created_at desc limit $BOARDS")
[ "$n" -gt 0 ] || echo "no active boards"

[ "$WATCH_MINUTES" -gt 0 ] || exit 0

echo
echo "## Watching for $WATCH_MINUTES minute(s), every 2 s"
before=$(mktemp) after=$(mktemp) samples=$(mktemp)
trap 'rm -f "$before" "$after" "$samples"' EXIT
statements="select queryid, calls, total_exec_time, left(regexp_replace(query, '\\s+', ' ', 'g'), 90)
              from extensions.pg_stat_statements"
sql -F$'\t' -c "$statements" > "$before"
end=$(($(date +%s) + WATCH_MINUTES * 60))
# One connection for all samples: a psql reading a query every 2 s from a here-loop.
while [ "$(date +%s)" -lt "$end" ]; do
  echo "select to_char(now(), 'HH24:MI:SS'), coalesce(wait_event_type || ':' || wait_event, 'cpu'),
               coalesce(nullif(usename, ''), '-'), left(regexp_replace(query, '\\s+', ' ', 'g'), 60),
               round(extract(epoch from now() - query_start) * 1000)
          from pg_stat_activity
         where state = 'active' and pid <> pg_backend_pid() and backend_type = 'client backend';"
  echo "select pg_sleep(2);"
  sleep 2
done | psql "$SUPABASE_DB_URL" -X -A -t -q -F$'\t' > "$samples" || true
sql -F$'\t' -c "$statements" > "$after"

python3 -I - "$samples" "$before" "$after" <<'PY'
import collections, sys
samples, before, after = sys.argv[1:4]
rows = [l.rstrip('\n').split('\t') for l in open(samples) if l.count('\t') == 4]
ticks = sorted({r[0] for r in rows})
print(f'{len(ticks)} samples with a busy connection; {len(rows)} busy connection-samples')
waits = collections.Counter(r[1] for r in rows)
print('\n### What the busy connections waited on (samples)')
for w, c in waits.most_common(12):
    print(f'{c:6d}  {w}')
print('\n### The longest-running statements seen (ms, role, statement)')
for r in sorted(rows, key=lambda r: -int(r[4] or 0))[:12]:
    print(f'{r[4]:>7}  {r[0]}  {r[2]}  {r[3]}')
per_minute = collections.defaultdict(collections.Counter)
for r in rows:
    per_minute[r[0][:5]][r[0]] += 1
print('\n### The most busy at once, each minute')
print(' '.join(f'{m}={max(c.values())}' for m, c in sorted(per_minute.items())))
def load(path):
    out = {}
    for l in open(path):
        p = l.rstrip('\n').split('\t')
        if len(p) == 4:
            out[p[0]] = (int(p[1]), float(p[2]), p[3])
    return out
b, a = load(before), load(after)
delta = []
for q, (calls, total, text) in a.items():
    c0, t0, _ = b.get(q, (0, 0.0, ''))
    if total - t0 > 0:
        delta.append((total - t0, calls - c0, text))
print('\n### The statements that took the most time in the window (ms, calls, mean ms)')
for t, c, text in sorted(delta, reverse=True)[:20]:
    print(f'{t:9.0f} {c:7d} {t / max(c, 1):8.1f}  {text}')
PY
