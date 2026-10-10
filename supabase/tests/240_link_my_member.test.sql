-- [CHR-14][CHR-15][ACC-04] A parent links their own sign-in to themselves (link_my_member): only an
-- adult of their household, not archived, without someone else's sign-in; the sign-in moves from
-- wherever it was; linking again changes nothing; nobody else can do it for them.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('24100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('24100000-0000-0000-0000-000000000002', 'other-parent@example.com'),
  ('24300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('24d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('24000000-0000-0000-0000-000000000001', 'Link family', 'America/Chicago'),
  ('24000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('24000000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000001', 'owner'),
  ('24000000-0000-0000-0000-000000000001', '24100000-0000-0000-0000-000000000002', 'admin'),
  ('24000000-0000-0000-0000-000000000002', '24300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, archived_at) values
  ('24110000-0000-0000-0000-00000000000a', '24000000-0000-0000-0000-000000000001', 'Me', 'adult', null, null),
  ('24110000-0000-0000-0000-00000000000b', '24000000-0000-0000-0000-000000000001', 'Old me', 'adult',
   '24100000-0000-0000-0000-000000000001', now()),
  ('24110000-0000-0000-0000-00000000000c', '24000000-0000-0000-0000-000000000001', 'Kid', 'child', null, null),
  ('24110000-0000-0000-0000-00000000000d', '24000000-0000-0000-0000-000000000001', 'Partner', 'adult',
   '24100000-0000-0000-0000-000000000002', null),
  ('24110000-0000-0000-0000-00000000000e', '24000000-0000-0000-0000-000000000001', 'Gone', 'adult', null, now()),
  ('24110000-0000-0000-0000-00000000000f', '24000000-0000-0000-0000-000000000002', 'Neighbour', 'adult', null, null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('24dd0000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', 'Kitchen',
   '24d00000-0000-0000-0000-00000000000d');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create function pg_temp.linked(p_member uuid) returns uuid language sql as $$
  select user_id from public.member where id = p_member
$$;

-- Linking myself --------------------------------------------------------------------------
select pg_temp.as_user('24100000-0000-0000-0000-000000000001');
select is(public.link_my_member('24110000-0000-0000-0000-00000000000a') - 'member_id',
  '{"moved_from": "24110000-0000-0000-0000-00000000000b", "duplicate": false}'::jsonb,
  '[CHR-14] a parent links their sign-in to themselves; it moves from the archived record it was on');
select pg_temp.as_owner();
select is(pg_temp.linked('24110000-0000-0000-0000-00000000000a'), '24100000-0000-0000-0000-000000000001'::uuid,
  '[CHR-14] the member now has their sign-in');
select is(pg_temp.linked('24110000-0000-0000-0000-00000000000b'), null,
  '[ACC-04] and the archived record no longer does (a sign-in belongs to one member)');
select pg_temp.as_user('24100000-0000-0000-0000-000000000001');
select is(public.link_my_member('24110000-0000-0000-0000-00000000000a') ->> 'duplicate', 'true',
  '[CHR-14] linking again changes nothing');
select pg_temp.as_owner();
select is((select count(*)::int from public.member where user_id = '24100000-0000-0000-0000-000000000001'), 1,
  '[ACC-04] still on one member');

-- What can't be linked --------------------------------------------------------------------
select pg_temp.as_user('24100000-0000-0000-0000-000000000001');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000c') $$, '23514',
  'only an adult can have a sign-in', '[ACC-04] only an adult can have a sign-in');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000e') $$, '23514',
  'that member is archived', '[ACC-04] not an archived member');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000d') $$, '23514',
  'that member has someone else''s sign-in', '[ACC-04] not a member with someone else''s sign-in');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000f') $$, 'P0002',
  'member not found', '[NFR-04] not a member of another household');
select throws_ok($$ select public.link_my_member(gen_random_uuid()) $$, 'P0002', 'member not found',
  '[ACC-04] not a member that isn''t there');
select pg_temp.as_owner();
select is(pg_temp.linked('24110000-0000-0000-0000-00000000000a'), '24100000-0000-0000-0000-000000000001'::uuid,
  '[CHR-14] a refused link leaves my sign-in where it was');

-- A second parent moves theirs ------------------------------------------------------------
-- (from Partner to a fresh adult record, as for someone who had a duplicate of themselves)
insert into public.member (id, household_id, display_name, role)
values ('24110000-0000-0000-0000-000000000010', '24000000-0000-0000-0000-000000000001', 'Partner too', 'adult');
select pg_temp.as_user('24100000-0000-0000-0000-000000000002');
select is(public.link_my_member('24110000-0000-0000-0000-000000000010') ->> 'moved_from',
  '24110000-0000-0000-0000-00000000000d', '[CHR-14] another parent moves their own sign-in from a duplicate');
select pg_temp.as_owner();
select is(pg_temp.linked('24110000-0000-0000-0000-00000000000d'), null, '[ACC-04] the duplicate is left without one');

-- Who may ---------------------------------------------------------------------------------
select pg_temp.as_user('24d00000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000d') $$, 'P0002', null,
  '[NFR-04] a board links no one');
select pg_temp.as_user('24300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000d') $$, 'P0002', null,
  '[NFR-04] another household''s parent links no one here');
select pg_temp.as_owner();

select ok(not has_function_privilege('anon', 'public.link_my_member(uuid)', 'execute'),
  '[NFR-04] signed out, there is nothing to call');
select pg_temp.as_user(null);
select throws_ok($$ select public.link_my_member('24110000-0000-0000-0000-00000000000d') $$, '42501', null,
  '[ACC-04] without a sign-in, nothing is linked');

select * from finish();
rollback;
