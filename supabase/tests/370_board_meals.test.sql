-- [MEAL-06][US-705] Meals on the board (WP-28, D-80): the snapshot carries the household week's meals,
-- each day's in order, and each child's school lunch with the school's menu on a buy day; nothing
-- from another household or another week; and the meal tables notify the board.
begin;
select plan(8);

insert into auth.users (id, email) values
  ('37100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('37d00000-0000-0000-0000-00000000000d', 'board@devices.example');
insert into public.household (id, name, timezone, week_start) values
  ('37000000-0000-0000-0000-000000000001', 'Meal board', 'America/Chicago', 0),
  ('37000000-0000-0000-0000-000000000002', 'Next door', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('37000000-0000-0000-0000-000000000001', '37100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('37110000-0000-0000-0000-00000000000a', '37000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('37110000-0000-0000-0000-00000000000c', '37000000-0000-0000-0000-000000000001', 'Pat', 'adult');
insert into public.device (id, household_id, name, auth_user_id) values
  ('37dd0000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'Kitchen',
   '37d00000-0000-0000-0000-00000000000d');

-- Today and its household week (Sunday first), as the snapshot reckons them.
create temp table d as
  select t as today, t - extract(dow from t)::integer as week
    from (select (now() at time zone 'America/Chicago')::date as t) x;
grant select on d to public;
insert into public.school_year (household_id, name, start_date, end_date, is_default)
select '37000000-0000-0000-0000-000000000001', 'This year', week - 30, week + 60, true from d;

insert into public.meal (id, household_id, name, icon) values
  ('37a00000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'Tacos', 'utensils'),
  ('37a00000-0000-0000-0000-000000000002', '37000000-0000-0000-0000-000000000001', 'Apple slices', 'apple'),
  ('37a00000-0000-0000-0000-000000000003', '37000000-0000-0000-0000-000000000002', 'Neighbour stew', 'soup');
insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, member_id, meal_id, free_text, notes)
select x.* from d, lateral (values
  ('37e00000-0000-0000-0000-000000000001'::uuid, '37000000-0000-0000-0000-000000000001'::uuid, d.today, 'dinner', 1,
   null::uuid, '37a00000-0000-0000-0000-000000000001'::uuid, null, 'Make extra'),
  ('37e00000-0000-0000-0000-000000000002', '37000000-0000-0000-0000-000000000001', d.today, 'snack', 2,
   '37110000-0000-0000-0000-00000000000a', null, 'Crackers', null),
  ('37e00000-0000-0000-0000-000000000003', '37000000-0000-0000-0000-000000000001', d.today, 'snack', 1,
   null, '37a00000-0000-0000-0000-000000000002', null, null),
  -- Next week's, and the neighbours': not on this board this week.
  ('37e00000-0000-0000-0000-000000000004', '37000000-0000-0000-0000-000000000001', d.week + 7, 'dinner', 1,
   null, null, 'Next week', null),
  ('37e00000-0000-0000-0000-000000000005', '37000000-0000-0000-0000-000000000002', d.today, 'dinner', 1,
   null, '37a00000-0000-0000-0000-000000000003', null, null)) x;

-- Maya buys every school day; her school's menu has Monday's lunch.
insert into public.menu_source (id, household_id, name, adapter, status) values
  ('37b00000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'Maple', 'csv', 'ok');
insert into public.member_lunch (member_id, household_id, defaults, menu_source_id) values
  ('37110000-0000-0000-0000-00000000000a', '37000000-0000-0000-0000-000000000001',
   '{"mon": "buy", "tue": "buy", "wed": "buy", "thu": "buy", "fri": "buy"}', '37b00000-0000-0000-0000-000000000001');
insert into public.school_menu_day (household_id, source_id, menu_date, items, origin, is_override)
select '37000000-0000-0000-0000-000000000001', '37b00000-0000-0000-0000-000000000001', week + 1,
       '[{"name": "Cheese Pizza", "section": "Main Line"}]', 'csv', true from d;

create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '37d00000-0000-0000-0000-00000000000d',
    'role', 'authenticated', 'app_metadata',
    json_build_object('role', 'device', 'device_id', '37dd0000-0000-0000-0000-000000000001'))::text, true);
end $$;
create temp table snap (s jsonb);
grant all on snap to public;

select pg_temp.as_board();
insert into snap select public.board_snapshot();

select is((select (s -> 'meals' ->> 'week_from')::date from snap), (select week from d),
  '[MEAL-06] the board''s meals are its household week''s, from its first day');
select is((select array_agg(e ->> 'name' order by n) from snap, jsonb_array_elements(s -> 'meals' -> 'entries')
             with ordinality as x(e, n)),
  array['Apple slices', 'Crackers', 'Tacos'],
  '[MEAL-06][US-705] this week''s meals only, this household''s, in order: by day, meal, then their order');
select is((select jsonb_agg(jsonb_build_object('slot', e -> 'slot', 'member', e -> 'member_id', 'icon', e -> 'icon',
                                               'notes', e -> 'notes') order by n)
             from snap, jsonb_array_elements(s -> 'meals' -> 'entries') with ordinality as x(e, n)),
  '[{"slot": "snack", "member": null, "icon": "apple", "notes": null},
    {"slot": "snack", "member": "37110000-0000-0000-0000-00000000000a", "icon": null, "notes": null},
    {"slot": "dinner", "member": null, "icon": "utensils", "notes": "Make extra"}]'::jsonb,
  '... each with its meal of the day, who it''s for (null: everyone), the library meal''s icon and its note');
select is((select jsonb_array_length(s -> 'meals' -> 'lunch') from snap), 1,
  '[MEAL-06] school lunch is the children''s (Pat, an adult, has none)');
select is((select d2 ->> 'mode' from snap, jsonb_array_elements(s -> 'meals' -> 'lunch' -> 0 -> 'days') d2
            where (d2 ->> 'date')::date = (select week + 1 from d)), 'buy',
  '[MEAL-04] Maya''s Monday is a buy day');
select is((select d2 -> 'menu' -> 'items' -> 0 ->> 'name' from snap, jsonb_array_elements(s -> 'meals' -> 'lunch' -> 0 -> 'days') d2
            where (d2 ->> 'date')::date = (select week + 1 from d)), 'Cheese Pizza',
  '[MEAL-05] ... with what her school serves');
select is((select d2 ->> 'mode' from snap, jsonb_array_elements(s -> 'meals' -> 'lunch' -> 0 -> 'days') d2
            where (d2 ->> 'date')::date = (select week from d)), null,
  '... and Sunday has no school lunch');

-- Realtime: a meal planned on Meals reaches the board at once.
reset role;
select ok((select array_agg(tablename::text) from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public')
          @> array['meal', 'meal_plan_entry', 'member_lunch', 'lunch_override', 'school_menu_day'],
  '[DEV-05] the meal tables notify the board');

select * from finish();
rollback;
