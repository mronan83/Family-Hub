-- [ACC-01][NFR-04][NFR-09][DEV-02] Tenant isolation and device access under RLS (WP-02).
begin;
select plan(24);

-- Fixtures (as the migration owner) -----------------------------------------
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'parent1@example.com'),
  ('a2000000-0000-0000-0000-000000000002', 'parent2@example.com'),
  ('d1000000-0000-0000-0000-000000000001', null),
  ('d2000000-0000-0000-0000-000000000002', null),
  ('d3000000-0000-0000-0000-000000000003', null);

insert into public.household (id, name, timezone) values
  ('11111111-1111-1111-1111-111111111111', 'Household one', 'America/Detroit'),
  ('22222222-2222-2222-2222-222222222222', 'Household two', 'Europe/London');
insert into public.household_settings (household_id) values
  ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.household_user (household_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000002', 'owner');
insert into public.member (household_id, display_name, role, avatar_key) values
  ('11111111-1111-1111-1111-111111111111', 'Sam', 'child', 'owl'),
  ('22222222-2222-2222-2222-222222222222', 'Alex', 'child', 'fox');
insert into public.device (id, household_id, name, auth_user_id, status, revoked_at) values
  ('de100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Kitchen', 'd1000000-0000-0000-0000-000000000001', 'active', null),
  ('de200000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Old board', 'd2000000-0000-0000-0000-000000000002', 'revoked', now()),
  ('de300000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Hall', 'd3000000-0000-0000-0000-000000000003', 'active', null);
insert into public.invite (household_id, email, token_hash, expires_at) values
  ('11111111-1111-1111-1111-111111111111', 'spouse@example.com', 'hash-1', now() + interval '7 days');
insert into public.job_run (household_id, job_type, status) values
  ('11111111-1111-1111-1111-111111111111', 'day_close', 'ok'),
  ('22222222-2222-2222-2222-222222222222', 'day_close', 'ok');

-- Act as a principal the way PostgREST does: role + JWT claims for this transaction.
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;

-- Admin of household one --------------------------------------------------
select pg_temp.act_as('a1000000-0000-0000-0000-000000000001');

select results_eq('select name from public.household', $$ values ('Household one'::text) $$,
  '[ACC-01] an admin sees only their own household');
select results_eq('select display_name from public.member', $$ values ('Sam'::text) $$,
  '[NFR-09] an admin sees only their own members');
select is((select count(*)::int from public.household_user), 1,
  '[NFR-09] an admin sees only their own household admins');
select is((select count(*)::int from public.device), 2,
  '[DEV-03] an admin sees their own devices, including revoked ones');
select is((select count(*)::int from public.job_run), 1,
  '[NFR-09] an admin sees only their own job runs');

select throws_ok(
  $$ insert into public.member (household_id, display_name, role)
     values ('22222222-2222-2222-2222-222222222222', 'Intruder', 'child') $$,
  '42501', null, '[NFR-04] an admin cannot add a member to another household');
select lives_ok(
  $$ insert into public.member (household_id, display_name, role)
     values ('11111111-1111-1111-1111-111111111111', 'Pat', 'adult') $$,
  '[ACC-04] an admin can add a member to their own household');

update public.member set display_name = 'Changed' where household_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.act_as('a2000000-0000-0000-0000-000000000002');
select results_eq('select display_name from public.member', $$ values ('Alex'::text) $$,
  '[NFR-04] an update aimed at another household changes nothing');

-- Admin two cannot see household one's invite
select is((select count(*)::int from public.invite), 0,
  '[NFR-09] invites are invisible to other households');

-- Active device of household one ------------------------------------------
select pg_temp.act_as('d1000000-0000-0000-0000-000000000001');

select results_eq('select display_name from public.member order by display_name',
  $$ values ('Pat'::text), ('Sam'::text) $$, '[DEV-02] an active board reads its household''s members');
select is((select timezone from public.household), 'America/Detroit',
  '[DEV-02] an active board reads its household''s timezone');
select is((select count(*)::int from public.household_settings), 1,
  '[DEV-02] an active board reads its household settings');
select results_eq('select name from public.device', $$ values ('Kitchen'::text) $$,
  '[DEV-02] a board sees only its own device row');
select is((select count(*)::int from public.invite), 0, '[DEV-02] a board cannot read invites');
select is((select count(*)::int from public.household_user), 0, '[DEV-02] a board cannot read admins');
select is((select count(*)::int from public.device_pairing), 0, '[DEV-02] a board cannot read pairing codes');

select throws_ok(
  $$ insert into public.member (household_id, display_name, role)
     values ('11111111-1111-1111-1111-111111111111', 'Board-made', 'child') $$,
  '42501', null, '[DEV-02] a board cannot write members');
update public.household_settings set approval_mode = 'on';
select is((select approval_mode from public.household_settings), 'off',
  '[DEV-02] a board cannot change settings');

-- Revoked device and immediate revocation ---------------------------------
select pg_temp.act_as('d2000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.member), 0, '[DEV-02] a revoked board reads nothing');

reset role;
update public.device set status = 'revoked', revoked_at = now()
 where id = 'de100000-0000-0000-0000-000000000001';
select pg_temp.act_as('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.member), 0,
  '[DEV-02] revoking a board blocks its next query without waiting for token expiry');
select is((select count(*)::int from public.household), 0,
  '[DEV-02] a revoked board cannot read its household');

-- Anonymous ---------------------------------------------------------------
select pg_temp.act_as_anon();
select is((select count(*)::int from public.member), 0, '[NFR-04] anon reads no members');
select is((select count(*)::int from public.household), 0, '[NFR-04] anon reads no households');

-- Data rules --------------------------------------------------------------
reset role;
select throws_ok(
  $$ insert into public.household (name, timezone) values ('Bad tz', 'Mars/Olympus') $$,
  '22023', null, '[ACC-01] an unknown IANA timezone is rejected');

select * from finish();
rollback;
