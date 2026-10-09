-- [DEV-01][DEV-02][DEV-03][NFR-04] Device pairing, device identity and revocation (WP-05, D-40).
begin;
select plan(35);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('f2000000-0000-0000-0000-000000000002', 'elsewhere@example.com');
insert into public.household (id, name, timezone) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Boards', 'America/Chicago'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Elsewhere', 'America/Chicago');
insert into public.household_user (household_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'owner');
insert into public.member (household_id, display_name, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Maya', 'child'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Other kid', 'child');

create function pg_temp.act_as(p_user uuid, p_app jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'app_metadata', p_app)::text, true);
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
create temp table v (name text primary key, value text);
grant all on v to anon, authenticated;

-- Issue -----------------------------------------------------------------------
select pg_temp.act_as('f2000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', 'Kitchen') $$,
  '42501', null, '[NFR-04] an admin of another household cannot pair a board here');

select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', '  ') $$,
  '22023', null, '[DEV-01] a board needs a name');
insert into v select 'code', public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', ' Kitchen ');
insert into v select 'late', public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', 'Hall');
select ok((select value ~ '^[0-9]{8}$' from v where name = 'code'), '[DEV-01] the code is 8 digits');
select pg_temp.act_as_owner();
select is((select device_name || '|' || (expires_at - created_at)::text from public.device_pairing
            where code_hash = private.pairing_code_hash((select value from v where name = 'code'))),
  'Kitchen|00:10:00', '[DEV-01] the code carries the board''s name and lasts 10 minutes');
select is((select count(*)::int from public.device_pairing where code_hash in (select value from v)), 0,
  '[DEV-01] only the hash of a code is stored');

update public.device_pairing set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
 where device_name = 'Hall';

-- Redeem ------------------------------------------------------------------------
select pg_temp.act_as_anon();
select is(public.redeem_pairing_code('00000000') ->> 'reason', 'invalid', '[DEV-01] an unknown code is refused');
select is(public.redeem_pairing_code((select value from v where name = 'late')) ->> 'reason', 'invalid',
  '[DEV-01] an expired code is refused');
insert into v select 'pair', public.redeem_pairing_code(
  (select substr(value, 1, 4) || '-' || substr(value, 5) from v where name = 'code'))::text;
select is((select (value::jsonb) ->> 'ok' from v where name = 'pair'), 'true',
  '[DEV-01] a valid code pairs the board, whatever separators were typed');
select is(public.redeem_pairing_code((select value from v where name = 'code')) ->> 'reason', 'invalid',
  '[DEV-01] a code works once');

select pg_temp.act_as_owner();
insert into v select 'device', (value::jsonb) ->> 'device_id' from v where name = 'pair';
insert into v select 'user', auth_user_id::text from public.device where id = (select value::uuid from v where name = 'device');
select is((select name || '|' || status || '|' || household_id from public.device where id = (select value::uuid from v where name = 'device')),
  'Kitchen|active|aaaaaaaa-0000-4000-8000-000000000001', '[DEV-01] the device is active in its household, with its name');
select is((select raw_app_meta_data ->> 'role' || '|' || (raw_app_meta_data ->> 'device_id') from auth.users
            where id = (select value::uuid from v where name = 'user')),
  'device|' || (select value from v where name = 'device'), '[DEV-02] the board''s sign-in says it is a device');
select ok((select encrypted_password = extensions.crypt((select (value::jsonb) ->> 'password' from v where name = 'pair'), encrypted_password)
             from auth.users where id = (select value::uuid from v where name = 'user')),
  '[DEV-02] the credential handed to the board signs it in; only its bcrypt hash is stored');
select is((select count(*)::int from auth.identities where user_id = (select value::uuid from v where name = 'user') and provider = 'email'), 1,
  '[DEV-02] the board has an email identity, as Supabase Auth expects');
select is((select device_id::text from public.device_pairing where device_name = 'Kitchen'), (select value from v where name = 'device'),
  '[DEV-01] the code records the device it created');
select is((select count(*)::int from private.pairing_failure), 3, '[DEV-01] each wrong code is counted');

-- What a board may do -----------------------------------------------------------
create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform pg_temp.act_as((select value::uuid from v where name = 'user'),
    jsonb_build_object('role', 'device', 'device_id', (select value from v where name = 'device')));
end $$;
select pg_temp.as_board();
select results_eq('select name from public.household', $$ values ('Boards'::text) $$,
  '[DEV-02] a board reads its own household');
select results_eq('select display_name from public.member', $$ values ('Maya'::text) $$,
  '[DEV-02] a board reads its household''s members only');
select throws_ok($$ insert into public.member (household_id, display_name, role)
                    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Sneaky', 'child') $$,
  '42501', null, '[DEV-02] a board cannot write members');
select throws_ok($$ select public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', 'Clone') $$,
  '42501', null, '[DEV-02] a board cannot pair another board');
select is((select count(*)::int from public.device_pairing), 0, '[DEV-02] a board cannot read pairing codes');

select public.device_heartbeat('0.1.0');
select pg_temp.act_as_owner();
select ok((select last_seen_at is not null and app_version = '0.1.0' from public.device
            where id = (select value::uuid from v where name = 'device')), '[DEV-03] the board reports when it was last seen');
update public.device set last_seen_at = now() - interval '30 seconds' where id = (select value::uuid from v where name = 'device');
insert into v select 'seen', last_seen_at::text from public.device where id = (select value::uuid from v where name = 'device');
select pg_temp.as_board();
select public.device_heartbeat('0.1.0');
select pg_temp.act_as_owner();
select is((select last_seen_at::text from public.device where id = (select value::uuid from v where name = 'device')),
  (select value from v where name = 'seen'), '[DEV-03] reporting in is written at most once a minute');
select is((select count(*)::int from public.audit_log where entity_type = 'device' and action = 'update'), 0,
  '[ACC-05] reporting in leaves no audit row');

-- Admins manage boards ----------------------------------------------------------
select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
select lives_ok(format($$ update public.device set name = 'Kitchen board' where id = %L $$, (select value from v where name = 'device')),
  '[DEV-03] an admin renames a board');
select throws_ok(format($$ update public.device set status = 'revoked', revoked_at = now() where id = %L $$, (select value from v where name = 'device')),
  '42501', null, '[DEV-03] status changes only through revoke_device');

select pg_temp.act_as('f2000000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.revoke_device(%L) $$, (select value from v where name = 'device')),
  '42501', null, '[NFR-04] an admin of another household cannot disconnect the board');

select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.revoke_device(%L) $$, (select value from v where name = 'device')),
  '[DEV-03] an admin disconnects the board');
select is((select status from public.device where id = (select value::uuid from v where name = 'device')), 'revoked',
  '[DEV-03] the board shows as disconnected, and stays listed');

select pg_temp.as_board();
select is((select count(*)::int from public.member), 0, '[DEV-02] a disconnected board reads nothing at once');
select is((select count(*)::int from public.device), 0, '[DEV-02] a disconnected board cannot read its own row');

select pg_temp.act_as_owner();
select ok((select banned_until = 'infinity' from auth.users where id = (select value::uuid from v where name = 'user')),
  '[DEV-02] the board''s sign-in is banned, so it cannot sign in or refresh again');
select throws_ok(format($$ update public.device set status = 'active', revoked_at = null where id = %L $$, (select value from v where name = 'device')),
  '23514', null, '[DEV-02] a disconnected board is never reconnected; it pairs again');
select is((select string_agg(actor_type || ':' || action || ':' || coalesce(diff -> 'status' ->> 'to', diff -> 'name' ->> 'to', diff ->> 'status'), ',' order by id)
             from public.audit_log where entity_type = 'device'),
  'system:insert:active,admin:update:Kitchen board,admin:update:revoked',
  '[ACC-05] pairing, renaming and disconnecting are audited');

-- Throttle ----------------------------------------------------------------------
insert into private.pairing_failure (at) select now() from generate_series(1, 17);
select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
insert into v select 'busy', public.create_pairing_code('aaaaaaaa-0000-4000-8000-000000000001', 'Den');
select pg_temp.act_as_anon();
select is(public.redeem_pairing_code((select value from v where name = 'busy')) ->> 'reason', 'paused',
  '[DEV-01] after 20 wrong codes in 10 minutes pairing pauses, so codes cannot be guessed');
select pg_temp.act_as_owner();
update private.pairing_failure set at = now() - interval '11 minutes';
select pg_temp.act_as_anon();
select is(public.redeem_pairing_code((select value from v where name = 'busy')) ->> 'ok', 'true',
  '[DEV-01] pairing resumes when the 10 minutes have passed');

select * from finish();
rollback;
