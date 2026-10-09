-- [NFR-07][NFR-04] Job framework (WP-07, 01 §5.6): the call pg_cron makes, job health from job_run,
-- and the server error log. Vault and pg_net exist only on hosted Supabase, so this test creates
-- stand-ins for them inside its own transaction.
begin;
set local client_min_messages = warning;
select plan(22);

-- Stand-ins -----------------------------------------------------------------
create schema if not exists vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema if not exists net;
create table net.calls (id bigint generated always as identity, url text, body jsonb, headers jsonb, timeout_ms int);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.calls (url, body, headers, timeout_ms) values (url, body, headers, timeout_milliseconds) returning id
$$;

-- call_job ------------------------------------------------------------------
select is(private.call_job('heartbeat'), null::bigint,
  '[NFR-07] call_job is off until both Vault secrets exist');
select is((select count(*) from net.calls), 0::bigint, '[NFR-07] and makes no call while off');

insert into vault.decrypted_secrets values ('job_signing_secret', 's3cret'), ('job_base_url', 'https://app.example/');
select isnt(private.call_job('day_close', '{"force_failure": true}'), null::bigint,
  '[NFR-07] call_job queues a call once the secrets exist');
select is((select url from net.calls), 'https://app.example/api/jobs/day-close',
  '[NFR-07] the call goes to /api/jobs/<job> with snake_case as kebab-case');
select is((select headers ->> 'Authorization' from net.calls), 'Bearer s3cret',
  '[NFR-07] the call carries the job secret as a bearer token');
select ok((select body ? 'scheduled_at' and (body ->> 'force_failure')::boolean from net.calls),
  '[NFR-07] the body has scheduled_at and the payload');
select is((select timeout_ms from net.calls), 30000, '[NFR-07] pg_net waits at most 30 s');
select throws_ok($$ select private.call_job('Bad Name') $$, 'P0001', 'invalid job name: Bad Name',
  '[NFR-07] call_job refuses a job name that is not snake_case');

select ok(not has_function_privilege('anon', 'private.call_job(text, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'private.call_job(text, jsonb)', 'execute')
      and not has_function_privilege('service_role', 'private.call_job(text, jsonb)', 'execute'),
  '[NFR-04] only the owner (pg_cron) can call call_job');

-- job_health ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'parent1@example.com'),
  ('a2000000-0000-0000-0000-000000000002', 'parent2@example.com');
insert into public.household (id, name, timezone) values
  ('11111111-1111-1111-1111-111111111111', 'Household one', 'America/Detroit'),
  ('22222222-2222-2222-2222-222222222222', 'Household two', 'Europe/London');
insert into public.household_user (household_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000002', 'owner');

insert into private.job_schedule (job_type, cron, kind, every_minutes) values
  ('a_ok', '1 * * * *', 'http', 60),
  ('b_failing', '2 * * * *', 'http', 60),
  ('c_running', '3 * * * *', 'http', 60),
  ('d_stuck', '4 * * * *', 'http', 60),
  ('e_stale', '5 * * * *', 'http', 60),
  ('f_skipped', '6 * * * *', 'http', 60),
  ('g_never', '7 * * * *', 'http', 60),
  ('h_recovered', '8 * * * *', 'http', 60),
  ('purge', '9 3 * * *', 'sql', 1440);

insert into public.job_run (household_id, job_type, status, started_at, finished_at, error) values
  ('11111111-1111-1111-1111-111111111111', 'a_ok', 'ok', now() - interval '10 minutes', now() - interval '10 minutes', null),
  ('11111111-1111-1111-1111-111111111111', 'b_failing', 'ok', now() - interval '70 minutes', now() - interval '70 minutes', null),
  ('11111111-1111-1111-1111-111111111111', 'b_failing', 'error', now() - interval '10 minutes', now() - interval '10 minutes', 'forced failure'),
  ('11111111-1111-1111-1111-111111111111', 'c_running', 'running', now() - interval '1 minute', null, null),
  ('11111111-1111-1111-1111-111111111111', 'd_stuck', 'running', now() - interval '6 minutes', null, null),
  ('11111111-1111-1111-1111-111111111111', 'e_stale', 'ok', now() - interval '3 hours', now() - interval '3 hours', null),
  ('11111111-1111-1111-1111-111111111111', 'f_skipped', 'skipped', now() - interval '10 minutes', now() - interval '10 minutes', null),
  ('11111111-1111-1111-1111-111111111111', 'h_recovered', 'error', now() - interval '70 minutes', now() - interval '70 minutes', 'old failure'),
  ('11111111-1111-1111-1111-111111111111', 'h_recovered', 'ok', now() - interval '10 minutes', now() - interval '10 minutes', null),
  ('22222222-2222-2222-2222-222222222222', 'b_failing', 'error', now() - interval '1 minute', now() - interval '1 minute', 'household two only');

create function pg_temp.health(p_household uuid) returns text language sql as $$
  select string_agg(job_type || '=' || state, ',' order by job_type) from public.job_health(p_household)
$$;

select is(pg_temp.health('11111111-1111-1111-1111-111111111111'),
  'a_ok=ok,b_failing=failing,c_running=running,d_stuck=failing,e_stale=stale,f_skipped=ok,g_never=never,h_recovered=ok',
  '[NFR-07] job health: ok, failing, running, stuck, stale, skipped counts as healthy, never run, recovered');
select is((select message from public.job_health('11111111-1111-1111-1111-111111111111') where job_type = 'b_failing'),
  'forced failure', '[NFR-07] a failing job shows its error message');
select is((select message from public.job_health('11111111-1111-1111-1111-111111111111') where job_type = 'd_stuck'),
  'no result after 5 minutes', '[NFR-07] a run with no result after 5 minutes shows as failing');
select ok((select last_ok_at is not null from public.job_health('11111111-1111-1111-1111-111111111111') where job_type = 'b_failing'),
  '[NFR-07] a failing job still shows when it last succeeded');
select is((select count(*) from public.job_health('11111111-1111-1111-1111-111111111111') where job_type = 'purge'), 0::bigint,
  '[NFR-07] SQL-only schedules have no job_run rows and are not listed');

-- Act as a household's admin the way PostgREST does.
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('a1000000-0000-0000-0000-000000000001');
select is((select state from public.job_health('11111111-1111-1111-1111-111111111111') where job_type = 'b_failing'),
  'failing', '[NFR-07] an admin sees their household''s job health');
reset role;
select pg_temp.act_as('a2000000-0000-0000-0000-000000000002');
select is(pg_temp.health('11111111-1111-1111-1111-111111111111'),
  'a_ok=never,b_failing=never,c_running=never,d_stuck=never,e_stale=never,f_skipped=never,g_never=never,h_recovered=never',
  '[NFR-04] another household''s admin learns nothing about its runs');
reset role;
set local role anon;
select throws_ok($$ select * from public.job_health('11111111-1111-1111-1111-111111111111') $$, '42501', null,
  '[NFR-04] anon cannot read job health');
reset role;

-- record_app_error ----------------------------------------------------------
set local role service_role;
select lives_ok($$ select public.record_app_error('req-1', 'GET', '/board', 'render', repeat('x', 2000), 'digest-1') $$,
  '[NFR-07] the server records an error');
reset role;
select is((select length(message) from private.app_error where request_id = 'req-1'), 1000,
  '[NFR-07] error messages are trimmed to 1000 characters');
set local role authenticated;
select throws_ok($$ select public.record_app_error('x', 'GET', '/', 'render', 'm', null) $$, '42501', null,
  '[NFR-04] signed-in users cannot write the error log');
select throws_ok($$ select * from private.app_error $$, '42501', null,
  '[NFR-04] signed-in users cannot read the error log');
reset role;
set local role anon;
select throws_ok($$ select public.record_app_error('x', 'GET', '/', 'render', 'm', null) $$, '42501', null,
  '[NFR-04] anon cannot write the error log');
reset role;

select * from finish();
rollback;
