-- [MEAL-07][MEAL-19] Meals → groceries (WP-105, D-138): a meal's ingredients, checked by the database;
-- a week's meals added to the list through the one way in; a meal taken off the plan taking its share
-- off the list; a meal's recipe files, in the household's own storage; a board's recipes.
begin;
select plan(28);

insert into auth.users (id, email) values ('55100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone) values
  ('55000000-0000-0000-0000-000000000001', 'Meal family', 'America/Chicago'),
  ('55000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values ('55000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('55000000-0000-0000-0000-000000000001', '55100000-0000-0000-0000-000000000001', 'owner');
insert into auth.users (id, email) values
  ('55300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('55d00000-0000-0000-0000-00000000000d', null),
  ('55d00000-0000-0000-0000-00000000000e', null);
insert into public.household_user (household_id, user_id, role) values
  ('55000000-0000-0000-0000-000000000002', '55300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('55dd0000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', 'Kitchen', '55d00000-0000-0000-0000-00000000000d'),
  ('55dd0000-0000-0000-0000-000000000002', '55000000-0000-0000-0000-000000000002', 'Theirs', '55d00000-0000-0000-0000-00000000000e');

create function pg_temp.parent() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '55100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.meal(p_id text, p_name text, p_ingredients jsonb) returns void language sql as $$
  insert into public.meal (id, household_id, name, ingredients)
  values (('55f00000-0000-0000-0000-0000000000' || p_id)::uuid, '55000000-0000-0000-0000-000000000001', p_name,
          p_ingredients) $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-07-a] A meal's ingredients
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select lives_ok($$ select pg_temp.meal('01', 'Tacos', '[{"name": "Ground beef", "amount": "1 lb"},
                     {"name": "Tortillas", "amount": "8"}, {"name": "Olive oil", "have": true}, {"name": "Cheddar", "amount": null}]') $$,
                '[MEAL-07-a] a meal keeps its ingredients: a name, an amount to buy, and we usually have it');
select is((select ingredients -> 2 ->> 'have' from public.meal where name = 'Tacos'), 'true', '... as written');
select throws_ok($$ select pg_temp.meal('02', 'Soup', '[{"amount": "1 can"}]') $$, '23514', null,
                 '... a row with no name is refused');
select throws_ok($$ select pg_temp.meal('03', 'Stew', jsonb_build_array(jsonb_build_object('name', repeat('x', 81)))) $$,
                 '23514', null, '... and a name over 80 characters');
select throws_ok($$ select pg_temp.meal('04', 'Feast',
                     (select jsonb_agg(jsonb_build_object('name', 'Thing ' || n)) from generate_series(1, 61) n)) $$,
                 '23514', null, '... and more than 60 rows');
select throws_ok($$ select pg_temp.meal('05', 'Pie', '[{"name": "Flour", "have": "yes"}]') $$, '23514', null,
                 '... and a we-usually-have-it that isn''t true or false');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-19-b] The week's meals onto the list
-- ---------------------------------------------------------------------------------------------
select pg_temp.meal('06', 'Chili', '[{"name": "Onions", "amount": "2"}]');
reset role;
insert into public.meal (id, household_id, name) values
  ('55f00000-0000-0000-0000-000000000099', '55000000-0000-0000-0000-000000000002', 'Their stew');
insert into public.meal_plan_entry (id, household_id, plan_date, slot, meal_id) values
  ('55e00000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', '2026-10-20', 'dinner', '55f00000-0000-0000-0000-000000000001'),
  ('55e00000-0000-0000-0000-000000000002', '55000000-0000-0000-0000-000000000001', '2026-10-21', 'dinner', '55f00000-0000-0000-0000-000000000006'),
  ('55e00000-0000-0000-0000-000000000003', '55000000-0000-0000-0000-000000000001', '2026-10-22', 'dinner', '55f00000-0000-0000-0000-000000000001'),
  ('55e00000-0000-0000-0000-000000000099', '55000000-0000-0000-0000-000000000002', '2026-10-20', 'dinner', '55f00000-0000-0000-0000-000000000099');
create function pg_temp.from_meal(p_entry text, p_label text, p_name text, p_key text, p_amount text) returns jsonb
language sql as $$
  select jsonb_build_object('name', p_name, 'key', p_key, 'amount', p_amount, 'reason',
    jsonb_build_object('kind', 'meal', 'meal_plan_entry_id', '55e00000-0000-0000-0000-0000000000' || p_entry,
                       'label', p_label)) $$;
create function pg_temp.reasons(p_key text) returns text language sql as $$
  select coalesce(string_agg(coalesce(r.label, r.kind) || '=' || coalesce(r.amount, '-'), ', ' order by r.label), '')
    from public.grocery_item_reason r join public.grocery_item i on i.id = r.item_id
   where i.household_id = '55000000-0000-0000-0000-000000000001' and i.name_key = p_key and i.status = 'open' $$;
select pg_temp.parent();
select lives_ok($$ select public.add_groceries('55000000-0000-0000-0000-000000000001', jsonb_build_array(
                     pg_temp.from_meal('01', 'Tacos, Tue', 'Onion', 'onion', '1'),
                     pg_temp.from_meal('01', 'Tacos, Tue', 'Ground beef', 'ground beef', '1 lb'),
                     pg_temp.from_meal('02', 'Chili, Wed', 'Onions', 'onion', '2'),
                     pg_temp.from_meal('03', 'Tacos, Thu', 'Tortillas', 'tortilla', '8'))) $$,
                '[MEAL-19-b] the week''s ingredients go on the list, each meal a reason');
select is(pg_temp.reasons('onion'), 'Chili, Wed=2, Tacos, Tue=1', '... merged into one item, both meals its reasons');
select throws_ok($$ select public.add_groceries('55000000-0000-0000-0000-000000000001', jsonb_build_array(
                     pg_temp.from_meal('99', 'Their stew', 'Beans', 'bean', null))) $$, '22023', null,
                 '... another family''s meal is refused');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-19-c] A meal taken off the plan takes its share off
-- ---------------------------------------------------------------------------------------------
select lives_ok($$ delete from public.meal_plan_entry where id = '55e00000-0000-0000-0000-000000000001' $$,
                '[MEAL-19-c] Tuesday''s tacos come off the plan');
select is(pg_temp.reasons('onion'), 'Chili, Wed=2', '... the onions lose the tacos'' amount and reason');
select is((select status from public.grocery_item where name_key = 'ground beef'), 'removed',
          '... the beef only they needed is removed');
select is((select array_agg(kind order by at, kind) from public.grocery_item_event e join public.grocery_item i on i.id = e.item_id
            where i.name_key = 'ground beef'), array['added', 'changed', 'removed'], '... each change in its history');
select public.set_groceries_ticked(array[(select id from public.grocery_item where name_key = 'tortilla')], true);
select lives_ok($$ select public.update_meal_entry(jsonb_build_object(
                     'id', '55e00000-0000-0000-0000-000000000003', 'household_id', '55000000-0000-0000-0000-000000000001',
                     'plan_date', '2026-10-22', 'slot', 'dinner', 'meal_id', '55f00000-0000-0000-0000-000000000006')) $$,
                '... Thursday changed to another meal');
select is((select status from public.grocery_item where name_key = 'tortilla'), 'ticked',
          '... leaves a ticked item as it is');
select lives_ok($$ select public.update_meal_entry(jsonb_build_object(
                     'id', '55e00000-0000-0000-0000-000000000002', 'household_id', '55000000-0000-0000-0000-000000000001',
                     'plan_date', '2026-10-21', 'slot', 'dinner', 'free_text', 'Out for pizza')) $$,
                '... Wednesday changed to something written in');
select is((select status from public.grocery_item where name_key = 'onion' order by created_at desc limit 1), 'removed',
          '... takes the chili''s onions off too');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-25-f] A meal's recipe files, in the household's own storage
-- ---------------------------------------------------------------------------------------------
create function pg_temp.as_user(p_sub text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.file(p_id text, p_path text, p_kind text default 'photo', p_size integer default 1200000)
returns void language sql as $$
  insert into public.meal_recipe_file (id, household_id, meal_id, kind, name, path, size_bytes)
  values (('55a00000-0000-0000-0000-0000000000' || p_id)::uuid, '55000000-0000-0000-0000-000000000001',
          '55f00000-0000-0000-0000-000000000001', p_kind, 'Grandma''s card.jpg', p_path, p_size) $$;
select pg_temp.parent();
select lives_ok($$ select pg_temp.file('01', '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/a.jpg') $$,
                '[MEAL-25-f] a parent adds a photo to a meal''s recipe');
select lives_ok($$ select pg_temp.file('02', '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/b.pdf', 'pdf', 10485760) $$,
                '... and a PDF of 10 MB');
select throws_ok($$ select pg_temp.file('03', '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/c.pdf', 'pdf', 10485761) $$,
                 '23514', null, '... not one over 10 MB');
select throws_ok($$ select pg_temp.file('04', '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/d.doc', 'word') $$,
                 '23514', null, '... a photo or a PDF only');
select throws_ok($$ select pg_temp.file('05', '55000000-0000-0000-0000-000000000002/x/e.jpg') $$,
                 '23514', null, '... kept in its own household''s folder only');
select lives_ok($$ insert into storage.objects (bucket_id, name)
                   values ('recipes', '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/a.jpg') $$,
                '... and stores it in its household''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name)
                    values ('recipes', '55000000-0000-0000-0000-000000000002/x/f.jpg') $$,
                 '42501', null, '... never in another family''s');
reset role;
insert into public.meal_plan_entry (id, household_id, plan_date, slot, meal_id) values
  ('55e00000-0000-0000-0000-000000000004', '55000000-0000-0000-0000-000000000001', '2026-10-24', 'dinner', '55f00000-0000-0000-0000-000000000001');
select pg_temp.as_user('55d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.meal_recipe_file) + (select count(*)::int from storage.objects where bucket_id = 'recipes'),
          3, '... the household''s board reads its files');
select is((select jsonb_array_length(x -> 'files') from jsonb_array_elements(public.board_recipes('2026-10-19', '2026-10-25')) x
            where x ->> 'name' = 'Tacos'), 2,
          '[MEAL-26] board_recipes gives a board each planned meal''s recipe, with its files');
select pg_temp.as_user('55d00000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.meal_recipe_file) + (select count(*)::int from storage.objects where bucket_id = 'recipes'),
          0, '[MEAL-25-f] another family''s board reads none of them');
select pg_temp.as_user('55300000-0000-0000-0000-000000000003');
select throws_ok($$ insert into public.meal_recipe_file (household_id, meal_id, kind, name, path, size_bytes)
                    values ('55000000-0000-0000-0000-000000000001', '55f00000-0000-0000-0000-000000000001', 'photo', 'x.jpg',
                            '55000000-0000-0000-0000-000000000001/55f00000-0000-0000-0000-000000000001/x.jpg', 10) $$,
                 '42501', null, '... and another family''s parent adds none');

select * from finish();
rollback;
