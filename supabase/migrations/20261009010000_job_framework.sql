-- [NFR-07] Job framework (01 §5.6, D-38). pg_cron runs each schedule; an HTTP job's command is
-- private.call_job, which reads the job secret and the app's address from Vault and calls
-- /api/jobs/<job> through pg_net. The endpoint records every run in public.job_run and answers at
-- once. private.job_schedule mirrors apps/web/lib/jobs/schedule.json (the deploy syncs it) so
-- public.job_health knows each job's cadence. private.app_error keeps server errors longer than
-- Vercel Hobby's one hour of logs.

-- ---------------------------------------------------------------------------
-- Schedules (written by the deploy from schedule.json; read by job_health)
-- ---------------------------------------------------------------------------

create table private.job_schedule (
  job_type      text primary key check (job_type ~ '^[a-z][a-z0-9_]*$'),
  cron          text not null,
  kind          text not null check (kind in ('http', 'sql')),
  every_minutes integer not null check (every_minutes > 0),
  updated_at    timestamptz not null default now()
);
revoke all on private.job_schedule from public, anon;
grant select on private.job_schedule to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The call pg_cron makes for an HTTP job. Off (returns null) until the job-secret workflow has
-- written both Vault secrets, so nothing calls the app before it can answer.
-- ---------------------------------------------------------------------------

create function private.call_job(p_job text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql set search_path = '' as $$
declare
  v_secret text;
  v_base   text;
begin
  if p_job is null or p_job !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'invalid job name: %', p_job;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'job_signing_secret';
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'job_base_url';
  if v_secret is null or v_base is null then
    raise notice 'jobs are off: the job-secret workflow has not run (01 §5.6)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_base, '/') || '/api/jobs/' || replace(p_job, '_', '-'),
    body := jsonb_build_object('scheduled_at', now()) || coalesce(p_payload, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
end $$;
-- Only the owner (postgres, which pg_cron runs as) may call it.
revoke all on function private.call_job(text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Health of each HTTP job for one household, from job_run (never from cron's history).
-- Security invoker, so job_run's RLS decides what the caller sees.
-- ---------------------------------------------------------------------------

create function public.job_health(p_household_id uuid)
returns table (job_type text, state text, last_ok_at timestamptz, last_run_at timestamptz, message text)
language sql stable set search_path = '' as $$
  with latest as (
    select distinct on (r.job_type) r.job_type, r.status, r.started_at, r.error
      from public.job_run r
     where r.household_id = p_household_id
     order by r.job_type, r.started_at desc
  ), last_ok as (
    -- A skipped run (nothing to do yet, or out of time with the rest left for the next call) is healthy.
    select r.job_type, max(coalesce(r.finished_at, r.started_at)) as at
      from public.job_run r
     where r.household_id = p_household_id and r.status in ('ok', 'skipped')
     group by r.job_type
  )
  select s.job_type,
         case
           when l.job_type is null then 'never'
           when l.status = 'error' then 'failing'
           when l.status = 'running' and l.started_at < now() - interval '5 minutes' then 'failing'
           when l.status = 'running' then 'running'
           when o.at is null or o.at < now() - make_interval(mins => 2 * s.every_minutes) then 'stale'
           else 'ok'
         end,
         o.at,
         l.started_at,
         case
           when l.status = 'error' then l.error
           when l.status = 'running' and l.started_at < now() - interval '5 minutes' then 'no result after 5 minutes'
         end
    from private.job_schedule s
    left join latest l on l.job_type = s.job_type
    left join last_ok o on o.job_type = s.job_type
   where s.kind = 'http'
   order by s.job_type
$$;
revoke all on function public.job_health(uuid) from public, anon;
grant execute on function public.job_health(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Server errors (Next.js onRequestError and failed jobs), kept 30 days by the purge schedule.
-- No household and no request body: route, kind, a trimmed message and Next's digest only (NFR-05).
-- ---------------------------------------------------------------------------

create table private.app_error (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  request_id  text,
  method      text,
  route       text,
  kind        text not null,
  message     text not null,
  digest      text
);
create index on private.app_error (occurred_at desc);
revoke all on private.app_error from public, anon, authenticated;
grant select, insert on private.app_error to service_role;

create function public.record_app_error(
  p_request_id text, p_method text, p_route text, p_kind text, p_message text, p_digest text
) returns void
language sql set search_path = '' as $$
  insert into private.app_error (request_id, method, route, kind, message, digest)
  values (left(p_request_id, 100), left(p_method, 10), left(p_route, 200), left(coalesce(p_kind, 'unknown'), 20),
          left(coalesce(p_message, ''), 1000), left(p_digest, 100))
$$;
revoke all on function public.record_app_error(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_app_error(text, text, text, text, text, text) to service_role;
