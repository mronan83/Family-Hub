-- [DEV-05][MEAL-09] lunch_week() works out each child's day once (WP-113), with the same answer. The
-- board reads it in every snapshot; on main it ran resolve_day_type() several times for each child's
-- day (lunch_mode() copied into each of its seven uses), the snapshot's largest cost. A family of two
-- children over a break week, a child on their own school year, a weekend, a day's change and a usual
-- buy day: each day's type, mode and change as resolve_day_type(), lunch_mode() and lunch_override say.
begin;
select plan(5);

insert into auth.users (id, email) values
  ('58100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('58d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('58000000-0000-0000-0000-000000000001', 'Lunch week family', 'America/Chicago');
insert into public.household_settings (household_id) values ('58000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('58000000-0000-0000-0000-000000000001', '58100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('58110000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('58110000-0000-0000-0000-00000000000b', '58000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('58110000-0000-0000-0000-00000000000c', '58000000-0000-0000-0000-000000000001', 'Pat', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('58dd0000-0000-0000-0000-000000000001', '58000000-0000-0000-0000-000000000001', 'Kitchen',
   '58d00000-0000-0000-0000-00000000000d');
-- The household's year has a break from Wed 17 to Fri 19 Feb 2027; Leo follows his own school's year,
-- which has none. The week looked at is Mon 15 to Sun 21 Feb: school days, break days, a weekend.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('58500000-0000-0000-0000-000000000001', '58000000-0000-0000-0000-000000000001', '2026–27', '2026-09-01', '2027-06-15', true),
  ('58500000-0000-0000-0000-000000000002', '58000000-0000-0000-0000-000000000001', 'Leo''s school', '2026-09-01', '2027-06-15', false);
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('58000000-0000-0000-0000-000000000001', '58500000-0000-0000-0000-000000000001', 'Mid-winter break', 'break', '2027-02-17', '2027-02-19');
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('58000000-0000-0000-0000-000000000001', '58110000-0000-0000-0000-00000000000b', '58500000-0000-0000-0000-000000000002');
-- Maya buys on Mondays and Thursdays; Leo has no usual (bring). Maya brings on Monday 15 instead; Leo
-- buys on Wednesday 17; Maya's Thursday change falls in the break, so it isn't one.
insert into public.member_lunch (member_id, household_id, defaults) values
  ('58110000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-000000000001', '{"mon": "buy", "thu": "buy"}');
insert into public.lunch_override (household_id, member_id, lunch_date, mode) values
  ('58000000-0000-0000-0000-000000000001', '58110000-0000-0000-0000-00000000000a', '2027-02-15', 'bring'),
  ('58000000-0000-0000-0000-000000000001', '58110000-0000-0000-0000-00000000000b', '2027-02-17', 'buy'),
  ('58000000-0000-0000-0000-000000000001', '58110000-0000-0000-0000-00000000000a', '2027-02-18', 'bring');

-- Each function's calls are counted in this transaction (pg_stat_get_xact_function_calls).
set local track_functions = 'all';
create function pg_temp.calls(p_fn regprocedure) returns bigint language sql as $$
  select coalesce(pg_stat_get_xact_function_calls(p_fn), 0) $$;

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
                  '{"sub": "58100000-0000-0000-0000-000000000001", "role": "authenticated"}', true);

create temp table counted as
  select pg_temp.calls('public.resolve_day_type(uuid, date)') as before;
create temp table week as select public.lunch_week('58000000-0000-0000-0000-000000000001', '2027-02-15') as v;
update counted set before = pg_temp.calls('public.resolve_day_type(uuid, date)') - before;

select is((select before from counted), 14::bigint,
          '[DEV-05-a] lunch_week() works out each child''s day once: 2 children × 7 days');

-- What lunch_week() says for each child and day, beside what the functions it stands for say.
create temp table said as
  select (c ->> 'member_id')::uuid as member_id, (d ->> 'date')::date as day,
         d ->> 'day_type' as day_type, d ->> 'mode' as mode, (d ->> 'changed')::boolean as changed
    from week, jsonb_array_elements(v) c, jsonb_array_elements(c -> 'days') d;

select is((select count(*)::integer from said), 14, '[DEV-05-b] each child, each day of the week');
select is((select count(*)::integer from said s
            where s.day_type is distinct from public.resolve_day_type(s.member_id, s.day)
               or s.mode is distinct from public.lunch_mode(s.member_id, s.day)
               or s.changed is distinct from (public.resolve_day_type(s.member_id, s.day) = 'school_day'
                                              and exists (select from public.lunch_override o
                                                           where o.member_id = s.member_id
                                                             and o.lunch_date = s.day))),
          0, '[DEV-05-b] each day''s type, mode and change as resolve_day_type(), lunch_mode() and lunch_override say');
-- The cases the week holds, so the comparison above has something to compare.
select is((select string_agg(to_char(day, 'Dy') || ' ' || day_type || ' ' || coalesce(mode, '-')
                             || case when changed then ' changed' else '' end, ', ' order by day)
             from said where member_id = '58110000-0000-0000-0000-00000000000a'),
          'Mon school_day bring changed, Tue school_day bring, Wed break -, Thu break -, Fri break -, Sat weekend -, Sun weekend -',
          '[DEV-05-b] Maya: her Monday change to bring, a usual bring, the break with no lunch, the weekend');
select is((select string_agg(to_char(day, 'Dy') || ' ' || day_type || ' ' || coalesce(mode, '-')
                             || case when changed then ' changed' else '' end, ', ' order by day)
             from said where member_id = '58110000-0000-0000-0000-00000000000b'),
          'Mon school_day bring, Tue school_day bring, Wed school_day buy changed, Thu school_day bring, Fri school_day bring, Sat weekend -, Sun weekend -',
          '[DEV-05-b] Leo, on his own school''s year: school all week, his Wednesday change to buy');

select * from finish();
rollback;
