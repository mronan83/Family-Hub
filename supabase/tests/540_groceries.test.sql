-- [MEAL-18][MEAL-20][MEAL-23][MEAL-24] The grocery list (WP-104, D-138): the household's own list,
-- categories and stores; the one way in that merges an add into the open item of the same thing;
-- tick, untick and remove with the history kept; moving several, which teaches the household's words;
-- removing a category; and who may read and change what.
begin;
select plan(47);

insert into auth.users (id, email) values
  ('54100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('54300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('54d00000-0000-0000-0000-00000000000d', null),
  ('54d00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone) values
  ('54000000-0000-0000-0000-000000000001', 'Grocery family', 'America/Chicago'),
  ('54000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('54000000-0000-0000-0000-000000000001'), ('54000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('54000000-0000-0000-0000-000000000001', '54100000-0000-0000-0000-000000000001', 'owner'),
  ('54000000-0000-0000-0000-000000000002', '54300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('54dd0000-0000-0000-0000-000000000001', '54000000-0000-0000-0000-000000000001', 'Kitchen',
   '54d00000-0000-0000-0000-00000000000d'),
  ('54dd0000-0000-0000-0000-000000000002', '54000000-0000-0000-0000-000000000002', 'Their kitchen',
   '54d00000-0000-0000-0000-00000000000e');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('54100000-0000-0000-0000-000000000001') $$;
create function pg_temp.neighbour() returns void language sql as $$
  select pg_temp.as_user('54300000-0000-0000-0000-000000000003') $$;
create function pg_temp.board() returns void language sql as $$
  select pg_temp.as_user('54d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.their_board() returns void language sql as $$
  select pg_temp.as_user('54d00000-0000-0000-0000-00000000000e') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.cat(p_key text) returns uuid language sql as $$
  select id from public.grocery_category
   where household_id = '54000000-0000-0000-0000-000000000001' and starter_key = p_key $$;
create function pg_temp.add(p_name text, p_key text, p_amount text default null, p_cat text default null)
returns jsonb language sql as $$
  select public.add_groceries('54000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object(
    'name', p_name, 'key', p_key, 'amount', p_amount, 'category_id', pg_temp.cat(p_cat)))) $$;
create function pg_temp.item(p_key text) returns uuid language sql as $$
  select id from public.grocery_item
   where household_id = '54000000-0000-0000-0000-000000000001' and name_key = p_key
   order by (status = 'open') desc, created_at desc limit 1 $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-23-c] The starter set
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_owner();
select is((select array_agg(name order by sort_order) from public.grocery_category
            where household_id = '54000000-0000-0000-0000-000000000001'),
          array['Produce', 'Dairy & Eggs', 'Bakery', 'Meat & Seafood', 'Pantry', 'Frozen', 'Snacks', 'Household', 'Other'],
          '[MEAL-23-c] a new household starts with the starter categories, Other last');
select is((select count(*)::int from public.grocery_category
            where household_id = '54000000-0000-0000-0000-000000000001' and is_other), 1, '... and one Other');
select is((select array_agg(name order by sort_order) from public.grocery_store
            where household_id = '54000000-0000-0000-0000-000000000001'),
          array['Costco', 'Kroger', 'Aldi', 'Walmart', 'Meijer', 'Sam''s Club'], '... the six starter stores');
select is((select count(*)::int from public.grocery_list where household_id = '54000000-0000-0000-0000-000000000001'),
          1, '... and its one list');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-20-d] The one way in
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select is((pg_temp.add('Onions', 'onion', '×2', 'produce') -> 0 ->> 'merged')::boolean, false,
          '[MEAL-20-d] the first add is a new item');
select is((pg_temp.add('onion', 'onion', '1') -> 0 ->> 'merged')::boolean, true,
          '... the same thing again joins it');
select is((select count(*)::int from public.grocery_item
            where household_id = '54000000-0000-0000-0000-000000000001' and name_key = 'onion'), 1,
          '... one item');
select is((select array_agg(amount order by amount) from public.grocery_item_reason
            where item_id = pg_temp.item('onion')), array['1', '×2'], '... with both reasons and their amounts');
select is((select name from public.grocery_item where id = pg_temp.item('onion')), 'Onions',
          '... keeping the first name');
select is((select array_agg(kind order by at, kind) from public.grocery_item_event where item_id = pg_temp.item('onion')),
          array['added', 'merged'], '... an added and a merged event');
select is((select category_id from public.grocery_item where id = pg_temp.item('onion')), pg_temp.cat('produce'),
          '... in its category');
select pg_temp.add('Mystery', 'mystery');
select is((select category_id from public.grocery_item where id = pg_temp.item('mystery')), pg_temp.cat('other'),
          '... an item with no category goes to Other');
select public.add_groceries('54000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('name', 'Milk', 'key', 'milk'), jsonb_build_object('name', 'milk', 'key', 'milk')));
select is((select count(*)::int from public.grocery_item where name_key = 'milk'), 1,
          '... two adds of the same thing at once make one item');
select public.add_groceries('54000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('name', 'Milk 2%', 'key', 'milk 2%', 'into_id', pg_temp.item('milk'))));
select is((select count(*)::int from public.grocery_item_reason where item_id = pg_temp.item('milk')), 3,
          '... Make it one joins the item chosen, whatever its name');
select throws_ok($$ select public.add_groceries('54000000-0000-0000-0000-000000000002',
                     '[{"name": "Theirs", "key": "theirs"}]') $$, '42501', null,
                 '[MEAL-18-a] not onto another family''s list');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-18-b] Tick, untick, remove; the history kept
-- ---------------------------------------------------------------------------------------------
select is(public.set_groceries_ticked(array[pg_temp.item('onion')], true), 1, '[MEAL-18-b] ticking is a buy');
select is((select status from public.grocery_item where id = pg_temp.item('onion')), 'ticked', '... it is off the list');
select ok((select ticked_at is not null and ticked_by = '54100000-0000-0000-0000-000000000001'
             from public.grocery_item where id = pg_temp.item('onion')), '... with when and who');
select is((pg_temp.add('Onions', 'onion') -> 0 ->> 'merged')::boolean, false,
          '[MEAL-20-d] a ticked item is never merged into: a new one');
select is(public.set_groceries_ticked(array[(select id from public.grocery_item where name_key = 'onion' and status = 'ticked')], false),
          1, '[MEAL-18-b] unticking puts it back');
select is((select count(*)::int from public.grocery_item where name_key = 'onion' and status = 'open'), 1,
          '... and the one added meanwhile is folded into it, so it is on the list once');
select is((select count(*)::int from public.grocery_item_reason r join public.grocery_item i on i.id = r.item_id
            where i.name_key = 'onion' and i.status = 'open'), 3, '... with every reason');
select is(public.remove_groceries(array[pg_temp.item('mystery')]), 1, '... removing takes it off');
select is((select status from public.grocery_item where id = pg_temp.item('mystery')), 'removed',
          '... as removed, not a buy');
select is((select array_agg(kind order by at, kind) from public.grocery_item_event where item_id = pg_temp.item('mystery')),
          array['added', 'removed'], '... and its history stays');
select lives_ok($$ select public.update_grocery_item(pg_temp.item('milk'), 'Whole milk', 'whole milk', '×3') $$,
                '... Edit changes the name and the amount');
select is((select count(*)::int from public.grocery_item_reason where item_id = pg_temp.item('whole milk') and amount is not null),
          0, '... the amount typed replaces the reasons''');
select pg_temp.add('Eggs', 'egg');
select throws_ok($$ select public.update_grocery_item(pg_temp.item('egg'), 'Whole milk', 'whole milk', null) $$,
                 '23505', null, '... a name another open item has is refused');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-18-a] The household's own: boards read, nobody else
-- ---------------------------------------------------------------------------------------------
select throws_ok($$ insert into public.grocery_item (household_id, list_id, name, name_key, category_id)
                    select household_id, (select id from public.grocery_list l where l.household_id = c.household_id),
                           'Sneaky', 'sneaky', id from public.grocery_category c limit 1 $$,
                 '42501', null, '[MEAL-18-a] nobody writes the list directly');
select pg_temp.board();
select ok((select count(*) from public.grocery_item) > 0 and (select count(*) from public.grocery_item_reason) > 0
          and (select count(*) from public.grocery_category) = 9,
          '[MEAL-18-a] the household''s board reads its list, reasons and categories');
select throws_ok($$ select public.set_groceries_ticked(array[pg_temp.item('egg')], true) $$, '42501', null,
                 '... and changes nothing on it');
select pg_temp.their_board();
select is((select count(*)::int from public.grocery_item), 0, '... another family''s board reads none of it');
select pg_temp.neighbour();
select is((select count(*)::int from public.grocery_item) + (select count(*)::int from public.grocery_item_event)
          + (select count(*)::int from public.grocery_item_reason), 0, '... nor another family''s parent');
select throws_ok($$ select public.remove_groceries(array[pg_temp.item('egg')]) $$, 'P0002', null,
                 '... who can''t change it either');

-- ---------------------------------------------------------------------------------------------
-- [MEAL-24-e][MEAL-23-b] Moving several teaches words; categories and stores
-- ---------------------------------------------------------------------------------------------
select pg_temp.parent();
select pg_temp.add('Greek yogurt', 'greek yogurt');
select is(public.move_groceries(array[pg_temp.item('greek yogurt'), pg_temp.item('egg')], pg_temp.cat('dairy')), 2,
          '[MEAL-23-b] several items move to a category at once');
select is((select array_agg(word order by word) from public.grocery_learned_word
            where household_id = '54000000-0000-0000-0000-000000000001' and category_id = pg_temp.cat('dairy')),
          array['egg', 'greek', 'yogurt'], '[MEAL-24-e] the move teaches each word of their names');
select pg_temp.neighbour();
select is((select count(*)::int from public.grocery_learned_word), 0, '... to their own household only');
select pg_temp.parent();
select lives_ok($$ select public.add_grocery_place('54000000-0000-0000-0000-000000000001', 'category', 'Fruit') $$,
                '[MEAL-23-b] a parent adds a category');
select throws_ok($$ select public.add_grocery_place('54000000-0000-0000-0000-000000000001', 'category', 'fruit') $$,
                 '23505', null, '... one of a name');
select is(public.move_grocery_place('category', (select id from public.grocery_category where name = 'Fruit'), -1), 8,
          '... moves it earlier, never past Other');
select is(public.remove_grocery_place('category', pg_temp.cat('dairy')), 2,
          '... removing a category says how many items were in it');
select is((select category_id from public.grocery_item where id = pg_temp.item('egg')), pg_temp.cat('other'),
          '... and moves them to Other');
select throws_ok($$ select public.remove_grocery_place('category', pg_temp.cat('other')) $$, '22023', null,
                 '... Other can''t be removed');
select throws_ok($$ select public.rename_grocery_place('category', pg_temp.cat('other'), 'Misc') $$, '22023', null,
                 '... or renamed');
select public.set_groceries_store(array[pg_temp.item('egg')], (select id from public.grocery_store where name = 'Aldi'));
select is(public.remove_grocery_place('store', (select id from public.grocery_store where name = 'Aldi')), 1,
          '... a removed store');
select is((select store_id from public.grocery_item where id = pg_temp.item('egg')), null,
          '... leaves its items with any store');
select set_config('t.produce', pg_temp.cat('produce')::text, true);
select pg_temp.neighbour();
select throws_ok($$ select public.rename_grocery_place('category', current_setting('t.produce')::uuid, 'Mine') $$, '42501', null,
                 '... and only the household''s parents change them');

select * from finish();
rollback;
