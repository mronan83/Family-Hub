-- [NFR-16-m][D-128] The goal form's live summaries name the day the school is closed (WP-101): the
-- preview's facts give the school calendar's closures on the weekdays around today, by name and kind,
-- for the goal's person (the school year they follow) or, on a family goal, for each child and the
-- household's default year. Another household's calendar never shows. Each closure lists the routines
-- that would have been due that day were the school open (D-128).
begin;
select plan(10);

insert into auth.users (id, email) values
  ('53100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('53000000-0000-0000-0000-000000000001', 'Closure family', 'America/Chicago', 1),
  ('53000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 1);
insert into public.household_settings (household_id) values
  ('53000000-0000-0000-0000-000000000001'), ('53000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('53000000-0000-0000-0000-000000000001', '53100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('53110000-0000-0000-0000-00000000000a', '53000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('53110000-0000-0000-0000-00000000000b', '53000000-0000-0000-0000-000000000001', 'Leo', 'child', null);

create function pg_temp.today() returns date language sql as $$
  select private.household_today('53000000-0000-0000-0000-000000000001')
$$;
-- A weekday near today, so the test passes on any day of the week.
create function pg_temp.weekday(p_from date) returns date language sql as $$
  select d::date from generate_series(p_from, p_from + 6, interval '1 day') d
   where extract(isodow from d) < 6 order by d limit 1
$$;
create function pg_temp.parent() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '53100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
end $$;

-- The default year (Maya follows it) closes on a weekday next week; Leo's own school closes another
-- day; a Saturday closure and the neighbours' closure never show.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('53500000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'This year',
   pg_temp.today() - 100, pg_temp.today() + 200, true),
  ('53500000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000001', 'Leo''s school',
   pg_temp.today() - 100, pg_temp.today() + 200, false),
  ('53500000-0000-0000-0000-000000000009', '53000000-0000-0000-0000-000000000002', 'Theirs',
   pg_temp.today() - 100, pg_temp.today() + 200, true);
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('53000000-0000-0000-0000-000000000001', '53110000-0000-0000-0000-00000000000b',
   '53500000-0000-0000-0000-000000000002');
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('53000000-0000-0000-0000-000000000001', '53500000-0000-0000-0000-000000000001', 'Teacher planning day',
   'teacher_day', pg_temp.weekday(pg_temp.today() + 7), pg_temp.weekday(pg_temp.today() + 7)),
  ('53000000-0000-0000-0000-000000000001', '53500000-0000-0000-0000-000000000002', 'Snow day',
   'snow_day', pg_temp.weekday(pg_temp.today() + 14), pg_temp.weekday(pg_temp.today() + 14)),
  ('53000000-0000-0000-0000-000000000001', '53500000-0000-0000-0000-000000000001', 'Saturday fair',
   'other', (select d::date from generate_series(pg_temp.today(), pg_temp.today() + 6, interval '1 day') d
              where extract(isodow from d) = 6),
   (select d::date from generate_series(pg_temp.today(), pg_temp.today() + 6, interval '1 day') d
     where extract(isodow from d) = 6)),
  ('53000000-0000-0000-0000-000000000002', '53500000-0000-0000-0000-000000000009', 'Their day off',
   'holiday', pg_temp.weekday(pg_temp.today() + 7), pg_temp.weekday(pg_temp.today() + 7));

-- Maya's routines: homework every school day, piano on Mondays and Wednesdays, a weekend job and a
-- to-do; Leo's reading every school day.
insert into public.chore (id, household_id, title, kind, points, schedule, day_types, created_by, start_date) values
  ('53c00000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'Homework home', 'chore', 5,
   '{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}', array['school_day'], '53100000-0000-0000-0000-000000000001', pg_temp.today() - 30),
  ('53c00000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000001', 'Piano', 'chore', 5,
   '{"freq": "weekly", "by_weekday": [1, 3]}', array['school_day'], '53100000-0000-0000-0000-000000000001', pg_temp.today() - 30),
  ('53c00000-0000-0000-0000-000000000003', '53000000-0000-0000-0000-000000000001', 'Weekend job', 'chore', 5,
   '{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}', array['weekend'], '53100000-0000-0000-0000-000000000001', pg_temp.today() - 30),
  ('53c00000-0000-0000-0000-000000000004', '53000000-0000-0000-0000-000000000001', 'Reading', 'chore', 5,
   '{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}', array['school_day'], '53100000-0000-0000-0000-000000000001', pg_temp.today() - 30);
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('53000000-0000-0000-0000-000000000001', '53c00000-0000-0000-0000-000000000001', '53110000-0000-0000-0000-00000000000a'),
  ('53000000-0000-0000-0000-000000000001', '53c00000-0000-0000-0000-000000000002', '53110000-0000-0000-0000-00000000000a'),
  ('53000000-0000-0000-0000-000000000001', '53c00000-0000-0000-0000-000000000003', '53110000-0000-0000-0000-00000000000a'),
  ('53000000-0000-0000-0000-000000000001', '53c00000-0000-0000-0000-000000000004', '53110000-0000-0000-0000-00000000000b');

create function pg_temp.facts(p_member text) returns jsonb language sql as $$
  select public.goal_preview_facts(jsonb_build_object(
    'household_id', '53000000-0000-0000-0000-000000000001',
    'id', '53900000-0000-0000-0000-000000000001',
    'member_id', p_member,
    'start_date', pg_temp.today(),
    'end_date', null,
    'repeat', 'week',
    'rules', '[]'::jsonb))
$$;

select pg_temp.parent();

select is(
  (select jsonb_agg(c - 'member_id' - 'due') from jsonb_array_elements(pg_temp.facts('53110000-0000-0000-0000-00000000000a') -> 'closures') c),
  jsonb_build_array(jsonb_build_object('date', pg_temp.weekday(pg_temp.today() + 7),
                                       'name', 'Teacher planning day', 'kind', 'teacher_day')),
  '[NFR-16-m] a child''s goal: the closures of the school year they follow, by name and kind');
select is(
  (select jsonb_agg(c ->> 'name') from jsonb_array_elements(pg_temp.facts('53110000-0000-0000-0000-00000000000b') -> 'closures') c),
  '["Snow day"]'::jsonb,
  '[NFR-16-m] a child at another school: their own school''s closures');
select is(
  (select jsonb_agg(distinct c ->> 'member_id') from jsonb_array_elements(pg_temp.facts('53110000-0000-0000-0000-00000000000a') -> 'closures') c),
  '["53110000-0000-0000-0000-00000000000a"]'::jsonb,
  '[NFR-16-m] each closure names the person it is for');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.facts(null) -> 'closures') c
    where c ->> 'member_id' = '53110000-0000-0000-0000-00000000000a' and c ->> 'name' = 'Teacher planning day'),
  1, '[NFR-16-m] a family goal: Maya''s closures');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.facts(null) -> 'closures') c
    where c ->> 'member_id' = '53110000-0000-0000-0000-00000000000b' and c ->> 'name' = 'Snow day'),
  1, '[NFR-16-m] a family goal: Leo''s school''s closures');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.facts(null) -> 'closures') c
    where c -> 'member_id' = 'null'::jsonb and c ->> 'name' = 'Teacher planning day'),
  1, '[NFR-16-m] a family goal: the household''s default year, for the family');
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.facts(null) -> 'closures') c
    where c ->> 'name' in ('Saturday fair', 'Their day off')),
  0, '[NFR-16-m] no weekend day, and never another household''s calendar');

create function pg_temp.due(p_member text) returns text[] language sql as $$
  select array(select d ->> 'chore_id' from jsonb_array_elements(pg_temp.facts(p_member) -> 'closures') c,
                                            jsonb_array_elements(c -> 'due') d
                where c ->> 'name' = 'Teacher planning day' and c ->> 'member_id' is not distinct from p_member
                order by 1)
$$;
select ok('53c00000-0000-0000-0000-000000000001' = any (pg_temp.due('53110000-0000-0000-0000-00000000000a'))
          and not '53c00000-0000-0000-0000-000000000003' = any (pg_temp.due('53110000-0000-0000-0000-00000000000a'))
          and not '53c00000-0000-0000-0000-000000000004' = any (pg_temp.due('53110000-0000-0000-0000-00000000000a')),
  '[NFR-16-m] a closed day lists the person''s routines that would have been due were the school open, not a weekend-only one nor another child''s');
select is('53c00000-0000-0000-0000-000000000002' = any (pg_temp.due('53110000-0000-0000-0000-00000000000a')),
          extract(isodow from pg_temp.weekday(pg_temp.today() + 7)) in (1, 3),
  '[NFR-16-m] a routine only on some weekdays is listed only on those days');
select ok('53c00000-0000-0000-0000-000000000004' = any (pg_temp.due(null))
          and '53c00000-0000-0000-0000-000000000001' = any (pg_temp.due(null)),
  '[NFR-16-m] a family goal''s default-year closure lists any routine that would have been due');

select * from finish();
rollback;
