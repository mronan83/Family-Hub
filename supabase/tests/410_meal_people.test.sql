-- [MEAL-10][US-708] A meal for any mix of people (WP-62, D-87): an entry for two of four people,
-- everyone's (no people) as before, an entry's one person carried over, Copy last week keeping each
-- entry's people, another household's member refused, and the board's snapshot naming them.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('41100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('41300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('41d00000-0000-0000-0000-00000000000d', 'board@devices.example');
insert into public.household (id, name, timezone, week_start) values
  ('41000000-0000-0000-0000-000000000001', 'Mix family', 'America/Chicago', 0),
  ('41000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('41000000-0000-0000-0000-000000000001', '41100000-0000-0000-0000-000000000001', 'owner'),
  ('41000000-0000-0000-0000-000000000002', '41300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('41110000-0000-0000-0000-00000000000a', '41000000-0000-0000-0000-000000000001', 'Alex', 'adult'),
  ('41110000-0000-0000-0000-00000000000b', '41000000-0000-0000-0000-000000000001', 'Sam', 'adult'),
  ('41110000-0000-0000-0000-00000000000c', '41000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('41110000-0000-0000-0000-00000000000d', '41000000-0000-0000-0000-000000000001', 'Leo', 'child'),
  ('41110000-0000-0000-0000-000000000009', '41000000-0000-0000-0000-000000000002', 'Dee', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('41dd0000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Kitchen',
   '41d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '41d00000-0000-0000-0000-00000000000d',
    'role', 'authenticated', 'app_metadata',
    json_build_object('role', 'device', 'device_id', '41dd0000-0000-0000-0000-000000000001'))::text, true);
end $$;
-- This household week's Sunday (as the snapshot reckons it), plus n days.
create function pg_temp.d(p_n int) returns date language sql as $$
  select (now() at time zone 'America/Chicago')::date
         - extract(dow from (now() at time zone 'America/Chicago')::date)::integer + p_n
$$;
-- Adds a written-in entry for a list of people (letters a to d; empty: everyone).
create function pg_temp.add(p_id text, p_day int, p_slot text, p_text text, p_people text[]) returns jsonb
language sql as $$
  select public.add_meal_entry(jsonb_build_object(
    'id', '41e00000-0000-0000-0000-0000000000' || p_id, 'household_id', '41000000-0000-0000-0000-000000000001',
    'plan_date', pg_temp.d(p_day), 'slot', p_slot, 'free_text', p_text,
    'member_ids', (select coalesce(jsonb_agg('41110000-0000-0000-0000-00000000000' || x), '[]'::jsonb)
                     from unnest(p_people) x)))
$$;
-- A slot as it reads: "Fish fingers (Leo, Maya), Soup".
create function pg_temp.slot(p_day int, p_slot text) returns text language sql as $$
  select coalesce(string_agg(e.free_text
                             || coalesce(' (' || (select string_agg(p.display_name, ', ' order by p.display_name)
                                                    from public.meal_plan_entry_member x
                                                    join public.member p on p.id = x.member_id
                                                   where x.entry_id = e.id) || ')', ''), ', '
                             order by e.sort_order, e.created_at, e.id), '')
    from public.meal_plan_entry e
   where e.household_id = '41000000-0000-0000-0000-000000000001' and e.plan_date = pg_temp.d(p_day)
     and e.slot = p_slot
$$;

-- [MEAL-10] The carry-over: an entry planned for one person before WP-62 keeps that person, and one
-- for everyone stays everyone's. (The column is held empty since; here it is let go for the test.)
alter table public.meal_plan_entry drop constraint meal_plan_entry_member_id_moved;
insert into public.meal_plan_entry (id, household_id, plan_date, slot, member_id, free_text) values
  ('41e00000-0000-0000-0000-000000000091', '41000000-0000-0000-0000-000000000001', '2026-01-05', 'snack',
   '41110000-0000-0000-0000-00000000000d', 'Old snack'),
  ('41e00000-0000-0000-0000-000000000092', '41000000-0000-0000-0000-000000000001', '2026-01-05', 'dinner',
   null, 'Old dinner');
select is(private.carry_meal_people(), 1, '[MEAL-10] the carry-over moves each entry''s one person');
select is((select string_agg(e.free_text || ':' || coalesce(m.display_name, 'everyone') || ':'
                             || coalesce(e.member_id::text, 'emptied'), ', ' order by e.free_text)
             from public.meal_plan_entry e
             left join public.meal_plan_entry_member p on p.entry_id = e.id
             left join public.member m on m.id = p.member_id
            where e.plan_date = '2026-01-05'),
  'Old dinner:everyone:emptied, Old snack:Leo:emptied',
  '... so Leo''s snack is still Leo''s, everyone''s dinner is everyone''s, and the old column is empty');
alter table public.meal_plan_entry add constraint meal_plan_entry_member_id_moved check (member_id is null);

select pg_temp.as_user('41100000-0000-0000-0000-000000000001');
select pg_temp.add('01', 1, 'dinner', 'Fish fingers', array['c', 'd']);
select pg_temp.add('02', 1, 'dinner', 'Soup', array[]::text[]);
select pg_temp.add('03', 1, 'lunch', 'Ham sandwiches', array['b', 'c', 'c']);
select is(pg_temp.slot(1, 'dinner'), 'Fish fingers (Leo, Maya), Soup',
  '[MEAL-10][US-708] a dinner for two of four people, and one for everyone (no people)');
select is(pg_temp.slot(1, 'lunch'), 'Ham sandwiches (Maya, Sam)', '... a person ticked twice is on it once');
select is(pg_temp.add('01', 1, 'dinner', 'Fish fingers', array['a']) ->> 'duplicate', 'true',
  '... a form sent twice adds one');
select is(pg_temp.slot(1, 'dinner'), 'Fish fingers (Leo, Maya), Soup', '... and leaves its people as they were');
select is((public.add_meal_entry(jsonb_build_object('id', '41e00000-0000-0000-0000-000000000004',
            'household_id', '41000000-0000-0000-0000-000000000001', 'plan_date', pg_temp.d(2), 'slot', 'snack',
            'free_text', 'Apple', 'member_id', '41110000-0000-0000-0000-00000000000c')) ->> 'duplicate')
          || ' ' || pg_temp.slot(2, 'snack'), 'false Apple (Maya)',
  '... one person as `member_id` is still read (the form before WP-62)');
select throws_ok($$ select pg_temp.add('05', 2, 'lunch', 'Soup', array['c', '9']) $$, '22023',
  'not one of this family', '[NFR-04] not for someone in another family, alongside one of this one');
select is(pg_temp.slot(2, 'lunch'), '', '... and nothing of it is added');
select throws_ok($$ select public.add_meal_entry(jsonb_build_object('id', gen_random_uuid(),
                      'household_id', '41000000-0000-0000-0000-000000000001', 'plan_date', pg_temp.d(2),
                      'slot', 'lunch', 'free_text', 'Soup', 'member_ids', 'Maya')) $$,
  '22023', 'bad entry', '... and the people are a list of ids');

-- [MEAL-03][MEAL-10] Copy last week keeps each entry's people.
select is(public.copy_meal_week('41000000-0000-0000-0000-000000000001', pg_temp.d(0), pg_temp.d(7), 'skip'),
  '{"copied": 4, "skipped": 0, "replaced": 0}'::jsonb, '[MEAL-03] the week copied');
select is(pg_temp.slot(8, 'dinner') || ' | ' || pg_temp.slot(8, 'lunch') || ' | ' || pg_temp.slot(9, 'snack'),
  'Fish fingers (Leo, Maya), Soup | Ham sandwiches (Maya, Sam) | Apple (Maya)',
  '[MEAL-10] each copy is for the same people, everyone''s for everyone');

-- [NFR-04] The people are read only by the household's parents and boards, and written only through
-- the functions.
select throws_ok($$ insert into public.meal_plan_entry_member (household_id, entry_id, member_id) values
                    ('41000000-0000-0000-0000-000000000001', '41e00000-0000-0000-0000-000000000002',
                     '41110000-0000-0000-0000-00000000000a') $$,
  '42501', null, '[NFR-04] a parent changes an entry''s people only through add_meal_entry()');
select pg_temp.as_user('41300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.meal_plan_entry_member), 0, '[NFR-04] another family reads none of them');

-- [MEAL-10][US-708] The board's snapshot names each entry's people; member_id is the one person, for
-- a board still on the app before WP-62.
select pg_temp.as_board();
select is((select jsonb_agg(jsonb_build_object('name', e ->> 'name', 'ids', e -> 'member_ids', 'one', e -> 'member_id')
                            order by e ->> 'name')
             from jsonb_array_elements(public.board_snapshot() -> 'meals' -> 'entries') e),
  '[{"name": "Apple", "ids": ["41110000-0000-0000-0000-00000000000c"], "one": "41110000-0000-0000-0000-00000000000c"},
    {"name": "Fish fingers", "ids": ["41110000-0000-0000-0000-00000000000c", "41110000-0000-0000-0000-00000000000d"], "one": null},
    {"name": "Ham sandwiches", "ids": ["41110000-0000-0000-0000-00000000000b", "41110000-0000-0000-0000-00000000000c"], "one": null},
    {"name": "Soup", "ids": [], "one": null}]'::jsonb,
  '[MEAL-10][US-708] the board''s meals name each entry''s people (none: everyone)');

select * from finish();
rollback;
