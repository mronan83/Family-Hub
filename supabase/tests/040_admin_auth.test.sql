-- [ACC-01][ACC-02][ACC-03][ACC-05][NFR-04] Admin onboarding, invites and the audit log (WP-03, D-39).
begin;
select plan(44);

-- Fixtures (as the migration owner) -----------------------------------------
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('b2000000-0000-0000-0000-000000000002', 'spouse@example.com'),
  ('b3000000-0000-0000-0000-000000000003', 'other-owner@example.com'),
  ('b4000000-0000-0000-0000-000000000004', 'late@example.com'),
  ('b5000000-0000-0000-0000-000000000005', 'newcomer@example.com');

insert into public.household (id, name, timezone) values
  ('77777777-7777-7777-7777-777777777777', 'Other family', 'Europe/London');
insert into public.household_user (household_id, user_id, role) values
  ('77777777-7777-7777-7777-777777777777', 'b3000000-0000-0000-0000-000000000003', 'owner');

insert into private.household_setup_code (code_hash, expires_at) values
  (private.code_hash('ABCD-EFGH-JKLM'), now() + interval '1 day'),
  (private.code_hash('OLD0-OLD0-OLD0'), now() - interval '1 minute'),
  (private.code_hash('SPARE-SPARE-SPARE'), now() + interval '1 day');

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
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create temp table ids (name text primary key, value text);
grant all on ids to anon, authenticated;

-- Setup code: the first household (ACC-01) -----------------------------------
select pg_temp.act_as('b5000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.setup_code_usable('ABCD-EFGH-JKLM') $$,
  '42501', null, '[ACC-01] signed-in users cannot test setup codes');
set local role service_role;
select results_eq($$ select public.setup_code_usable('ABCD-EFGH-JKLM'), public.setup_code_usable('OLD0-OLD0-OLD0'),
                            public.setup_code_usable('nope') $$,
  $$ values (true, false, false) $$, '[ACC-01] the server can check a setup code before creating an account');

select pg_temp.act_as_anon();
select throws_ok($$ select public.create_household('ABCD-EFGH-JKLM', 'Ours', 'America/Chicago') $$,
  '42501', null, '[ACC-01] anon cannot create a household');

select pg_temp.act_as('b1000000-0000-0000-0000-000000000001');
select throws_like($$ select public.create_household('WRONG-CODE', 'Ours', 'America/Chicago') $$,
  '%setup code is not valid%', '[ACC-01] a wrong setup code is refused');
select throws_like($$ select public.create_household('OLD0-OLD0-OLD0', 'Ours', 'America/Chicago') $$,
  '%setup code is not valid%', '[ACC-01] an expired setup code is refused');
select throws_like($$ select public.create_household('ABCD-EFGH-JKLM', 'Ours', 'Not/AZone') $$,
  '%timezone%', '[ACC-01] an unknown timezone is refused');

insert into ids select 'household', public.create_household('abcd efgh jklm', '  Our family ', 'America/Chicago', 1::smallint)::text;
select is((select name || '|' || timezone || '|' || week_start from public.household where id = (select value::uuid from ids where name = 'household')),
  'Our family|America/Chicago|1',
  '[ACC-01] the code works whatever its case and separators; the household has its timezone and week start');
select is((select role from public.household_user where user_id = 'b1000000-0000-0000-0000-000000000001'), 'owner',
  '[ACC-01] the creator is its owner');
select is((select count(*)::int from public.household_settings where household_id = (select value::uuid from ids where name = 'household')), 1,
  '[ACC-01] the household gets its settings row');

select throws_like($$ select public.create_household('SPARE-SPARE-SPARE', 'Second', 'America/Chicago') $$,
  '%already run a household%', '[ACC-01] an admin cannot create a second household');

select pg_temp.act_as('b5000000-0000-0000-0000-000000000005');
select throws_like($$ select public.create_household('ABCD-EFGH-JKLM', 'Again', 'America/Chicago') $$,
  '%setup code is not valid%', '[ACC-01] a used setup code is refused');

select pg_temp.act_as_owner();
select is((select used_by::text || '|' || household_id::text from private.household_setup_code where code_hash = private.code_hash('ABCD-EFGH-JKLM')),
  'b1000000-0000-0000-0000-000000000001|' || (select value from ids where name = 'household'),
  '[ACC-01] the code records who used it and for which household');

-- Invites (ACC-03) ----------------------------------------------------------
select pg_temp.act_as('b3000000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.create_invite(%L, 'spouse@example.com') $$, (select value from ids where name = 'household')),
  '42501', null, '[NFR-04] an admin of another household cannot invite into this one');

select pg_temp.act_as('b1000000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.create_invite(%L, 'not-an-email') $$, (select value from ids where name = 'household')),
  '22023', null, '[ACC-03] an invite needs a valid email address');
select throws_like(format($$ select public.create_invite(%L, 'OWNER@example.com') $$, (select value from ids where name = 'household')),
  '%already an admin%', '[ACC-03] an existing admin cannot be invited again');

insert into ids select 'first', public.create_invite((select value::uuid from ids where name = 'household'), ' Spouse@Example.com ');
insert into ids select 'spouse', public.create_invite((select value::uuid from ids where name = 'household'), 'spouse@example.com');
select is((select length(value) from ids where name = 'spouse'), 48, '[ACC-03] the invite token is 24 random bytes in hex');
select is((select count(*)::int from public.invite where email = 'spouse@example.com' and revoked_at is null), 1,
  '[ACC-03] a new invite for the same email replaces the open one');
select is((select count(*)::int from public.invite where token_hash in (select value from ids)), 0,
  '[ACC-03] only the hash of a token is stored');
insert into ids select 'late', public.create_invite((select value::uuid from ids where name = 'household'), 'late@example.com');
insert into ids select 'other', public.create_invite((select value::uuid from ids where name = 'household'), 'other-owner@example.com');
insert into ids select 'jamie', public.create_invite((select value::uuid from ids where name = 'household'), 'jamie@example.com');

-- Preview: what the link shows before anyone signs in
select pg_temp.act_as_owner();
update public.invite set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
 where email = 'late@example.com';

select pg_temp.act_as_anon();
select results_eq(format($$ select household_name, email, state from public.invite_preview(%L) $$, (select value from ids where name = 'spouse')),
  $$ values ('Our family'::text, 'spouse@example.com'::text, 'valid'::text) $$,
  '[ACC-03] anon can preview a valid invite: household, email, state');
select is((select state from public.invite_preview((select value from ids where name = 'first'))), 'revoked',
  '[ACC-03] a replaced invite previews as revoked');
select is((select state from public.invite_preview((select value from ids where name = 'late'))), 'expired',
  '[ACC-03] a lapsed invite previews as expired');
select is_empty($$ select * from public.invite_preview('no-such-token') $$,
  '[ACC-03] an unknown token previews nothing');
select throws_ok(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'spouse')),
  '42501', null, '[ACC-03] anon cannot accept an invite');

-- Accept
select pg_temp.act_as('b2000000-0000-0000-0000-000000000002');
select throws_like($$ select public.accept_invite('no-such-token') $$,
  '%not valid%', '[ACC-03] an unknown invite is refused');
select throws_like(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'first')),
  '%replaced or cancelled%', '[ACC-03] a revoked invite is refused');
select is(public.accept_invite((select value from ids where name = 'spouse'))::text, (select value from ids where name = 'household'),
  '[ACC-03] a valid invite is accepted and returns the household');
select results_eq('select name from public.household', $$ values ('Our family'::text) $$,
  '[ACC-02] the second admin sees the same household');
select is((select role from public.household_user where user_id = 'b2000000-0000-0000-0000-000000000002'), 'admin',
  '[ACC-03] the invitee joins as admin');
select results_eq(format($$ select email, role from public.household_admins(%L) $$, (select value from ids where name = 'household')),
  $$ values ('owner@example.com'::text, 'owner'::text), ('spouse@example.com', 'admin') $$,
  '[ACC-03] admins see who administers their household, with emails');

select pg_temp.act_as('b5000000-0000-0000-0000-000000000005');
select throws_like(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'spouse')),
  '%already used%', '[ACC-03] a reused invite is refused');
select throws_like(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'jamie')),
  '%another email address%', '[ACC-03] an invite is accepted only by the account it was sent to');

select pg_temp.act_as('b4000000-0000-0000-0000-000000000004');
select throws_like(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'late')),
  '%expired%', '[ACC-03] an expired invite is refused');

select pg_temp.act_as('b3000000-0000-0000-0000-000000000003');
select throws_like(format($$ select public.accept_invite(%L) $$, (select value from ids where name = 'other')),
  '%another household%', '[ACC-03] an admin of another household cannot join a second one');

-- Audit log (ACC-05) --------------------------------------------------------
select pg_temp.act_as('b1000000-0000-0000-0000-000000000001');
update public.household set name = 'The family' where id = (select value::uuid from ids where name = 'household');
update public.household set name = 'The family' where id = (select value::uuid from ids where name = 'household');

select is((select actor_type || '|' || actor_id || '|' || action from public.audit_log
            where entity_type = 'household' and action = 'insert'),
  'admin|b1000000-0000-0000-0000-000000000001|insert',
  '[ACC-05] creating the household is audited with its admin');
select is((select diff::text from public.audit_log where entity_type = 'household' and action = 'update'),
  '{"name": {"to": "The family", "from": "Our family"}}',
  '[ACC-05] an update keeps only what changed; a no-op update writes nothing');
select is((select count(*)::int from public.audit_log where entity_type = 'invite' and action = 'insert'), 5,
  '[ACC-05] every invite is audited');
select is((select count(*)::int from public.audit_log where entity_type = 'invite' and diff ? 'token_hash'), 0,
  '[ACC-05] audit rows never hold a token hash');
select is((select count(*)::int from public.audit_log
            where entity_type = 'household_user' and action = 'insert' and entity_id = 'b2000000-0000-0000-0000-000000000002'
              and actor_id = 'b2000000-0000-0000-0000-000000000002'), 1,
  '[ACC-05] accepting an invite is audited with the new admin as actor');

select throws_ok($$ insert into public.audit_log (household_id, actor_type, action, entity_type)
                    values ('77777777-7777-7777-7777-777777777777', 'admin', 'insert', 'forged') $$,
  '42501', null, '[ACC-05] admins cannot write the audit log directly');
select throws_ok($$ delete from public.audit_log $$, '42501', null,
  '[ACC-05] admins cannot delete audit rows');

select pg_temp.act_as('b3000000-0000-0000-0000-000000000003');
select is_empty(format($$ select * from public.household_admins(%L) $$, (select value from ids where name = 'household')),
  '[NFR-04] another household''s admin cannot list its admins');
select is((select count(*)::int from public.audit_log where household_id <> '77777777-7777-7777-7777-777777777777'), 0,
  '[NFR-04] another household''s admin sees none of its audit rows');

select pg_temp.act_as_owner();
select is((select actor_type from public.audit_log where entity_type = 'household' and household_id = '77777777-7777-7777-7777-777777777777'
            and action = 'insert'), 'system',
  '[ACC-05] a change without a signed-in user is audited as the system');
delete from public.household where id = (select value::uuid from ids where name = 'household');
select is((select count(*)::int from public.audit_log where household_id = (select value::uuid from ids where name = 'household')), 0,
  '[ACC-05] deleting a household still works and takes its audit trail with it');

select * from finish();
rollback;
