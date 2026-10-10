-- [NFR-07][NFR-14] The demo family is marked so production's jobs leave it alone (D-62): a new
-- household is never the demo family, and only the server, the seed or a migration changes the mark;
-- a parent can't turn their own household's jobs off, or the demo family's back on.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('25000000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('25000000-0000-0000-0000-000000000002', 'alex@demo.familywise.invalid');
insert into public.household (id, name, timezone) values
  ('25100000-0000-0000-0000-000000000001', 'Real family', 'America/Chicago');
insert into public.household (id, name, timezone, is_demo) values
  ('25100000-0000-0000-0000-000000000002', 'Demo family', 'America/New_York', true);
insert into public.household_user (household_id, user_id, role) values
  ('25100000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', 'owner'),
  ('25100000-0000-0000-0000-000000000002', '25000000-0000-0000-0000-000000000002', 'owner');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
create function pg_temp.demo(p_household uuid) returns boolean language sql as $$
  select is_demo from public.household where id = p_household
$$;

select col_not_null('public', 'household', 'is_demo', '[NFR-14] every household is marked demo or not');
select is(pg_temp.demo('25100000-0000-0000-0000-000000000001'), false,
  '[NFR-14] a household is not the demo family unless marked');

select pg_temp.act_as('25000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.household set name = 'The Real family' where id = '25100000-0000-0000-0000-000000000001' $$,
  '[NFR-04] a parent still changes their household''s name');
select throws_ok(
  $$ update public.household set is_demo = true where id = '25100000-0000-0000-0000-000000000001' $$,
  '42501', 'only the server marks the demo family',
  '[NFR-07] a parent can''t turn their own household''s jobs off');

select pg_temp.act_as('25000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ update public.household set is_demo = false where id = '25100000-0000-0000-0000-000000000002' $$,
  '42501', 'only the server marks the demo family',
  '[NFR-14] a demo parent can''t put the demo family back in the jobs');
select lives_ok(
  $$ update public.household set name = 'Demo family' where id = '25100000-0000-0000-0000-000000000002' $$,
  '[NFR-04] an update that leaves the mark alone goes through');

reset role;
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.demo('25100000-0000-0000-0000-000000000001'), false,
  '[NFR-07] the real family''s jobs still run');
select is(pg_temp.demo('25100000-0000-0000-0000-000000000002'), true,
  '[NFR-14] the demo family is still left alone');

select pg_temp.as_server();
select lives_ok(
  $$ update public.household set is_demo = false where id = '25100000-0000-0000-0000-000000000002' $$,
  '[NFR-07] the server can change the mark');

reset role;
select set_config('request.jwt.claims', '{}', true);
select lives_ok(
  $$ update public.household set is_demo = true where id = '25100000-0000-0000-0000-000000000002' $$,
  '[NFR-14] so can the seed and a migration (no signed-in user)');

select * from finish();
rollback;
