-- [MEAL-04] Lunch: buy or bring (WP-26, D-78). The done-when: the effective mode resolves correctly
-- across a break week: the usual lunch by weekday, a day's change, none on weekends and break days,
-- and a child on their own school year (no break that week) still choosing. Also: changing a day
-- back to the usual removes the change, new usuals clear changes that now match, and who may.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('35100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('35300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('35d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('35000000-0000-0000-0000-000000000001', 'Lunch family', 'America/Chicago'),
  ('35000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('35000000-0000-0000-0000-000000000001'), ('35000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('35000000-0000-0000-0000-000000000001', '35100000-0000-0000-0000-000000000001', 'owner'),
  ('35000000-0000-0000-0000-000000000002', '35300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('35110000-0000-0000-0000-00000000000a', '35000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('35110000-0000-0000-0000-00000000000b', '35000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('35110000-0000-0000-0000-00000000000c', '35000000-0000-0000-0000-000000000001', 'Pat', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('35dd0000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', 'Kitchen',
   '35d00000-0000-0000-0000-00000000000d');
-- The household's school year, with a break week (Mon 15 – Fri 19 Feb 2027); Leo follows his own
-- school's year, which has no break then.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('35500000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '2026–27', '2026-09-01', '2027-06-15', true),
  ('35500000-0000-0000-0000-000000000002', '35000000-0000-0000-0000-000000000001', 'Leo''s school', '2026-09-01', '2027-06-15', false);
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('35000000-0000-0000-0000-000000000001', '35500000-0000-0000-0000-000000000001', 'Winter break', 'break', '2027-02-15', '2027-02-19');
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('35000000-0000-0000-0000-000000000001', '35110000-0000-0000-0000-00000000000b', '35500000-0000-0000-0000-000000000002');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('35100000-0000-0000-0000-000000000001')
$$;
-- A child's lunch over seven days from a date: "bring bring bring bring buy - -".
create function pg_temp.week(p_member text, p_from date) returns text language sql as $$
  select string_agg(coalesce(public.lunch_mode(('35110000-0000-0000-0000-00000000000' || p_member)::uuid, d::date), '-'),
                    ' ' order by d)
    from generate_series(p_from, p_from + 6, interval '1 day') d
$$;

select pg_temp.parent();
select is(public.set_lunch_defaults('35110000-0000-0000-0000-00000000000a', '{"fri": "buy", "mon": "bring"}'),
          '{"fri": "buy", "mon": "bring"}'::jsonb, '[MEAL-04][US-703] a parent sets Maya''s usual lunches: Friday is buy');
select public.set_lunch_defaults('35110000-0000-0000-0000-00000000000b', '{"wed": "buy"}');

-- [MEAL-04] done-when: across the break week.
select is(pg_temp.week('a', '2027-02-08'), 'bring bring bring bring buy - -',
          '[MEAL-04] the week before the break: her usuals, nothing at the weekend');
select is(pg_temp.week('a', '2027-02-15'), '- - - - - - -', '... the break week: no school lunch at all');
select is(pg_temp.week('a', '2027-02-22'), 'bring bring bring bring buy - -', '... the week after: her usuals again');
select is(pg_temp.week('b', '2027-02-15'), 'bring bring buy bring bring - -',
          '... and Leo, whose school has no break then, chooses all week');
select is(public.lunch_mode('35110000-0000-0000-0000-00000000000c', '2027-02-08'), null,
          '... and an adult has no school lunch to choose');

-- [US-703] One day changed.
select is(public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-23', 'buy'), 'buy',
          '[US-703] Tuesday after the break changed to buy');
select is(pg_temp.week('a', '2027-02-22'), 'bring buy bring bring buy - -', '... only that day');
select public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-23', 'bring');
select is((select count(*)::int from public.lunch_override), 0, '... changed back to the usual: no change kept');
select throws_ok($$ select public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-16', 'buy') $$,
                 '22023', 'no school lunch that day', '[US-703] not on a break day');
select throws_ok($$ select public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-13', 'buy') $$,
                 '22023', 'no school lunch that day', '... nor at the weekend');
select throws_ok($$ select public.set_lunch_defaults('35110000-0000-0000-0000-00000000000a', '{"sat": "buy"}') $$,
                 '22023', null, 'usual lunches are Monday to Friday, buy or bring');
select throws_ok($$ select public.set_lunch_defaults('35110000-0000-0000-0000-00000000000c', '{"fri": "buy"}') $$,
                 '22023', 'school lunch is a child''s', '... and a child''s');

-- New usuals clear the changes that now match them.
select public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-24', 'buy');
select public.set_lunch_defaults('35110000-0000-0000-0000-00000000000a', '{"wed": "buy", "fri": "buy"}');
select is((select count(*)::int from public.lunch_override), 0,
          'a day changed to buy, then Wednesdays made buy: the change goes, the day stays buy');
select is(public.lunch_mode('35110000-0000-0000-0000-00000000000a', '2027-02-24'), 'buy', '... still buy');

-- The week, for the Meals page and the board.
select is((select jsonb_agg(c -> 'member_id' order by c ->> 'member_id')
             from jsonb_array_elements(public.lunch_week('35000000-0000-0000-0000-000000000001', '2027-02-14')) c),
          '["35110000-0000-0000-0000-00000000000a", "35110000-0000-0000-0000-00000000000b"]'::jsonb,
          '[MEAL-04] the week has each child, no adults');
select is((select string_agg(coalesce(x ->> 'mode', '-') || ':' || (x ->> 'day_type'), ' ' order by x ->> 'date')
             from jsonb_array_elements(public.lunch_week('35000000-0000-0000-0000-000000000001', '2027-02-21')) c,
                  jsonb_array_elements(c -> 'days') x
            where c ->> 'member_id' = '35110000-0000-0000-0000-00000000000a'),
          '-:weekend bring:school_day bring:school_day buy:school_day bring:school_day buy:school_day -:weekend',
          '... each day with its day type and lunch');

select pg_temp.as_user('35d00000-0000-0000-0000-00000000000d');
select is(jsonb_array_length(public.lunch_week('35000000-0000-0000-0000-000000000001', '2027-02-14')), 2,
          'the family''s board reads the week (for the board''s meals)');
select pg_temp.as_user('35300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.set_lunch('35110000-0000-0000-0000-00000000000a', '2027-02-23', 'buy') $$,
                 '42501', null, '[NFR-04] another family''s parent cannot change it');

select * from finish();
rollback;
