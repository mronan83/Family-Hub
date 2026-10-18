-- [MEAL-07] Meals → groceries (WP-105, D-138): a meal's ingredients, checked by the database.
begin;
select plan(6);

insert into auth.users (id, email) values ('55100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone) values
  ('55000000-0000-0000-0000-000000000001', 'Meal family', 'America/Chicago');
insert into public.household_settings (household_id) values ('55000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('55000000-0000-0000-0000-000000000001', '55100000-0000-0000-0000-000000000001', 'owner');

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

select * from finish();
rollback;
