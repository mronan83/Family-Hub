#!/usr/bin/env bash
# SPIKE-05 measurement (01 §5.6). From the production database, pg_net calls the probe on a preview
# the way pg_cron jobs will call the job endpoints, and prints a report (also to the job summary):
# how long a call may run on Vercel Hobby, how pg_net queues calls, CPU per call and per cold start,
# how concurrent calls share instances, and whether an instance stays warm between 5-minute jobs.
# Meanwhile a pg_cron job calls production every 20 seconds, then is removed, to show the schedule
# and what cron's own run history records. Run it from the spike-05 workflow.
#
# Leaves behind only pg_net's response log (deleted after 6 hours) and the cron run history.
# Needs SUPABASE_DB_URL, PREVIEW_URL, VERCEL_AUTOMATION_BYPASS_SECRET, PRODUCTION_URL; psql 15+.
set -euo pipefail

: "${SUPABASE_DB_URL:?}" "${PREVIEW_URL:?}" "${VERCEL_AUTOMATION_BYPASS_SECRET:?}" "${PRODUCTION_URL:?}"
DURATIONS=${DURATIONS:-30 120 240 290 310}
BURST=${BURST:-10}
IDLE=${IDLE:-300} # seconds without calls, as between 5-minute jobs
CRON_JOB=spike-05-cron
summary=${GITHUB_STEP_SUMMARY:-/dev/null} # the report also goes to the log
export PROBE="$PREVIEW_URL/api/jobs/spike" PRODUCTION_URL VERCEL_AUTOMATION_BYPASS_SECRET

sql() { psql "$SUPABASE_DB_URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }
now() { date +%s; }

# Calls the probe once per number of seconds given; prints tag:seconds:request id:sent (epoch).
send() {
  TAG=$1 LIST="${*:2}" sql <<'SQL'
\getenv probe PROBE
\getenv bypass VERCEL_AUTOMATION_BYPASS_SECRET
\getenv tag TAG
\getenv list LIST
select format('%s:%s:%s:%s', :'tag', s, net.http_post(
  url := :'probe' || '?seconds=' || s,
  body := jsonb_build_object('tag', :'tag'),
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-vercel-protection-bypass', :'bypass'),
  timeout_milliseconds := 330000), extract(epoch from clock_timestamp()))
from unnest(string_to_array(:'list', ' ')::int[]) as s;
SQL
}

# Waits until every request in "$@" has a response, or the deadline (epoch) in $DEADLINE passes.
wait_for() {
  local ids
  ids=$(printf '%s\n' "$@" | cut -d: -f3 | paste -sd' ')
  while :; do
    got=$(IDS="$ids" sql <<'SQL'
\getenv ids IDS
select count(*) from net._http_response where id = any(string_to_array(:'ids', ' ')::bigint[]);
SQL
)
    [ "$got" -ge $# ] && return 0
    [ "$(now)" -lt "$DEADLINE" ] || { echo "::warning::$(( $# - got )) call(s) had no answer by the deadline"; return 0; }
    sleep 5
  done
}

unschedule() {
  sql -c "select cron.unschedule(jobid) from cron.job where jobname = '$CRON_JOB'" >/dev/null || true
}

# Preconditions ------------------------------------------------------------------------------------
# e2e on the same preview applies the migration that enables pg_cron and pg_net; wait for it.
DEADLINE=$(( $(now) + ${EXTENSIONS_WAIT:-900} ))
while :; do
  versions=$(sql -c "select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension where extname in ('pg_net', 'pg_cron')")
  case "$versions" in *pg_cron*pg_net*) break ;; esac
  [ "$(now)" -lt "$DEADLINE" ] || { echo "::error::pg_cron and pg_net are not enabled (migration 20261008040000_job_scheduler; e2e applies it)"; exit 1; }
  sleep 15
done
echo "extensions: $versions"

# pg_cron against production, running while everything else is measured ---------------------------
unschedule
trap unschedule EXIT
cron_from=$(now)
job=$(sql <<'SQL'
\getenv prod PRODUCTION_URL
select cron.schedule('spike-05-cron', '20 seconds', format(
  $cmd$select net.http_get(%L), net.http_post(%L, '{"tag":"cron"}'::jsonb)$cmd$,
  :'prod' || '/api/health', :'prod' || '/api/jobs/spike'));
SQL
)

# Cold, then warm, then every duration and a burst at once, then a call after an idle gap ----------------------------------------
# (Plain assignments, so a failed call stops the script.)
cold=$(send cold 0)
DEADLINE=$(( $(now) + 60 )) wait_for $cold
warm=$(send warm 0)
DEADLINE=$(( $(now) + 30 )) wait_for $warm
timed=$(send duration $DURATIONS)
burst=$(send burst $(printf '5 %.0s' $(seq "$BURST")))
longest=$(printf '%s\n' $DURATIONS | sort -n | tail -1)
DEADLINE=$(( $(now) + longest + 60 )) wait_for $timed $burst
sleep "$IDLE"
idle=$(send idle 0)
DEADLINE=$(( $(now) + 60 )) wait_for $idle

unschedule
cron_to=$(now)
sleep 15 # let the last cron calls answer

# Report -------------------------------------------------------------------------------------------
REQS=$(echo $cold $warm $timed $burst $idle) JOB="$job" FROM="$cron_from" TO="$cron_to" \
  VERSIONS="$versions" IDLE="$IDLE" sql <<'SQL' | tee -a "$summary"
\getenv reqs REQS
\getenv job JOB
\getenv from FROM
\getenv to TO
\getenv versions VERSIONS
\getenv probe PROBE
\getenv idle IDLE
create temp table req as
select split_part(x, ':', 1) as tag, split_part(x, ':', 2)::int as seconds,
       split_part(x, ':', 3)::bigint as id, split_part(x, ':', 4)::numeric as sent
from unnest(string_to_array(:'reqs', ' ')) as x;
-- net._http_response.created is when pg_net's worker began the batch holding the call, not when the
-- call answered: a call waits for every call in the batch before it (01 §5.6).
create temp table res as
select q.*, r.status_code, r.timed_out, r.error_msg, r.created, r.content,
       case when r.content_type like 'application/json%' then r.content::jsonb end as j
from req q left join net._http_response r using (id);

select format(e'## SPIKE-05 results\n\n%s · %s · probe on `%s` (region %s)\n',
  to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"'), :'versions',
  split_part(:'probe', '/', 3), coalesce((select j->>'region' from res where j is not null limit 1), '?'));

select e'### Calls through pg_net (timeout 330 s)\n\n| Call | Asked | HTTP | pg_net started it after | Ran | CPU | Instance | Note |\n|---|---|---|---|---|---|---|---|';
select format('| %s | %s s | %s | %s s | %s | %s | %s | %s |',
  tag, seconds,
  coalesce(status_code::text, case when timed_out then 'timed out' else 'no answer' end),
  coalesce(round(extract(epoch from created) - sent, 1)::text, '–'),
  coalesce((j->>'ranMs') || ' ms', '–'),
  coalesce((j->>'cpuMs') || ' ms', '–'),
  coalesce(j->>'instance', '–'),
  case when (j->>'cold')::boolean then 'cold start, ' || (j->>'bootCpuMs') || ' ms CPU to boot' else
    replace(left(regexp_replace(coalesce(error_msg, case when j is null then content end, ''), '\s+', ' ', 'g'), 90), '|', '/') end)
from res
order by array_position(array['cold', 'warm', 'duration', 'burst', 'idle'], tag), seconds, id;

select format(e'\n**Burst:** %s of %s calls answered 200 on %s instance(s); pg_net started them after %s s.\n',
  count(*) filter (where status_code = 200), count(*), count(distinct j->>'instance'),
  round(max(extract(epoch from created) - sent), 1))
from res where tag = 'burst';
select format(e'**Idle:** after %s s without calls, the next call ran on instance %s, %s.\n',
  :'idle', coalesce(j->>'instance', '–'), case when (j->>'cold')::boolean then 'a cold start' else 'still warm' end)
from res where tag = 'idle';

select e'### pg_cron every 20 seconds (health check and a job call on production)\n';
select format('- Cron runs: %s, recorded as %s; first %s, last %s, %s s apart on average.',
  count(*), coalesce(string_agg(distinct status, ', '), 'none'),
  to_char(min(start_time) at time zone 'utc', 'HH24:MI:SS'), to_char(max(start_time) at time zone 'utc', 'HH24:MI:SS'),
  round(extract(epoch from max(start_time) - min(start_time))::numeric / nullif(count(*) - 1, 0), 1))
from cron.job_run_details where jobid = :'job'::bigint;
select format('- Answers to those calls: %s.',
  coalesce(string_agg(format('%s × HTTP %s', n, coalesce(code::text, 'none')), ', ' order by code), 'none'))
from (select status_code as code, count(*) as n from net._http_response
      where created between to_timestamp(:'from'::numeric) and to_timestamp(:'to'::numeric) + interval '20 seconds'
        and id not in (select id from req)
      group by status_code) as answers;
SQL

echo "SPIKE-05 measured; the report above is also in the job summary"
