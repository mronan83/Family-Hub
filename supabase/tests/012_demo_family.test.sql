-- [NFR-14] The demo family seed resets only the demo household and never touches another (D-37).
-- [ACC-02] It creates the four demo sign-ins (D-39), without passwords.
begin;
select plan(19);

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

-- Twice: running the seed again resets the demo family rather than duplicating it. In between,
-- e2e pairs a demo board, and a real household has one.
\ir ../seed.sql
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000b1', 'device-old@devices.familywise.invalid'),
  ('a0000000-0000-0000-0000-0000000000b2', 'device-kept@devices.familywise.invalid');
insert into public.device (household_id, name, auth_user_id) values
  ('0de00000-0000-4000-8000-000000000001', 'Demo board', 'a0000000-0000-0000-0000-0000000000b1'),
  ('44444444-4444-4444-4444-444444444444', 'Real board', 'a0000000-0000-0000-0000-0000000000b2');
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

select is((select string_agg(email, ',' order by email) from auth.users where email like '%@devices.familywise.invalid'),
  'device-kept@devices.familywise.invalid',
  '[NFR-14] a demo board''s sign-in goes with the demo family; a real board''s stays (WP-05)');

select results_eq(
  $$ select count(*)::int, count(*) filter (where kind = 'task')::int,
            string_agg(title || '/' || u.email, ',') filter (where visibility = 'private')
       from public.chore c join auth.users u on u.id = c.created_by
      where c.household_id = '0de00000-0000-4000-8000-000000000001' $$,
  $$ values (9, 3, 'Buy anniversary gift/sam@demo.familywise.invalid'::text) $$,
  '[CHR-01][CHR-13] the demo family has six routines and three tasks; Sam''s gift is private, after two runs');
select is((select count(*)::int from public.chore c
            where c.household_id = '0de00000-0000-4000-8000-000000000001'
              and not exists (select from public.chore_assignee a where a.chore_id = c.id)), 0,
  '[CHR-09] every demo item is for someone');

select results_eq(
  $$ select count(*)::int, count(*) filter (where is_default)::int,
            count(*) filter (where (now() at time zone 'America/New_York')::date between start_date and end_date
                                 or (now() at time zone 'America/New_York')::date < start_date)::int
       from public.school_year where household_id = '0de00000-0000-4000-8000-000000000001' $$,
  $$ values (2, 2, 2) $$,
  '[SCH-01] the demo family has this school year and next, both defaults, neither in the past, after two runs');
select is((select count(*)::int from public.school_closure c join public.school_year y on y.id = c.school_year_id
            where y.household_id = '0de00000-0000-4000-8000-000000000001'), 5,
  '[SCH-01] the demo school year has a teacher day, three breaks and a holiday');

select results_eq(
  $$ select count(distinct o.id)::int, count(*)::int, min(o.due_date) = private.household_today(o.household_id)
       from public.chore_occurrence o join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      where o.chore_id = '0de00000-0000-4000-8000-0000000c0001' and o.due_date >= private.household_today(o.household_id)
      group by o.household_id $$,
  $$ values (30, 30, true) $$,
  '[CHR-03][CHR-18] the demo family''s Make bed is planned from today for 15 days, one for Maya and one for Leo each day, after two runs');

select results_eq(
  $$ select m.display_name::text, o.status, count(*)::int
       from public.chore_occurrence o join public.member m on m.id = o.member_id
      where o.chore_id = '0de00000-0000-4000-8000-0000000c0001' and o.due_date < private.household_today(o.household_id)
      group by 1, 2 order by 1, 2 $$,
  $$ values ('Leo'::text, 'completed'::text, 6), ('Leo', 'missed', 1), ('Maya', 'completed', 6), ('Maya', 'missed', 1) $$,
  '[CHR-07][CHR-18] the demo family''s last week: each child made their own bed six days and missed one, after two runs');
-- Homework is on school days only, so in a break or the summer last week may have none.
select ok((select count(*) filter (where o.status = 'pending_approval')
                    = least(count(*), 1)
                  and bool_and(o.status <> 'pending_approval'
                               or (o.due_date = max_due and o.done_by = (select array[id] from public.member
                                                                          where household_id = o.household_id and display_name = 'Maya')))
             from (select o.*, max(o.due_date) over () as max_due from public.chore_occurrence o
                    where o.chore_id = '0de00000-0000-4000-8000-0000000c0005'
                      and o.due_date < private.household_today(o.household_id)) o)
          and not exists (select from public.chore_occurrence o
                           where o.household_id = '0de00000-0000-4000-8000-000000000001' and o.kind = 'chore'
                             and o.due_date < private.household_today(o.household_id) and o.finalized_at is null),
  '[CHR-05][CHR-07] the latest homework waits for a parent, and every past day is closed');

select * from finish();
rollback;
