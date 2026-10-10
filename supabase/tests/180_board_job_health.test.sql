-- [DEV-08][US-206] The board's stale line reads job health (WP-13): a paired board sees how its own
-- household's jobs are doing, through job_run's RLS, and nothing of another household's runs.
begin;
select plan(4);

insert into auth.users (id, email) values
  ('18100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('18d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('18000000-0000-0000-0000-000000000001', 'Board family', 'America/Chicago'),
  ('18000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('18000000-0000-0000-0000-000000000001', '18100000-0000-0000-0000-000000000001', 'owner');
insert into public.device (household_id, name, auth_user_id) values
  ('18000000-0000-0000-0000-000000000001', 'Kitchen', '18d00000-0000-0000-0000-00000000000d');
insert into private.job_schedule (job_type, cron, kind, every_minutes) values
  ('occurrence_gen', '23 * * * *', 'http', 60), ('day_close', '4 * * * *', 'http', 60)
on conflict (job_type) do nothing;
-- This household's planning failed; the neighbours' closing failed too.
insert into public.job_run (household_id, job_type, status, started_at, finished_at, error) values
  ('18000000-0000-0000-0000-000000000001', 'occurrence_gen', 'error', now() - interval '5 minutes', now(), 'boom'),
  ('18000000-0000-0000-0000-000000000001', 'day_close', 'ok', now() - interval '10 minutes', now() - interval '9 minutes', null),
  ('18000000-0000-0000-0000-000000000002', 'day_close', 'error', now() - interval '5 minutes', now(), 'their boom');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "18d00000-0000-0000-0000-00000000000d", "role": "authenticated"}', true);

select is((select state from public.job_health('18000000-0000-0000-0000-000000000001') where job_type = 'occurrence_gen'),
          'failing', 'a board sees that its household''s planning is failing');
select is((select state from public.job_health('18000000-0000-0000-0000-000000000001') where job_type = 'day_close'),
          'ok', '... and that its day closing is fine');
select is((select state from public.job_health('18000000-0000-0000-0000-000000000002') where job_type = 'day_close'),
          'never', 'another household''s runs are hidden from it');
select is((select count(*)::int from public.job_run where household_id = '18000000-0000-0000-0000-000000000002'),
          0, '... row by row too');

select * from finish();
rollback;
