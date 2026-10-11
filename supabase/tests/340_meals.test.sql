-- [MEAL-01][MEAL-02][MEAL-03][MEAL-08] Meals (WP-25, D-77): the library a parent keeps, the week's
-- plan (a meal or something written in, for everyone or one person, in order within a slot), moving
-- an entry, copying a week with skip or overwrite, and who may read and change what.
begin;
select plan(29);

insert into auth.users (id, email) values
  ('34100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('34300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('34d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('34000000-0000-0000-0000-000000000001', 'Meal family', 'America/Chicago'),
  ('34000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('34000000-0000-0000-0000-000000000001'), ('34000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('34000000-0000-0000-0000-000000000001', '34100000-0000-0000-0000-000000000001', 'owner'),
  ('34000000-0000-0000-0000-000000000002', '34300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('34110000-0000-0000-0000-00000000000a', '34000000-0000-0000-0000-000000000001', 'Maya', 'child'),
  ('34110000-0000-0000-0000-000000000009', '34000000-0000-0000-0000-000000000002', 'Dee', 'child');
insert into public.device (id, household_id, name, auth_user_id) values
  ('34dd0000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', 'Kitchen',
   '34d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('34100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_job() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end $$;
-- Monday, 12 Oct 2026, and the week after.
create function pg_temp.d(p_n int) returns date language sql as $$ select date '2026-10-12' + p_n $$;
create function pg_temp.add(p_id text, p_day int, p_slot text, p_meal text, p_text text,
                            p_member text default null, p_notes text default null) returns jsonb
language sql as $$
  select public.add_meal_entry(jsonb_build_object(
    'id', '34e00000-0000-0000-0000-0000000000' || p_id, 'household_id', '34000000-0000-0000-0000-000000000001',
    'plan_date', pg_temp.d(p_day), 'slot', p_slot,
    'meal_id', case when p_meal is null then null else '34f00000-0000-0000-0000-0000000000' || p_meal end,
    'free_text', p_text,
    'member_id', case when p_member is null then null else '34110000-0000-0000-0000-00000000000' || p_member end,
    'notes', p_notes))
$$;
-- A slot as it reads: "Tacos, Apple (Maya)".
create function pg_temp.slot(p_day int, p_slot text) returns text language sql as $$
  select coalesce(string_agg(coalesce(m.name, e.free_text) || coalesce(' (' || p.display_name || ')', ''), ', '
                             order by e.sort_order, e.created_at, e.id), '')
    from public.meal_plan_entry e
    left join public.meal m on m.id = e.meal_id
    left join public.member p on p.id = e.member_id
   where e.household_id = '34000000-0000-0000-0000-000000000001' and e.plan_date = pg_temp.d(p_day) and e.slot = p_slot
$$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-02] The library
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select lives_ok($$ insert into public.meal (id, household_id, name, meal_types, recipe_url) values
                    ('34f00000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', 'Tacos',
                     '{dinner}', 'https://example.com/tacos'),
                    ('34f00000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-000000000001', 'Porridge',
                     '{breakfast}', null),
                    ('34f00000-0000-0000-0000-000000000003', '34000000-0000-0000-0000-000000000001', 'Old soup',
                     '{}', null) $$,
                '[MEAL-02] a parent adds meals to the library');
select throws_ok($$ insert into public.meal (household_id, name) values ('34000000-0000-0000-0000-000000000001', 'tacos') $$,
                 '23505', null, '... one of a name, whatever its capitals');
select throws_ok($$ insert into public.meal (household_id, name, meal_types) values
                    ('34000000-0000-0000-0000-000000000001', 'Pie', '{supper}') $$,
                 '23514', null, '... good for breakfast, snack, lunch or dinner');
select throws_ok($$ insert into public.meal (household_id, name, recipe_url) values
                    ('34000000-0000-0000-0000-000000000001', 'Pie', 'javascript:alert(1)') $$,
                 '23514', null, '... with a web link for its recipe');
update public.meal set archived_at = now() where id = '34f00000-0000-0000-0000-000000000003';
select throws_ok($$ delete from public.meal where id = '34f00000-0000-0000-0000-000000000003' $$,
                 '42501', null, '... archived, never deleted');
select throws_ok($$ insert into public.meal (household_id, name) values ('34000000-0000-0000-0000-000000000002', 'Theirs') $$,
                 '42501', null, '[NFR-04] not into another family''s library');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-01][MEAL-08][US-701] The plan
-- ---------------------------------------------------------------------------------------------
select pg_temp.add('01', 0, 'dinner', '01', null, null, 'Make extra for lunch');
select pg_temp.add('02', 0, 'snack', null, 'Apple', 'a');
select pg_temp.add('03', 0, 'snack', null, 'Crackers');
select is(pg_temp.slot(0, 'dinner') || ' | ' || pg_temp.slot(0, 'snack'), 'Tacos | Apple (Maya), Crackers',
          '[MEAL-01][MEAL-08] a meal for everyone; two snacks in order, one of them Maya''s');
select is(pg_temp.add('02', 0, 'snack', null, 'Apple', 'a') ->> 'duplicate', 'true', '... a form sent twice adds one');
select is((select count(*)::int from public.meal_plan_entry where plan_date = pg_temp.d(0) and slot = 'snack'), 2,
          '... so still two snacks');
select throws_ok($$ select pg_temp.add('04', 1, 'lunch', '01', 'Tacos too') $$, '22023',
                 'a meal from the library, or something written in', '... a meal or words, not both');
select throws_ok($$ select pg_temp.add('04', 1, 'lunch', null, null) $$, '22023',
                 'a meal from the library, or something written in', '... nor neither');
select throws_ok($$ select pg_temp.add('04', 1, 'lunch', '03', null) $$, '22023', 'that meal isn''t in the library',
                 '... not an archived meal');
select throws_ok($$ select public.add_meal_entry(jsonb_build_object('id', gen_random_uuid(),
                      'household_id', '34000000-0000-0000-0000-000000000001', 'plan_date', '2026-10-13',
                      'slot', 'lunch', 'free_text', 'Soup', 'member_id', '34110000-0000-0000-0000-000000000009')) $$,
                 '22023', 'not one of this family', '... nor for someone in another family');
select throws_ok($$ select pg_temp.add('04', 1, 'supper', null, 'Soup') $$, '22023', null,
                 '... in breakfast, snack, lunch or dinner');

-- [MEAL-08] Moving within a slot.
select is(public.move_meal_entry('34e00000-0000-0000-0000-000000000003', -1), 1, 'moved one place earlier');
select is(pg_temp.slot(0, 'snack'), 'Crackers, Apple (Maya)', '... so Crackers come first');
select is(public.move_meal_entry('34e00000-0000-0000-0000-000000000003', -1), 1, '... and at the top it stays');

-- Removing: a parent deletes it.
select pg_temp.add('05', 2, 'lunch', null, 'Leftovers');
delete from public.meal_plan_entry where id = '34e00000-0000-0000-0000-000000000005';
select is(pg_temp.slot(2, 'lunch'), '', 'a parent removes an entry');
select throws_ok($$ insert into public.meal_plan_entry (id, household_id, plan_date, slot, free_text)
                    values (gen_random_uuid(), '34000000-0000-0000-0000-000000000001', '2026-10-14', 'lunch', 'x') $$,
                 '42501', null, '... and adds only through add_meal_entry()');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-03][US-702] Copying a week: skip or overwrite
-- ---------------------------------------------------------------------------------------------
select pg_temp.add('06', 1, 'breakfast', '02', null);
-- Next week's Monday dinner is already planned.
select pg_temp.add('07', 7, 'dinner', null, 'Pizza');
select is(public.copy_meal_week('34000000-0000-0000-0000-000000000001', pg_temp.d(0), pg_temp.d(7), 'skip'),
          '{"copied": 3, "skipped": 1, "replaced": 0}'::jsonb,
          '[MEAL-03] copied with skip: the snacks and Tuesday''s breakfast; Monday''s dinner skipped');
select is(pg_temp.slot(7, 'dinner') || ' | ' || pg_temp.slot(7, 'snack') || ' | ' || pg_temp.slot(8, 'breakfast'),
          'Pizza | Crackers, Apple (Maya) | Porridge', '... the planned dinner kept; the rest copied, in order');
select is(public.copy_meal_week('34000000-0000-0000-0000-000000000001', pg_temp.d(0), pg_temp.d(7), 'overwrite'),
          '{"copied": 4, "skipped": 0, "replaced": 3}'::jsonb,
          '[MEAL-03] copied again with overwrite: every slot the week has is replaced');
select is(pg_temp.slot(7, 'dinner') || ' | ' || pg_temp.slot(7, 'snack'), 'Tacos | Crackers, Apple (Maya)',
          '... so Monday''s dinner is now Tacos, and the snacks are not doubled');
select is((select notes from public.meal_plan_entry where plan_date = pg_temp.d(7) and slot = 'dinner'),
          'Make extra for lunch', '... with its notes');
select throws_ok($$ select public.copy_meal_week('34000000-0000-0000-0000-000000000001', '2026-10-12', '2026-10-12', 'skip') $$,
                 '22023', 'a week onto itself', '... not a week onto itself');

-- ---------------------------------------------------------------------------------------------
-- [NFR-04] Who may: another family's parent and the board read nothing of it to change
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('34300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.meal_plan_entry) + (select count(*)::int from public.meal), 0,
          '[NFR-04] another family sees none of it');
select throws_ok($$ select public.copy_meal_week('34000000-0000-0000-0000-000000000001', '2026-10-12', '2026-10-19', 'skip') $$,
                 '42501', null, '... and cannot copy its weeks');
select pg_temp.as_user('34d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.meal_plan_entry where plan_date = pg_temp.d(7)), 3,
          'the family''s board reads its plan (for the board''s meals)');
select pg_temp.as_job();
select throws_ok($$ select pg_temp.add('08', 3, 'lunch', null, 'Soup') $$, '42501', null,
                 '... and only a parent plans: not the job');

select * from finish();
rollback;
