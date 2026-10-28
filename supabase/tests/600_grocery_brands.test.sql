-- [MEAL-29] Grocery brands (WP-116, D-148): the household's own list of brands, one per name ignoring
-- case and spacing, written only through their functions by its parents; an item's brand through
-- the one way in and Brand…; merging moves every item; the board reads them.
begin;
select plan(37);

insert into auth.users (id, email) values
  ('60100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('60300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('60d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('60000000-0000-0000-0000-000000000001', 'Brand family', 'America/Chicago'),
  ('60000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('60000000-0000-0000-0000-000000000001'), ('60000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('60000000-0000-0000-0000-000000000001', '60100000-0000-0000-0000-000000000001', 'owner'),
  ('60000000-0000-0000-0000-000000000002', '60300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('60dd0000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Kitchen',
   '60d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('60100000-0000-0000-0000-000000000001') $$;
create function pg_temp.neighbour() returns void language sql as $$
  select pg_temp.as_user('60300000-0000-0000-0000-000000000003') $$;
create function pg_temp.board() returns void language sql as $$
  select pg_temp.as_user('60d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.brand(p_name text) returns uuid language sql as $$
  select id from public.grocery_brand
   where household_id = '60000000-0000-0000-0000-000000000001' and name = p_name $$;
create function pg_temp.brand_of(p_item text) returns text language sql as $$
  select b.name from public.grocery_item i left join public.grocery_brand b on b.id = i.brand_id
   where i.household_id = '60000000-0000-0000-0000-000000000001' and i.name = p_item
   order by i.created_at desc limit 1 $$;
create function pg_temp.add(p_name text, p_brand jsonb) returns jsonb language sql as $$
  select public.add_groceries('60000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('name', p_name, 'key', lower(p_name)) || coalesce(p_brand, '{}'))) $$;

-- [MEAL-29-a] Added by the household's parent; another household's parent and a board are refused.
select pg_temp.parent();
select lives_ok($$ select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', '  Kirkland  ') $$,
                '[MEAL-29-a] the parent adds a brand');
select is((select name from public.grocery_brand where id = pg_temp.brand('Kirkland')), 'Kirkland',
          '[MEAL-29-a] it is saved, trimmed');
select pg_temp.neighbour();
select throws_ok($$ select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'Jif') $$,
                 '42501', null, '[MEAL-29-a] another household''s parent can''t add one');
select is((select count(*)::int from public.grocery_brand), 0,
          '[MEAL-29-a] and doesn''t read the household''s brands');
select pg_temp.board();
select throws_ok($$ select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'Jif') $$,
                 '42501', null, '[MEAL-29-a] a board can''t add one');
select is((select count(*)::int from public.grocery_brand), 1, '[MEAL-29-a] the household''s board reads its brands');
select throws_ok($$ select public.rename_grocery_brand(pg_temp.brand('Kirkland'), 'Costco') $$,
                 '42501', null, '[MEAL-29-a] a board can''t rename one');
select pg_temp.parent();
select throws_ok($$ insert into public.grocery_brand (household_id, name)
                    values ('60000000-0000-0000-0000-000000000001', 'Jif') $$,
                 '42501', null, '[MEAL-29-a] nobody writes the table directly');
select throws_ok($$ update public.grocery_brand set name = 'Jif' $$, '42501', null,
                 '[MEAL-29-a] nor updates it');

-- [MEAL-29-b] One per name ignoring case and spacing.
select throws_ok($$ select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'kirk land') $$,
                 '23505', null, '[MEAL-29-b] "kirk land" is Kirkland, already there');
select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'Kirkland Signature');
select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'Fairlife');
select throws_ok($$ select public.rename_grocery_brand(pg_temp.brand('Fairlife'), 'KIRKLAND') $$,
                 '23505', null, '[MEAL-29-b] renaming to another brand''s name is refused');
select lives_ok($$ select public.rename_grocery_brand(pg_temp.brand('Fairlife'), 'fairlife') $$,
                '[MEAL-29-b] a brand takes its own name in other capitals');
select public.rename_grocery_brand(pg_temp.brand('fairlife'), 'Fairlife');
select is(public.archive_grocery_brand(pg_temp.brand('Fairlife'), true), 'Fairlife',
          '[MEAL-29-b] archiving says the name back');
select isnt((select archived_at from public.grocery_brand where id = pg_temp.brand('Fairlife')), null,
            '[MEAL-29-b] Fairlife is archived');
select lives_ok($$ select public.add_grocery_brand('60000000-0000-0000-0000-000000000001', 'FAIRLIFE') $$,
                '[MEAL-29-b] adding an archived brand''s name brings it back');
select is((select archived_at from public.grocery_brand where id = pg_temp.brand('Fairlife')), null,
          '[MEAL-29-b] Fairlife is back, the same brand');
select is((select count(*)::int from public.grocery_brand
            where household_id = '60000000-0000-0000-0000-000000000001'), 3,
          '[MEAL-29-b] still three brands');

-- [MEAL-29-c] The one way in takes a brand by id or by name.
select pg_temp.add('Milk', jsonb_build_object('brand_id', pg_temp.brand('Kirkland')));
select is(pg_temp.brand_of('Milk'), 'Kirkland', '[MEAL-29-c] a brand by id');
select pg_temp.add('Greek yogurt', '{"brand": " chobani "}');
select is(pg_temp.brand_of('Greek yogurt'), 'chobani', '[MEAL-29-c] a new brand by name is saved');
select isnt(pg_temp.brand('chobani'), null, '[MEAL-29-c] and is among the household''s brands');
select pg_temp.add('Paper towels', '{"brand": "kirkland"}');
select is(pg_temp.brand_of('Paper towels'), 'Kirkland', '[MEAL-29-c] a brand by name is found ignoring case');
select pg_temp.add('Milk', jsonb_build_object('brand', 'Fairlife'));
select is((select count(*)::int from public.grocery_item where name = 'Milk' and status = 'open'), 1,
          '[MEAL-29-c] adding Milk again keeps one open Milk');
select is(pg_temp.brand_of('Milk'), 'Fairlife', '[MEAL-29-c] with another brand, its brand changes');
select pg_temp.add('Milk', null);
select is(pg_temp.brand_of('Milk'), 'Fairlife', '[MEAL-29-c] with no brand, it keeps its brand');
select pg_temp.neighbour();
select throws_ok($$ select pg_temp.add('Eggs', '{"brand": "Eggland"}') $$, '42501', null,
                 '[MEAL-29-c] another household''s parent can''t add to the list');

-- [MEAL-29-e] Brand…: set, saved or cleared; the board reads it.
select pg_temp.parent();
select is(public.set_groceries_brand(array(select id from public.grocery_item where name = 'Milk'), 'Horizon'), 1,
          '[MEAL-29-e] Brand… sets one item''s brand');
select is(pg_temp.brand_of('Milk'), 'Horizon', '[MEAL-29-e] a new brand, saved');
select is(public.set_groceries_brand(array(select id from public.grocery_item where name = 'Milk'), ''), 1,
          '[MEAL-29-e] empty is no brand');
select is(pg_temp.brand_of('Milk'), null, '[MEAL-29-e] Milk has no brand');
select pg_temp.board();
select is((select i ->> 'brand_id' from jsonb_array_elements(public.board_groceries() -> 'items') i
            where i ->> 'name' = 'Paper towels'),
          (select pg_temp.brand('Kirkland'))::text, '[MEAL-29-e] the board reads each item''s brand');
select is(jsonb_array_length(public.board_groceries() -> 'brands'), 5,
          '[MEAL-29-e] and the household''s brands');

-- [MEAL-29-d] Merge moves every item, open, ticked or removed, and removes the merged brand.
select pg_temp.parent();
select pg_temp.add('Coffee', '{"brand": "Kirkland Signature"}');
select public.set_groceries_ticked(array(select id from public.grocery_item where name = 'Coffee'), true);
select pg_temp.add('Batteries', '{"brand": "Kirkland Signature"}');
select pg_temp.as_owner();
create temp table m as select pg_temp.brand('Kirkland Signature') as sig, pg_temp.brand('Kirkland') as kirk;
grant select on m to authenticated;
select pg_temp.parent();
select throws_ok($$ select public.merge_grocery_brands((select sig from m), (select sig from m)) $$,
                 '22023', null, '[MEAL-29-d] merging into itself is refused');
select public.archive_grocery_brand(pg_temp.brand('chobani'), true);
select throws_ok($$ select public.merge_grocery_brands((select sig from m), pg_temp.brand('chobani')) $$,
                 '22023', null, '[MEAL-29-d] merging into an archived brand is refused');
select is(public.merge_grocery_brands((select sig from m), (select kirk from m)), 'Kirkland',
          '[MEAL-29-d] merging Kirkland Signature into Kirkland says the kept name');
select is((select count(*)::int from public.grocery_item
            where brand_id = (select kirk from m) and name in ('Coffee', 'Batteries')), 2,
          '[MEAL-29-d] every item with it, the ticked one too, is Kirkland now');
select is((select count(*)::int from public.grocery_brand where id = (select sig from m)), 0,
          '[MEAL-29-d] and Kirkland Signature is gone');
select pg_temp.neighbour();
select throws_ok($$ select public.merge_grocery_brands((select kirk from m), pg_temp.brand('Fairlife')) $$,
                 '42501', null, '[MEAL-29-d] another household''s parent can''t merge them');

select * from finish();
rollback;
