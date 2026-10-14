-- [MENU-06][US-804] The school menu by section, as options (WP-64, D-94). A day's items keep their
-- option in their section; anything else is refused. lunch_week() names each child's menu and gives
-- the day's menu on every day with a school lunch, buy or bring, for the board's Meals screen.
-- Every menu here is made up.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('42100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('42d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('42000000-0000-0000-0000-000000000001', 'Options family', 'America/Chicago');
insert into public.household_settings (household_id) values ('42000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('42000000-0000-0000-0000-000000000001', '42100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('42110000-0000-0000-0000-00000000000a', '42000000-0000-0000-0000-000000000001', 'Maya', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('42dd0000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', 'Kitchen',
   '42d00000-0000-0000-0000-00000000000d');
insert into public.school_year (household_id, name, start_date, end_date, is_default) values
  ('42000000-0000-0000-0000-000000000001', '2026–27', '2026-09-01', '2027-06-15', true);

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('42100000-0000-0000-0000-000000000001')
$$;
-- Monday 1 Feb 2027's lunch at a made-up school: two entrees, the second with a side, and two milks.
create function pg_temp.monday() returns jsonb language sql as $$
  select '[{"date": "2027-02-01", "items": [
             {"name": "Beef tacos", "section": "Choice of Entree", "option": 1},
             {"name": "Chicken wrap", "section": "Choice of Entree", "option": 2},
             {"name": "Tortilla chips", "section": "Choice of Entree", "option": 2},
             {"name": "1% milk", "section": "Choice of Milk", "option": 1},
             {"name": "Chocolate milk", "section": "Choice of Milk", "option": 2}]},
           {"date": "2027-02-02", "items": [{"name": "Pasta"}]}]'::jsonb
$$;
create function pg_temp.save(p_items jsonb) returns integer language sql as $$
  select public.save_menu_days((select id from public.menu_source where name = 'Maple Elementary'),
                               jsonb_build_array(jsonb_build_object('date', '2027-02-03', 'items', p_items)), 'manual')
$$;

select pg_temp.parent();
select public.save_menu_source('42000000-0000-0000-0000-000000000001', null, 'Maple Elementary', 'manual', '{}');
select is(public.save_menu_days((select id from public.menu_source where name = 'Maple Elementary'),
                                pg_temp.monday(), 'manual'), 2,
          '[MENU-06] a typed-in week with options is stored');
select is((select items from public.school_menu_day where menu_date = '2027-02-01'),
          (pg_temp.monday() -> 0 -> 'items'),
          '... each item keeps its section, as the menu writes it, and its option');
select is((select items from public.school_menu_day where menu_date = '2027-02-02'), '[{"name": "Pasta"}]'::jsonb,
          '... and an item without them is stored as before');

-- Anything but a whole number from 1 to 60 is refused as an option.
select throws_ok($$ select pg_temp.save('[{"name": "Soup", "option": 0}]') $$, '22023',
                 'an item''s option is a number from 1 to 60', '[MENU-06] an option of 0 is refused');
select throws_ok($$ select pg_temp.save('[{"name": "Soup", "option": 61}]') $$, '22023',
                 'an item''s option is a number from 1 to 60', '... and 61');
select throws_ok($$ select pg_temp.save('[{"name": "Soup", "option": 1.5}]') $$, '22023',
                 'an item''s option is a number from 1 to 60', '... and 1.5');
select throws_ok($$ select pg_temp.save('[{"name": "Soup", "option": "1"}]') $$, '22023',
                 'an item''s option is a number from 1 to 60', '... and a word');
select is(pg_temp.save('[{"name": "Soup", "option": null}]'), 1, '... and none at all is fine');

-- [MENU-06][US-804] lunch_week(): the menu's name, and the menu on a bring day as on a buy day.
select public.set_lunch_defaults('42110000-0000-0000-0000-00000000000a', '{"mon": "buy", "tue": "bring"}');
select public.set_child_menu('42110000-0000-0000-0000-00000000000a',
                             (select id from public.menu_source where name = 'Maple Elementary'));
create temp table wk as select public.lunch_week('42000000-0000-0000-0000-000000000001', '2027-01-31') -> 0 as c;
grant all on wk to public;
select is((select c ->> 'menu_name' from wk), 'Maple Elementary', '[MENU-06] lunch_week names the child''s menu');
select is((select d -> 'menu' -> 'items' -> 1 from wk, jsonb_array_elements(c -> 'days') d
            where d ->> 'date' = '2027-02-01'),
          '{"name": "Chicken wrap", "section": "Choice of Entree", "option": 2}'::jsonb,
          '... her Monday, a buy day, has the menu with its options');
select is((select d -> 'menu' -> 'items' -> 0 ->> 'name' from wk, jsonb_array_elements(c -> 'days') d
            where d ->> 'date' = '2027-02-02'), 'Pasta',
          '... and her Tuesday, a bring day, has it too, for the board''s week');

-- The board reads the same.
select pg_temp.as_user('42d00000-0000-0000-0000-00000000000d');
select is(public.lunch_week('42000000-0000-0000-0000-000000000001', '2027-01-31') -> 0 ->> 'menu_name',
          'Maple Elementary', '[MENU-06] the family''s board reads the menu''s name');

select * from finish();
rollback;
