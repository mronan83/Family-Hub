-- [MEAL-28] The household's preferred store (WP-112, D-142): New items go to. The household's own,
-- set only through set_grocery_preferred_store() by its parents, to one of its own stores or none;
-- removing the store clears it; a new household starts with Any store.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('57100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('57300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('57d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('57000000-0000-0000-0000-000000000001', 'Store family', 'America/Chicago'),
  ('57000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('57000000-0000-0000-0000-000000000001'), ('57000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('57000000-0000-0000-0000-000000000001', '57100000-0000-0000-0000-000000000001', 'owner'),
  ('57000000-0000-0000-0000-000000000002', '57300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('57dd0000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000001', 'Kitchen',
   '57d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('57100000-0000-0000-0000-000000000001') $$;
create function pg_temp.neighbour() returns void language sql as $$
  select pg_temp.as_user('57300000-0000-0000-0000-000000000003') $$;
create function pg_temp.board() returns void language sql as $$
  select pg_temp.as_user('57d00000-0000-0000-0000-00000000000d') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.store(p_household uuid, p_name text) returns uuid language sql as $$
  select id from public.grocery_store where household_id = p_household and name = p_name $$;
create function pg_temp.preferred() returns uuid language sql as $$
  select preferred_store_id from public.grocery_list
   where household_id = '57000000-0000-0000-0000-000000000001' $$;

-- [MEAL-28-g] A new household starts with Any store.
select pg_temp.as_owner();
select is(pg_temp.preferred(), null, '[MEAL-28-g] a new household''s New items go to is Any store');

-- [MEAL-28-a] Set by the household's parent, to one of its stores or none.
select pg_temp.as_owner();
create temp table s as select
  pg_temp.store('57000000-0000-0000-0000-000000000001', 'Costco') as costco,
  pg_temp.store('57000000-0000-0000-0000-000000000001', 'Kroger') as kroger,
  pg_temp.store('57000000-0000-0000-0000-000000000002', 'Costco') as theirs;
grant select on s to authenticated;

select pg_temp.parent();
select lives_ok($$ select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001',
                   (select costco from s)) $$, '[MEAL-28-a] the parent sets the preferred store');
select is(pg_temp.preferred(), (select costco from s), '[MEAL-28-a] it reads back as Costco');
select throws_ok($$ select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001',
                    (select theirs from s)) $$, '22023', null,
                 '[MEAL-28-a] another household''s store is refused');
select is(pg_temp.preferred(), (select costco from s), '[MEAL-28-a] and leaves it as it was');
select lives_ok($$ select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001', null) $$,
                '[MEAL-28-a] none is Any store');
select is(pg_temp.preferred(), null, '[MEAL-28-a] it reads back as Any store');

select pg_temp.neighbour();
select throws_ok($$ select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001',
                    (select kroger from s)) $$, '42501', null,
                 '[MEAL-28-a] another household''s admin can''t set it');
select pg_temp.board();
select throws_ok($$ select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001',
                    (select kroger from s)) $$, '42501', null, '[MEAL-28-a] a board can''t set it');
select is((select count(*)::int from public.grocery_list where preferred_store_id is null), 1,
          '[MEAL-28-a] the household''s board reads its list and its preferred store');
select pg_temp.parent();
select throws_ok($$ update public.grocery_list set preferred_store_id = (select kroger from s) $$,
                 '42501', null, '[MEAL-28-a] nobody writes the column directly');

-- [MEAL-28-b] Removing the preferred store clears it.
select public.set_grocery_preferred_store('57000000-0000-0000-0000-000000000001', (select kroger from s));
select is(pg_temp.preferred(), (select kroger from s), '[MEAL-28-b] Kroger is preferred');
select public.remove_grocery_place('store', (select kroger from s));
select is(pg_temp.preferred(), null, '[MEAL-28-b] removing Kroger sets New items go to back to Any store');

select * from finish();
rollback;
