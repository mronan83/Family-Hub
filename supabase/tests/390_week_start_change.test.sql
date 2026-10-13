-- [ACC-08][US-110] The day the week starts on, changed from the next week (WP-57, D-84): the switch day
-- is the new start's first day on or after the end of the week now running; an admin of the household
-- sets or cancels it, nobody else; it applies once its day has come, and not before.
begin;
set local client_min_messages = warning;
select plan(13);

insert into auth.users (id, email) values
  ('39100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('39100000-0000-0000-0000-000000000002', 'other@example.com'),
  ('39d00000-0000-0000-0000-00000000000a', null);
insert into public.household (id, name, timezone, week_start) values
  ('39000000-0000-0000-0000-000000000001', 'Week family', 'America/New_York', 0),
  ('39000000-0000-0000-0000-000000000002', 'Other family', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('39000000-0000-0000-0000-000000000001'), ('39000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('39000000-0000-0000-0000-000000000001', '39100000-0000-0000-0000-000000000001', 'owner'),
  ('39000000-0000-0000-0000-000000000002', '39100000-0000-0000-0000-000000000002', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('39dd0000-0000-0000-0000-00000000000a', '39000000-0000-0000-0000-000000000001', 'Kitchen',
   '39d00000-0000-0000-0000-00000000000a');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- The switch day, on fixed dates (Tuesday 13 October 2026; Sunday the 11th).
select is(private.week_start_switch_day('2026-10-13', 0::smallint, 1::smallint), '2026-10-19'::date,
  '[ACC-08] Sunday to Monday on a Tuesday: this week runs to Saturday, a one-day week, then Monday the 19th');
select is(private.week_start_switch_day('2026-10-13', 1::smallint, 0::smallint), '2026-10-25'::date,
  '[ACC-08] Monday to Sunday on a Tuesday: this week runs to Sunday the 18th, then Monday to Saturday, then Sunday the 25th');
select is(private.week_start_switch_day('2026-10-11', 0::smallint, 1::smallint), '2026-10-19'::date,
  '[ACC-08] on the first day of a week, that whole week still runs as it is');
select is(private.week_start_switch_day('2026-10-13', 0::smallint, 0::smallint), null,
  '[ACC-08] the same day: nothing to change');

create temp table expect_on as
  select private.week_start_switch_day(pg_temp.today(), 0::smallint, 1::smallint)::text as on_day;
grant select on expect_on to authenticated;
select pg_temp.as_user('39100000-0000-0000-0000-000000000001');
select is(public.set_week_start('39000000-0000-0000-0000-000000000001', 1::smallint) ->> 'next_on',
  (select on_day from expect_on),
  '[ACC-08][US-110] an admin asks for Monday: it waits for the next week');
select is((select week_start from public.household where id = '39000000-0000-0000-0000-000000000001'),
  0::smallint, '[ACC-08] and the week now running keeps its start');
select is(public.apply_week_start('39000000-0000-0000-0000-000000000001'), false,
  '[ACC-08] before its day, nothing applies');

select throws_ok($$ select public.set_week_start('39000000-0000-0000-0000-000000000001', 7::smallint) $$,
  '22023', null, '[ACC-08] a day of the week is 0 to 6');

select pg_temp.as_user('39100000-0000-0000-0000-000000000002');
select throws_ok($$ select public.set_week_start('39000000-0000-0000-0000-000000000001', 3::smallint) $$,
  '42501', null, '[ACC-08][NFR-04] another household''s admin can''t change it');
select pg_temp.as_user('39d00000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.set_week_start('39000000-0000-0000-0000-000000000001', 3::smallint) $$,
  '42501', null, '[ACC-08][NFR-04] nor can a board');

-- Its day comes (moved to today here): it applies once, and the waiting change is gone.
select pg_temp.as_owner();
update public.household_settings set week_start_next_on = pg_temp.today()
 where household_id = '39000000-0000-0000-0000-000000000001';
select pg_temp.as_user('39100000-0000-0000-0000-000000000001');
select is(public.apply_week_start('39000000-0000-0000-0000-000000000001'), true,
  '[ACC-08] on its day, the change applies');
select pg_temp.as_owner();
select is((select week_start::int || ',' || coalesce(s.week_start_next::text, '-')
             from public.household h join public.household_settings s on s.household_id = h.id
            where h.id = '39000000-0000-0000-0000-000000000001'),
  '1,-', '[ACC-08] the week now starts on Monday, and nothing waits');

-- Asking for the day it already is cancels a waiting change.
select pg_temp.as_user('39100000-0000-0000-0000-000000000001');
select public.set_week_start('39000000-0000-0000-0000-000000000001', 4::smallint);
select is(public.set_week_start('39000000-0000-0000-0000-000000000001', 1::smallint) -> 'next',
  'null'::jsonb, '[ACC-08] choosing the current day again cancels the change');

select * from finish();
rollback;
