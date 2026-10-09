-- [NFR-07][NFR-08][NFR-04] System Health (WP-42, D-42): each household's admins see its errors and
-- no other's; any admin sees the deployment's usage; boards and signed-out callers see neither.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'one@example.com'),
  ('c2000000-0000-0000-0000-000000000002', 'two@example.com'),
  ('c3000000-0000-0000-0000-000000000003', 'board@devices.example');
insert into public.household (id, name, timezone) values
  ('cccccccc-0000-4000-8000-000000000001', 'One', 'America/Detroit'),
  ('cccccccc-0000-4000-8000-000000000002', 'Two', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('cccccccc-0000-4000-8000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'owner'),
  ('cccccccc-0000-4000-8000-000000000002', 'c2000000-0000-0000-0000-000000000002', 'owner');
insert into public.device (household_id, name, auth_user_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'Kitchen', 'c3000000-0000-0000-0000-000000000003');

create function pg_temp.act_as(p_user uuid, p_app jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'app_metadata', p_app)::text, true);
end $$;
create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Recording -------------------------------------------------------------------------
select pg_temp.act_as_service();
select public.record_app_error('r1', 'GET', '/admin', 'render', 'Error: one broke', null,
                               'cccccccc-0000-4000-8000-000000000001');
select public.record_app_error('r2', 'POST', '/admin/members', 'action', 'Error: two broke', null,
                               'cccccccc-0000-4000-8000-000000000002');
select public.record_app_error('r3', 'GET', '/sign-in', 'render', 'Error: nobody signed in', null);
select pg_temp.act_as_owner();
select is((select string_agg(coalesce(household_id::text, 'none'), ',' order by request_id) from private.app_error
            where request_id in ('r1', 'r2', 'r3')),
  'cccccccc-0000-4000-8000-000000000001,cccccccc-0000-4000-8000-000000000002,none',
  '[NFR-07] an error is kept with its household, or with none for a signed-out page');
update private.app_error set occurred_at = now() - interval '31 days' where request_id = 'r1';
select public.record_app_error('r4', 'GET', '/admin/health', 'render', 'Error: one again', null,
                               'cccccccc-0000-4000-8000-000000000001');
select ok(not has_function_privilege('authenticated', 'public.record_app_error(text, text, text, text, text, text, uuid)', 'execute'),
  '[NFR-04] only the server records errors');

-- Reading errors ------------------------------------------------------------------------
select pg_temp.act_as('c1000000-0000-0000-0000-000000000001');
select is((select string_agg(message, ',') from public.household_errors('cccccccc-0000-4000-8000-000000000001')),
  'Error: one again', '[NFR-07] an admin sees their household''s errors from the last 30 days');
select throws_ok($$ select * from public.household_errors('cccccccc-0000-4000-8000-000000000002') $$,
  '42501', null, '[NFR-04] and not another household''s');
select throws_ok($$ select count(*) from private.app_error $$, '42501', null,
  '[NFR-04] the error table itself is closed to admins');
select pg_temp.act_as('c2000000-0000-0000-0000-000000000002');
select is((select string_agg(message, ',') from public.household_errors('cccccccc-0000-4000-8000-000000000002')),
  'Error: two broke', '[NFR-04] the other household sees only its own');
select pg_temp.act_as('c3000000-0000-0000-0000-000000000003',
  '{"role": "device", "device_id": "x"}');
select throws_ok($$ select * from public.household_errors('cccccccc-0000-4000-8000-000000000001') $$,
  '42501', null, '[NFR-04] a board sees no errors');
select pg_temp.act_as_owner();
select ok(not has_function_privilege('anon', 'public.household_errors(uuid, integer)', 'execute'),
  '[NFR-04] signed out, there are no errors to read');
select is((select count(*)::int from private.app_error where household_id is null and request_id = 'r3'), 1,
  '[NFR-07] a signed-out page''s error is kept for the operator, on no household''s page');

-- Usage ---------------------------------------------------------------------------------
insert into private.usage_sample (taken_at, source, period_start, service, unit, account_quantity, project_quantity) values
  (now() - interval '2 days', 'vercel', date_trunc('month', now()), 'Function Invocations', 'Invocations', 100, 50),
  (now() - interval '1 hour', 'vercel', date_trunc('month', now()), 'Function Invocations', 'Invocations', 2500, 1800),
  (now() - interval '1 hour', 'vercel', date_trunc('month', now()), 'Fluid Active CPU', 'hour', 0.25, 0.1);
select pg_temp.act_as('c2000000-0000-0000-0000-000000000002');
select is((select used from public.system_usage() where source = 'supabase'), pg_database_size(current_database())::numeric,
  '[NFR-08] an admin sees the database size, read live');
select is((select string_agg(service || '=' || used || '/' || project_used, ',' order by service) from public.system_usage() where source = 'vercel'),
  'Fluid Active CPU=0.25/0.1,Function Invocations=2500/1800',
  '[NFR-08] and the latest Vercel reading, for the account and for FamilyWise');
select ok((select bool_and(taken_at > now() - interval '2 hours') from public.system_usage() where source = 'vercel'),
  '[NFR-08] with when it was read, so a stale reading shows');
select throws_ok($$ select count(*) from private.usage_sample $$, '42501', null,
  '[NFR-04] the readings themselves are closed to admins');
select pg_temp.act_as('c3000000-0000-0000-0000-000000000003', '{"role": "device", "device_id": "x"}');
select throws_ok($$ select * from public.system_usage() $$, '42501', null, '[NFR-04] a board sees no usage');
select pg_temp.act_as_owner();
select ok(not has_function_privilege('anon', 'public.system_usage()', 'execute'),
  '[NFR-04] signed out, there is no usage to read');
select throws_ok($$ insert into private.usage_sample (source, period_start, service, unit, account_quantity, project_quantity)
                    values ('elsewhere', now()::date, 'X', 'u', 1, 1) $$,
  '23514', null, '[NFR-08] readings come from known sources only');
select throws_ok($$ insert into private.usage_sample (source, period_start, service, unit, account_quantity, project_quantity)
                    values ('vercel', now()::date, 'X', 'u', -1, 0) $$,
  '23514', null, '[NFR-08] and are never negative');

select * from finish();
rollback;
