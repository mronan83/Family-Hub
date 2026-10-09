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
