-- The demo family (01 §9.5, D-37). Previews and e2e run as this household inside the one database;
-- RLS keeps it apart from every real household exactly as it keeps two families apart. Running this
-- file again resets the demo family: its household is deleted (every household_id cascades) and
-- recreated, along with its demo sign-ins. It touches no other household. Names are made up.
--
-- Demo sign-ins (WP-03, D-39), all `…@demo.familywise.invalid`, which can never receive email:
--   Alex   owner of the demo family        Sam    admin of the demo family
--   Jordan a parent with no household yet  Riley  a parent with no household yet
-- They are created without a password. scripts/preview-db.sh then sets each password, derived from
-- the deployment-protection bypass secret, so previews (one tap) and e2e can sign in and nobody has
-- to know or store it.

-- Households that e2e set up with demo sign-ins: every admin is a demo sign-in, so never a real one.
delete from public.household h
 where h.id <> '0de00000-0000-4000-8000-000000000001'
   and exists (select from public.household_user hu where hu.household_id = h.id)
   and not exists (
     select from public.household_user hu join auth.users u on u.id = hu.user_id
      where hu.household_id = h.id and u.email not like '%@demo.familywise.invalid');
delete from public.household where id = '0de00000-0000-4000-8000-000000000001';
delete from auth.users where email like '%@demo.familywise.invalid';
-- Boards whose device row is gone (e2e's, with the demo family): their sign-ins go too (WP-05).
delete from auth.users u
 where u.email like 'device-%@devices.familywise.invalid'
   and not exists (select from public.device d where d.auth_user_id = u.id);
-- Setup codes left behind: used by a household that is gone (e2e's), or expired unused.
delete from private.household_setup_code
 where (used_at is not null and household_id is null) or (used_at is null and expires_at < now());

insert into public.household (id, name, timezone)
values ('0de00000-0000-4000-8000-000000000001', 'Demo family', 'America/New_York');

insert into public.household_settings (household_id)
values ('0de00000-0000-4000-8000-000000000001');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, null, now(),
       '', '', '', '', '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
  from (values
    ('0de00000-0000-4000-8000-0000000000a1'::uuid, 'alex@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a2'::uuid, 'sam@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a3'::uuid, 'jordan@demo.familywise.invalid'),
    ('0de00000-0000-4000-8000-0000000000a4'::uuid, 'riley@demo.familywise.invalid')
  ) as demo (id, email);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now()
  from auth.users where email like '%@demo.familywise.invalid';

insert into public.household_user (household_id, user_id, role)
values
  ('0de00000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-0000000000a1', 'owner'),
  ('0de00000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-0000000000a2', 'admin');

insert into public.member (household_id, display_name, role, avatar_key, color, birth_year, user_id)
values
  ('0de00000-0000-4000-8000-000000000001', 'Alex', 'adult', 'owl', 'member-1', 1986, '0de00000-0000-4000-8000-0000000000a1'),
  ('0de00000-0000-4000-8000-000000000001', 'Sam', 'adult', 'bear', 'member-2', 1987, '0de00000-0000-4000-8000-0000000000a2'),
  ('0de00000-0000-4000-8000-000000000001', 'Maya', 'child', 'fox', 'member-3', 2016, null),
  ('0de00000-0000-4000-8000-000000000001', 'Leo', 'child', 'frog', 'member-4', 2019, null);


-- The family list (WP-08): household tags, six routines and three tasks. Sam's anniversary gift is
-- private, so Alex and the board never see it. Due dates count from today in the family's time zone,
-- so the list always looks current.
insert into public.tag (id, household_id, name, color, icon, sort_order)
values
  ('0de00000-0000-4000-8000-0000000a0001', '0de00000-0000-4000-8000-000000000001', 'Morning', 'member-6', 'sun', 1),
  ('0de00000-0000-4000-8000-0000000a0002', '0de00000-0000-4000-8000-000000000001', 'Kitchen', 'member-3', 'chore-dishes', 2),
  ('0de00000-0000-4000-8000-0000000a0003', '0de00000-0000-4000-8000-000000000001', 'Bedroom', 'member-4', 'chore-bed', 3),
  ('0de00000-0000-4000-8000-0000000a0004', '0de00000-0000-4000-8000-000000000001', 'School', 'member-1', 'backpack', 4);

with today as (select (now() at time zone 'America/New_York')::date as d)
insert into public.chore (id, household_id, title, icon, kind, points, approval, schedule, due_time,
                          day_types, visibility, created_by)
select id::uuid, '0de00000-0000-4000-8000-000000000001', title, icon, kind, points, approval, schedule,
       due_time::time, coalesce(day_types::text[], array['school_day', 'no_school', 'break', 'weekend', 'summer']),
       visibility, created_by::uuid
  from today, lateral (values
    ('0de00000-0000-4000-8000-0000000c0001', 'Make bed', 'chore-bed', 'chore', 5, 'inherit',
     '{"freq": "daily"}'::jsonb, '07:30', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0002', 'Brush teeth', 'chore-teeth', 'chore', 2, 'inherit',
     '{"freq": "daily"}', '07:45', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0003', 'Feed the dog', 'chore-pet', 'chore', 5, 'inherit',
     '{"freq": "daily"}', '17:00', null, 'family', '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0004', 'Set the table', 'chore-table', 'chore', 5, 'inherit',
     '{"freq": "daily"}', '17:30', null, 'family', '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0005', 'Homework', 'chore-homework', 'chore', 10, 'required',
     '{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}', '16:00', '{school_day}', 'family',
     '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0006', 'Take out the bins', 'chore-bin', 'chore', 0, 'inherit',
     '{"freq": "weekly", "by_weekday": [4]}', '19:00', null, 'family', '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0007', 'Pay the school trip fee', 'buy', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 3, 'YYYY-MM-DD')), null, null, 'family',
     '0de00000-0000-4000-8000-0000000000a1'),
    ('0de00000-0000-4000-8000-0000000c0008', 'Book the dentist', 'calendar', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 7, 'YYYY-MM-DD')), null, null, 'family',
     '0de00000-0000-4000-8000-0000000000a2'),
    ('0de00000-0000-4000-8000-0000000c0009', 'Buy anniversary gift', 'gift', 'task', 0, 'inherit',
     jsonb_build_object('freq', 'once', 'on_date', to_char(d + 10, 'YYYY-MM-DD')), null, null, 'private',
     '0de00000-0000-4000-8000-0000000000a2')
  ) as item (id, title, icon, kind, points, approval, schedule, due_time, day_types, visibility, created_by);

insert into public.chore_assignee (household_id, chore_id, member_id)
select m.household_id, a.chore_id::uuid, m.id
  from (values
    ('0de00000-0000-4000-8000-0000000c0001', 'Maya'), ('0de00000-0000-4000-8000-0000000c0001', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0002', 'Maya'), ('0de00000-0000-4000-8000-0000000c0002', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0003', 'Maya'), ('0de00000-0000-4000-8000-0000000c0003', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0004', 'Leo'),
    ('0de00000-0000-4000-8000-0000000c0005', 'Maya'),
    ('0de00000-0000-4000-8000-0000000c0006', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0007', 'Alex'),
    ('0de00000-0000-4000-8000-0000000c0008', 'Sam'),
    ('0de00000-0000-4000-8000-0000000c0009', 'Sam')
  ) as a (chore_id, name)
  join public.member m on m.household_id = '0de00000-0000-4000-8000-000000000001' and m.display_name = a.name;

insert into public.chore_tag (household_id, chore_id, tag_id)
select '0de00000-0000-4000-8000-000000000001', chore_id::uuid, tag_id::uuid
  from (values
    ('0de00000-0000-4000-8000-0000000c0001', '0de00000-0000-4000-8000-0000000a0001'),
    ('0de00000-0000-4000-8000-0000000c0001', '0de00000-0000-4000-8000-0000000a0003'),
    ('0de00000-0000-4000-8000-0000000c0002', '0de00000-0000-4000-8000-0000000a0001'),
    ('0de00000-0000-4000-8000-0000000c0003', '0de00000-0000-4000-8000-0000000a0002'),
    ('0de00000-0000-4000-8000-0000000c0004', '0de00000-0000-4000-8000-0000000a0002'),
    ('0de00000-0000-4000-8000-0000000c0005', '0de00000-0000-4000-8000-0000000a0004')
  ) as t (chore_id, tag_id);
