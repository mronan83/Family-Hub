-- [NFR-14] The demo family seed resets only the demo household and never touches another (D-37).
-- [ACC-02] It creates the four demo sign-ins (D-39), without passwords.
begin;
select plan(11);

insert into public.household (id, name, timezone) values
  ('44444444-4444-4444-4444-444444444444', 'Real family', 'America/Chicago'),
  ('55555555-5555-5555-5555-555555555555', 'Set up by e2e', 'America/Chicago'),
  ('66666666-6666-6666-6666-666666666666', 'Real family with a demo admin', 'America/Chicago');
insert into public.member (household_id, display_name, role) values
  ('44444444-4444-4444-4444-444444444444', 'Kid', 'child');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000aa', 'parent@example.com'),
  ('a0000000-0000-0000-0000-0000000000db', 'old-run@demo.familywise.invalid'),
  ('a0000000-0000-0000-0000-0000000000dc', 'riley-old@demo.familywise.invalid');
insert into public.household_user (household_id, user_id, role) values
  ('44444444-4444-4444-4444-444444444444', 'a0000000-0000-0000-0000-0000000000aa', 'owner'),
  ('55555555-5555-5555-5555-555555555555', 'a0000000-0000-0000-0000-0000000000dc', 'owner'),
  ('66666666-6666-6666-6666-666666666666', 'a0000000-0000-0000-0000-0000000000aa', 'owner'),
  ('66666666-6666-6666-6666-666666666666', 'a0000000-0000-0000-0000-0000000000db', 'admin');

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
select is((select count(*)::int from public.household where id = '55555555-5555-5555-5555-555555555555'), 0,
  '[NFR-14] a household whose only admins are demo sign-ins (set up by e2e) is removed');
select is((select count(*)::int from public.household where id = '66666666-6666-6666-6666-666666666666'), 1,
  '[NFR-14] a household with a real admin is kept even if a demo sign-in joined it');
select is(
  (select string_agg(email, ',' order by email) from auth.users where email like '%@demo.familywise.invalid'),
  'alex@demo.familywise.invalid,jordan@demo.familywise.invalid,riley@demo.familywise.invalid,sam@demo.familywise.invalid',
  '[ACC-02] exactly the four demo sign-ins exist; ones from earlier runs are removed');
select is(
  (select string_agg(u.email || '=' || hu.role, ',' order by u.email)
     from public.household_user hu join auth.users u on u.id = hu.user_id
    where hu.household_id = '0de00000-0000-4000-8000-000000000001'),
  'alex@demo.familywise.invalid=owner,sam@demo.familywise.invalid=admin',
  '[ACC-02] Alex owns the demo family and Sam is its admin; Jordan and Riley have no household');
select is((select count(*)::int from auth.users where email like '%@demo.familywise.invalid' and encrypted_password is not null), 0,
  '[ACC-02] the seed sets no password (preview-db.sh derives them)');
select is((select count(*)::int from auth.identities i join auth.users u on u.id = i.user_id
            where u.email like '%@demo.familywise.invalid' and i.provider = 'email'), 4,
  '[ACC-02] each demo sign-in has its email identity');

select * from finish();
rollback;
