-- [ACC-04][PTS-07][NFR-04] Members (WP-04): children and adults, the earns-rewards default, archive,
-- and links from an adult member to an admin of the same household only.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('e2000000-0000-0000-0000-000000000002', 'spouse@example.com'),
  ('e3000000-0000-0000-0000-000000000003', 'elsewhere@example.com'),
  ('e4000000-0000-0000-0000-000000000004', 'stranger@example.com');
insert into public.household (id, name, timezone) values
  ('88888888-8888-8888-8888-888888888888', 'Members', 'America/Chicago'),
  ('99999999-9999-9999-9999-999999999999', 'Elsewhere', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('88888888-8888-8888-8888-888888888888', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('88888888-8888-8888-8888-888888888888', 'e2000000-0000-0000-0000-000000000002', 'admin'),
  ('99999999-9999-9999-9999-999999999999', 'e3000000-0000-0000-0000-000000000003', 'owner');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('e1000000-0000-0000-0000-000000000001');
insert into public.member (id, household_id, display_name, role, avatar_key, color) values
  ('f1000000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888', 'Maya', 'child', 'fox', 'member-3'),
  ('f2000000-0000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'Leo', 'child', null, 'member-4'),
  ('f3000000-0000-0000-0000-000000000003', '88888888-8888-8888-8888-888888888888', 'Pat', 'adult', 'owl', 'member-1');

select results_eq(
  $$ select display_name, earns_rewards from public.member order by display_name $$,
  $$ values ('Leo'::text, true), ('Maya', true), ('Pat', false) $$,
  '[ACC-04][PTS-07] an admin adds several children and an adult; the switch follows the role');

select lives_ok(
  $$ update public.member set user_id = 'e1000000-0000-0000-0000-000000000001'
      where id = 'f3000000-0000-0000-0000-000000000003' $$,
  '[ACC-04] an adult member can be linked to an admin of the household');
select throws_ok(
  $$ update public.member set user_id = 'e3000000-0000-0000-0000-000000000003'
      where id = 'f3000000-0000-0000-0000-000000000003' $$,
  '23514', null, '[NFR-04] a member cannot be linked to an admin of another household');
select throws_ok(
  $$ update public.member set user_id = 'e4000000-0000-0000-0000-000000000004'
      where id = 'f3000000-0000-0000-0000-000000000003' $$,
  '23514', null, '[NFR-04] a member cannot be linked to a sign-in outside the household');
select throws_ok(
  $$ insert into public.member (household_id, display_name, role, user_id)
     values ('88888888-8888-8888-8888-888888888888', 'Also me', 'adult', 'e1000000-0000-0000-0000-000000000001') $$,
  '23505', null, '[ACC-04] an admin is linked to one member at most');
select throws_ok(
  $$ update public.member set user_id = 'e2000000-0000-0000-0000-000000000002'
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23514', null, '[ACC-04] a child is never linked to a sign-in');

update public.member set earns_rewards = true where id = 'f3000000-0000-0000-0000-000000000003';
select is((select earns_rewards from public.member where id = 'f3000000-0000-0000-0000-000000000003'), true,
  '[PTS-07] the switch can be turned on for an adult');
update public.member set role = 'adult' where id = 'f2000000-0000-0000-0000-000000000002';
select is((select earns_rewards from public.member where id = 'f2000000-0000-0000-0000-000000000002'), true,
  '[PTS-07] changing the role later keeps the switch as it was');

update public.member set archived_at = now() where id = 'f1000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.member where archived_at is null), 2,
  '[ACC-04] archiving keeps the row and takes the member out of the active list');
update public.member set archived_at = null where id = 'f1000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.member where archived_at is null), 3,
  '[ACC-04] an archived member can be restored');

select is((select count(*)::int from public.audit_log
            where entity_type = 'member' and household_id = '88888888-8888-8888-8888-888888888888'
              and actor_id = 'e1000000-0000-0000-0000-000000000001'), 8,
  '[ACC-05] every member change is audited with its admin (3 adds, 5 edits; refused ones leave nothing)');

-- Another household's admin sees none of these members.
select pg_temp.act_as('e3000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.member), 0, '[NFR-04] members are invisible to other households');

-- An admin who leaves: the member stays, unlinked.
reset role;
delete from public.household_user where user_id = 'e1000000-0000-0000-0000-000000000001';
select is((select user_id from public.member where id = 'f3000000-0000-0000-0000-000000000003'), null,
  '[ACC-04] when an admin leaves the household, their member stays and is unlinked');

select * from finish();
rollback;
