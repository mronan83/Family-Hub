-- [DEV-05][NFR-12] The board's read, lighter (WP-124). private.day_types() gives each member's day
-- type over a range in one query, with resolve_day_type()'s answer for every member and day (a
-- child on the household's year with a break and a snow day, a child on their own school's year that
-- ends before the household's, an adult, an archived child, an archived year, weekends and summer);
-- school_days() gives the days it gave before, through it; job_health() gives what it gave before
-- (never run, running, stuck, failing, stale, healthy, a skipped run healthy, a run that finished
-- after a later one started), reading its rows through an index.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('64100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('64d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('64000000-0000-0000-0000-000000000001', 'Day types family', 'America/Chicago');
insert into public.household_settings (household_id) values ('64000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('64000000-0000-0000-0000-000000000001', '64100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, archived_at) values
  ('64110000-0000-0000-0000-00000000000a', '64000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('64110000-0000-0000-0000-00000000000b', '64000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('64110000-0000-0000-0000-00000000000c', '64000000-0000-0000-0000-000000000001', 'Pat', 'adult', null),
  ('64110000-0000-0000-0000-00000000000e', '64000000-0000-0000-0000-000000000001', 'Old', 'child', now());
insert into public.device (id, household_id, name, auth_user_id) values
  ('64dd0000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001', 'Kitchen',
   '64d00000-0000-0000-0000-00000000000d');
-- The household's year (to 15 June) has a break from Wed 17 to Fri 19 Feb 2027 and a snow day on
-- Mon 22 Feb; Leo's own school's year ends on 10 June and has neither; an archived year covers the
-- summer and counts for nobody.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default, archived_at) values
  ('64500000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001', '2026–27', '2026-09-01', '2027-06-15', true, null),
  ('64500000-0000-0000-0000-000000000002', '64000000-0000-0000-0000-000000000001', 'Leo''s school', '2026-09-01', '2027-06-10', false, null),
  ('64500000-0000-0000-0000-000000000003', '64000000-0000-0000-0000-000000000001', 'Summer camp', '2027-06-16', '2027-08-20', true, now());
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('64000000-0000-0000-0000-000000000001', '64500000-0000-0000-0000-000000000001', 'Mid-winter break', 'break', '2027-02-17', '2027-02-19'),
  ('64000000-0000-0000-0000-000000000001', '64500000-0000-0000-0000-000000000001', 'Snow day', 'snow_day', '2027-02-22', '2027-02-22');
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('64000000-0000-0000-0000-000000000001', '64110000-0000-0000-0000-00000000000b', '64500000-0000-0000-0000-000000000002');

-- Each function's calls are counted in this transaction (pg_stat_get_xact_function_calls).
set local track_functions = 'all';
create function pg_temp.calls(p_fn regprocedure) returns bigint language sql as $$
  select coalesce(pg_stat_get_xact_function_calls(p_fn), 0) $$;

-- 1 Feb to 31 Aug 2027: term, the break, the snow day, Leo's year ending first, summer.
create temp table types as
  select * from private.day_types('64000000-0000-0000-0000-000000000001', '2027-02-01', '2027-08-31');
create temp table resolved as
  select m.id as member_id, g::date as day, public.resolve_day_type(m.id, g::date) as day_type
    from public.member m, generate_series(date '2027-02-01', date '2027-08-31', interval '1 day') g
   where m.household_id = '64000000-0000-0000-0000-000000000001';

select is((select count(*)::integer from types), 4 * 212,
          '[DEV-05-c] day_types(): every member of the household (archived too), every day of the range');
select is((select count(*)::integer
             from (select * from types except select * from resolved
                   union all select * from resolved except select * from types) x), 0,
          '[DEV-05-c] day_types() says what resolve_day_type() says for each member and day');
select is((select array_agg(distinct day_type order by day_type) from types),
          array['break', 'no_school', 'school_day', 'summer', 'weekend'],
          '[DEV-05-c] the range has each kind of day: school, a break, a snow day, weekends, summer');
select is((select string_agg(m.display_name || ' ' || t.day_type, ', ' order by m.display_name)
             from types t join public.member m on m.id = t.member_id where t.day = '2027-06-14'),
          'Leo school_day, Maya school_day, Old school_day, Pat school_day',
          '[DEV-05-c] after Leo''s own year ends, the household''s year still covers him');

-- school_days(), as the board: what it gave before (the days any member still in the household has
-- school, by resolve_day_type()), through one day_types() query and no resolve_day_type() call.
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object(
  'sub', '64d00000-0000-0000-0000-00000000000d', 'role', 'authenticated',
  'app_metadata', json_build_object('role', 'device', 'device_id', '64dd0000-0000-0000-0000-000000000001'))::text, true);
create temp table counted as
  select pg_temp.calls('public.resolve_day_type(uuid, date)') as resolved,
         pg_temp.calls('private.day_types(uuid, date, date)') as types;
create temp table days as
  select d from public.school_days('64000000-0000-0000-0000-000000000001', '2027-02-01', '2027-08-31') d;
update counted set resolved = pg_temp.calls('public.resolve_day_type(uuid, date)') - resolved,
                   types = pg_temp.calls('private.day_types(uuid, date, date)') - types;
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);

select is((select array_agg(d order by d) from days),
          (select array_agg(g::date order by g)
             from generate_series(date '2027-02-01', date '2027-08-31', interval '1 day') g
            where exists (select from public.member m
                           where m.household_id = '64000000-0000-0000-0000-000000000001'
                             and m.archived_at is null
                             and public.resolve_day_type(m.id, g::date) = 'school_day')),
          '[DEV-05-d] school_days() gives the days any member still in the household has school, as before');
select is((select (resolved, types)::text from counted), '(0,1)',
          '[DEV-05-d] school_days() asks day_types() once and resolve_day_type() not at all');

-- job_health() as it was (20261009010000_job_framework.sql), to compare with.
create function pg_temp.job_health_before(p_household_id uuid)
returns table (job_type text, state text, last_ok_at timestamptz, last_run_at timestamptz, message text)
language sql stable set search_path = '' as $$
  with latest as (
    select distinct on (r.job_type) r.job_type, r.status, r.started_at, r.error
      from public.job_run r
     where r.household_id = p_household_id
     order by r.job_type, r.started_at desc
  ), last_ok as (
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

-- Eight made-up HTTP jobs and an SQL one, each in a state of its own, with older runs behind the latest.
delete from private.job_schedule;
insert into private.job_schedule (job_type, cron, kind, every_minutes) values
  ('t_never', '0 * * * *', 'http', 60), ('t_running', '1 * * * *', 'http', 60),
  ('t_stuck', '2 * * * *', 'http', 60), ('t_failing', '3 * * * *', 'http', 60),
  ('t_stale', '*/5 * * * *', 'http', 5), ('t_ok', '4 * * * *', 'http', 60),
  ('t_skipped', '5 * * * *', 'http', 60), ('t_late', '6 * * * *', 'http', 60),
  ('t_sql', '7 * * * *', 'sql', 60);
insert into public.job_run (household_id, job_type, status, started_at, finished_at, error)
select '64000000-0000-0000-0000-000000000001', j, s, now() - make_interval(mins => m),
       case when f is not null then now() - make_interval(mins => f) end, e
  from (values
    ('t_running', 'ok', 70, 69, null), ('t_running', 'running', 2, null, null),
    ('t_stuck', 'ok', 70, 69, null), ('t_stuck', 'running', 30, null, null),
    ('t_failing', 'ok', 70, 69, null), ('t_failing', 'error', 10, 9, 'boom'),
    ('t_stale', 'ok', 60, 59, null), ('t_stale', 'error', 120, 119, 'old'),
    ('t_ok', 'error', 130, 129, 'old'), ('t_ok', 'ok', 20, 19, null), ('t_ok', 'ok', 80, 79, null),
    ('t_skipped', 'ok', 200, 199, null), ('t_skipped', 'skipped', 15, 15, null),
    -- Started first and finished last: its finish is the job's latest healthy time.
    ('t_late', 'ok', 40, 5, null), ('t_late', 'ok', 30, 25, null),
    ('t_sql', 'ok', 5, 4, null)) v (j, s, m, f, e);

select is((select array_agg(row(h.*)::text order by h.job_type)
             from public.job_health('64000000-0000-0000-0000-000000000001') h),
          (select array_agg(row(b.*)::text order by b.job_type)
             from pg_temp.job_health_before('64000000-0000-0000-0000-000000000001') b),
          '[DEV-05-e] job_health() says what it said before for each job: never, running, stuck, failing, stale, ok, a skipped run, a run that finished last');
select is((select string_agg(h.job_type || ' ' || h.state, ', ' order by h.job_type)
             from public.job_health('64000000-0000-0000-0000-000000000001') h),
          't_failing failing, t_late ok, t_never never, t_ok ok, t_running running, t_skipped ok, t_stale stale, t_stuck failing',
          '[DEV-05-e] each job''s state, the SQL job left out');
select has_index('public', 'job_run', 'job_run_last_ok_idx',
                 '[DEV-05-e] each job''s latest healthy run is a row away (job_run_last_ok_idx)');

select * from finish();
rollback;
