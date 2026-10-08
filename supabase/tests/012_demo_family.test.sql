-- [NFR-14] The demo family seed resets only the demo household and never touches another (D-37).
begin;
select plan(6);

insert into public.household (id, name, timezone) values
  ('44444444-4444-4444-4444-444444444444', 'Real family', 'America/Chicago');
insert into public.member (household_id, display_name, role) values
  ('44444444-4444-4444-4444-444444444444', 'Kid', 'child');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000aa', 'parent@example.com'),
  ('a0000000-0000-0000-0000-0000000000db', 'old-run@demo.familywise.invalid');

-- Twice: running the seed again resets the demo family rather than duplicating it.
\ir ../seed.sql
\ir ../seed.sql

select is((select count(*)::int from public.household where id = '0de00000-0000-4000-8000-000000000001'), 1,
  '[NFR-14] one demo household after two runs');
select is((select count(*)::int from public.member where household_id = '0de00000-0000-4000-8000-000000000001'), 4,
  '[NFR-14] the demo family has four members, not duplicated');
select is((select count(*)::int from public.member
            where household_id = '0de00000-0000-4000-8000-000000000001' and earns_rewards), 2,
  '[NFR-14] demo children earn rewards and demo adults do not (D-32)');
select is((select count(*)::int from public.member where household_id = '44444444-4444-4444-4444-444444444444'), 1,
  '[NFR-14] another household and its members are untouched');
select is((select count(*)::int from auth.users where email = 'parent@example.com'), 1,
  '[NFR-14] real sign-ins are kept');
select is((select count(*)::int from auth.users where email like '%@demo.familywise.invalid'), 0,
  '[NFR-14] demo sign-ins from earlier runs are removed');

select * from finish();
rollback;
