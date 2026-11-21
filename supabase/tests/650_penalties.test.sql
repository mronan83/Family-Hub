-- [PTS-09] One-time penalties and the penalty balance (WP-120, D-154, D-156): the household's on/off
-- (off by default) and penalty reasons; give_penalty() in points (a `penalty` ledger entry, taken at
-- once) or money (owed until paid); record_penalty_paid(); take_back_penalty(); who may; what the
-- board's snapshot shows; the points register's Penalty type.
begin;
select plan(45);

insert into auth.users (id, email) values
  ('65100000-0000-0000-0000-0000000000a1', 'alex@example.com'),
  ('65100000-0000-0000-0000-0000000000a2', 'sam@example.com'),
  ('65100000-0000-0000-0000-0000000000b1', 'other@example.com'),
  ('65100000-0000-0000-0000-0000000000d1', 'board@example.com');
insert into public.household (id, name, timezone) values
  ('65000000-0000-0000-0000-000000000001', 'Penalty family', 'America/Chicago'),
  ('65000000-0000-0000-0000-000000000002', 'Another family', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('65000000-0000-0000-0000-000000000001'), ('65000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('65000000-0000-0000-0000-000000000001', '65100000-0000-0000-0000-0000000000a1', 'owner'),
  ('65000000-0000-0000-0000-000000000001', '65100000-0000-0000-0000-0000000000a2', 'admin'),
  ('65000000-0000-0000-0000-000000000002', '65100000-0000-0000-0000-0000000000b1', 'owner');
insert into public.member (id, household_id, display_name, role, user_id, earns_rewards, archived_at) values
  ('65110000-0000-0000-0000-0000000000a1', '65000000-0000-0000-0000-000000000001', 'Alex', 'adult', '65100000-0000-0000-0000-0000000000a1', false, null),
  ('65110000-0000-0000-0000-00000000000a', '65000000-0000-0000-0000-000000000001', 'Maya', 'child', null, true, null),
  ('65110000-0000-0000-0000-00000000000b', '65000000-0000-0000-0000-000000000001', 'Leo', 'child', null, true, null),
  ('65110000-0000-0000-0000-00000000000e', '65000000-0000-0000-0000-000000000001', 'Ezra', 'child', null, true, now()),
  ('65110000-0000-0000-0000-00000000000c', '65000000-0000-0000-0000-000000000002', 'Kim', 'child', null, true, null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('65d00000-0000-4000-8000-000000000001', '65000000-0000-0000-0000-000000000001', 'Kitchen', '65100000-0000-0000-0000-0000000000d1');

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function pg_temp.as_board() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', '65100000-0000-0000-0000-0000000000d1', 'role', 'authenticated',
           'app_metadata', json_build_object('role', 'device', 'device_id', '65d00000-0000-4000-8000-000000000001'))::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;
create function pg_temp.balance(p_member uuid) returns integer language sql as $$
  select coalesce(sum(amount), 0)::integer from public.points_ledger where member_id = p_member $$;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- PTS-09-a: off by default, and only a parent turns it on --------------------------------------
select pg_temp.as_user('65100000-0000-0000-0000-0000000000a1');  -- Alex
select is((select penalties_on from public.household_settings where household_id = '65000000-0000-0000-0000-000000000001'),
  false, '[PTS-09-a] penalties are off for a new household');

-- PTS-09-b: the reasons -------------------------------------------------------------------------
insert into ids values
  ('rude', public.add_penalty_reason('65000000-0000-0000-0000-000000000001', ' Rude to a sibling ', 'points', 10)),
  ('bike', public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Left bike in the driveway', 'money', 100)),
  ('old', public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Slammed a door', 'points', 5));
select is((select array_agg(name || ':' || unit || ':' || amount order by name) from public.penalty_reason
            where household_id = '65000000-0000-0000-0000-000000000001'),
  array['Left bike in the driveway:money:100', 'Rude to a sibling:points:10', 'Slammed a door:points:5'],
  '[PTS-09-b] a parent adds reasons in points or money (cents), each with its amount, the name trimmed');
select throws_ok($$ select public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'rude to a SIBLING', 'points', 3) $$,
  '23505', null, '[PTS-09-b] two reasons of one name are refused');
select throws_ok($$ select public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Too much', 'points', 10001) $$,
  '22023', null, '[PTS-09-b] a points reason is 1 to 10000 points');
select throws_ok($$ select public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Nothing', 'money', 0) $$,
  '22023', null, '[PTS-09-b] and never nothing');

select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'rude'), null,
                                               'a0000000-0000-4000-8000-000000000001') $$,
  '22023', 'penalties are off', '[PTS-09-a] no penalty while penalties are off');

select pg_temp.as_user('65100000-0000-0000-0000-0000000000b1');  -- another family's parent
select throws_ok($$ select public.set_penalties_on('65000000-0000-0000-0000-000000000001', true) $$,
  '42501', null, '[PTS-09-a] a parent of another household cannot turn them on');
select throws_ok($$ select public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Theirs', 'points', 1) $$,
  '42501', null, '[PTS-09-b] nor add a reason');
select is((select count(*)::integer from public.penalty_reason), 0, '[PTS-09-g] nor read the reasons');

select pg_temp.as_user('65100000-0000-0000-0000-0000000000a2');  -- Sam
select is(public.set_penalties_on('65000000-0000-0000-0000-000000000001', true), true,
  '[PTS-09-a] a parent turns penalties on');

-- PTS-09-c: a points penalty --------------------------------------------------------------------
select is((public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'rude'), null,
                               'a0000000-0000-4000-8000-000000000002') - 'id'),
  '{"duplicate": false, "unit": "points", "amount": 10, "owed": 0, "balance": -10}'::jsonb,
  '[PTS-09-c] a points penalty is taken at once, the reason''s amount, and owes nothing (D-156)');
select is((public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'rude'), null,
                               'a0000000-0000-4000-8000-000000000002') ->> 'duplicate')::boolean, true,
  '[PTS-09-c] sending it again gives it once');
select results_eq(
  $$ select entry_type, amount, reason, created_by_type, created_by::text from public.points_ledger
      where member_id = '65110000-0000-0000-0000-00000000000a' $$,
  $$ values ('penalty', -10, 'Rude to a sibling', 'admin', '65100000-0000-0000-0000-0000000000a2') $$,
  '[PTS-09-c] one penalty entry of −10, with the reason, by Sam');
select is(pg_temp.balance('65110000-0000-0000-0000-00000000000a'), -10,
  '[PTS-09-c] the balance may go below zero, as points to earn back');
select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-00000000000b', (select id from ids where k = 'rude'), null,
                                               'a0000000-0000-4000-8000-000000000002') $$,
  '22023', 'that request was already used for something else', '[PTS-09-c] a request used for another penalty is refused');
insert into ids values ('leo-rude', (public.give_penalty('65110000-0000-0000-0000-00000000000b', (select id from ids where k = 'rude'), 20,
                                                         'a0000000-0000-4000-8000-000000000003') ->> 'id')::uuid);
select is(pg_temp.balance('65110000-0000-0000-0000-00000000000b'), -20,
  '[PTS-09-c] the parent may change the amount for this one');

-- PTS-09-d: a money penalty ---------------------------------------------------------------------
insert into ids values ('maya-bike', (public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'bike'), null,
                                                          'a0000000-0000-4000-8000-000000000004') ->> 'id')::uuid);
insert into ids values ('maya-bike2', (public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'bike'), 250,
                                                           'a0000000-0000-4000-8000-000000000005') ->> 'id')::uuid);
select is((select sum(amount)::integer from public.penalty where member_id = '65110000-0000-0000-0000-00000000000a' and unit = 'money'),
  350, '[PTS-09-d] money penalties add to what Maya owes: $1 and $2.50');
select is(pg_temp.balance('65110000-0000-0000-0000-00000000000a'), -10, '[PTS-09-d] and change nothing in her points');

-- PTS-09-e: paid --------------------------------------------------------------------------------
select is(public.record_penalty_paid((select id from ids where k = 'maya-bike2'), 150, 'b0000000-0000-4000-8000-000000000001') ->> 'owed',
  '100', '[PTS-09-e] paying part of a penalty leaves the rest owed');
select is(public.record_penalty_paid((select id from ids where k = 'maya-bike2'), 150, 'b0000000-0000-4000-8000-000000000001') ->> 'owed',
  '100', '[PTS-09-e] sending it again records it once');
select throws_ok($$ select public.record_penalty_paid((select id from ids where k = 'maya-bike2'), 101, 'b0000000-0000-4000-8000-000000000002') $$,
  '22023', 'up to what is owed', '[PTS-09-e] never more than is owed');
select throws_ok($$ select public.record_penalty_paid((select id from ids where k = 'leo-rude'), 1, 'b0000000-0000-4000-8000-000000000003') $$,
  '22023', null, '[PTS-09-e] a points penalty has nothing to pay');
select is(public.record_penalty_paid((select id from ids where k = 'maya-bike2'), 100, 'b0000000-0000-4000-8000-000000000004') ->> 'owed',
  '0', '[PTS-09-e] paying the rest leaves nothing owed');
select is((select count(*)::integer from public.penalty_payment), 2, '[PTS-09-e] each payment is kept in the history');

-- PTS-09-b: a reason removed --------------------------------------------------------------------
insert into ids values ('maya-old', (public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'old'), null,
                                                         'a0000000-0000-4000-8000-000000000006') ->> 'id')::uuid);
select lives_ok($$ select public.remove_penalty_reason((select id from ids where k = 'old')) $$,
  '[PTS-09-b] a parent removes a reason');
select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'old'), null,
                                               'a0000000-0000-4000-8000-000000000007') $$,
  '22023', 'choose a reason from the list', '[PTS-09-b] a removed reason is not offered again');
select is((select reason from public.penalty where id = (select id from ids where k = 'maya-old')), 'Slammed a door',
  '[PTS-09-b] a penalty given with it keeps its reason');
select lives_ok($$ select public.add_penalty_reason('65000000-0000-0000-0000-000000000001', 'Slammed a door', 'points', 8) $$,
  '[PTS-09-b] and its name can be used again');

-- PTS-09-f: taken back --------------------------------------------------------------------------
select is(public.take_back_penalty((select id from ids where k = 'maya-old')) ->> 'owed', '0',
  '[PTS-09-f] a parent takes back a points penalty');
select is(pg_temp.balance('65110000-0000-0000-0000-00000000000a'), -10,
  '[PTS-09-f] its points come back with a penalty entry');
select lives_ok($$ select public.take_back_penalty((select id from ids where k = 'maya-old')) $$,
  '[PTS-09-f] taking it back again');
select is((select count(*)::integer from public.points_ledger where penalty_id = (select id from ids where k = 'maya-old')), 2,
  '[PTS-09-f] changes nothing more');
select is(public.take_back_penalty((select id from ids where k = 'maya-bike')) ->> 'owed', '0',
  '[PTS-09-f] a money penalty taken back owes nothing');

-- PTS-09-g: who, for whom, and only through the functions ---------------------------------------
select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-0000000000a1', (select id from ids where k = 'rude'), null,
                                               'a0000000-0000-4000-8000-000000000008') $$,
  '22023', 'this member does not earn rewards', '[PTS-09-g] only for someone who earns rewards');
select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-00000000000e', (select id from ids where k = 'rude'), null,
                                               'a0000000-0000-4000-8000-000000000009') $$,
  '22023', 'archived members get no penalties', '[PTS-09-g] and not archived');
select throws_ok($$ insert into public.penalty (household_id, member_id, reason, unit, amount, given_by, dedupe_key)
                   values ('65000000-0000-0000-0000-000000000001', '65110000-0000-0000-0000-00000000000a', 'x', 'money', 1,
                           '65100000-0000-0000-0000-0000000000a2', 'x') $$,
  '42501', null, '[PTS-09-g] nobody writes penalties but the functions');

select pg_temp.as_owner();
select throws_ok($$ update public.penalty set amount = 1 where id = (select id from ids where k = 'leo-rude') $$,
  '42501', 'penalties are append-only', '[PTS-09-g] a penalty is never changed');
select throws_ok($$ delete from public.penalty_payment $$,
  '42501', 'penalties are append-only', '[PTS-09-g] nor a payment deleted');

select pg_temp.as_user('65100000-0000-0000-0000-0000000000b1');  -- another family's parent
select throws_ok($$ select public.give_penalty('65110000-0000-0000-0000-00000000000a', (select id from ids where k = 'rude'), null,
                                               'a0000000-0000-4000-8000-00000000000a') $$,
  '42501', null, '[PTS-09-g] another household''s parent cannot give one');
select is((select count(*)::integer from public.penalty) + (select count(*)::integer from public.penalty_payment), 0,
  '[PTS-09-g] nor read them');

-- PTS-09-h: the board ---------------------------------------------------------------------------
select pg_temp.as_board();
select is((select m -> 'owes' from jsonb_array_elements(public.board_snapshot() -> 'members') m where m ->> 'display_name' = 'Maya'),
  '[]'::jsonb, '[PTS-09-h] Maya owes nothing now: one paid, one taken back');
select is((select jsonb_agg(e ->> 'type' || ':' || (e ->> 'label') || ':' || (e ->> 'amount'))
             from jsonb_array_elements(public.board_snapshot() -> 'members') m, jsonb_array_elements(m -> 'points' -> 'recent') e
            where m ->> 'display_name' = 'Maya'),
  '["penalty:Rude to a sibling:-10"]'::jsonb,
  '[PTS-09-h] the board shows a penalty with its reason, and leaves one taken back out both ways');

select pg_temp.as_user('65100000-0000-0000-0000-0000000000a2');  -- Sam
select public.give_penalty('65110000-0000-0000-0000-00000000000b', (select id from ids where k = 'bike'), 300,
                           'a0000000-0000-4000-8000-00000000000b');
select pg_temp.as_board();
select is((select (m -> 'owes') #- '{0,id}' from jsonb_array_elements(public.board_snapshot() -> 'members') m where m ->> 'display_name' = 'Leo'),
  '[{"reason": "Left bike in the driveway", "owed": 300}]'::jsonb,
  '[PTS-09-h] what Leo owes shows on the board, with its reason');

select pg_temp.as_user('65100000-0000-0000-0000-0000000000a2');
select public.set_penalties_on('65000000-0000-0000-0000-000000000001', false);
select pg_temp.as_board();
select is((select m -> 'owes' from jsonb_array_elements(public.board_snapshot() -> 'members') m where m ->> 'display_name' = 'Leo'),
  'null'::jsonb, '[PTS-09-h] with penalties off, nothing owed shows');

-- PTS-09-i: the register ------------------------------------------------------------------------
select pg_temp.as_user('65100000-0000-0000-0000-0000000000a1');
select is((select array_agg(kind || ':' || amount || ':' || reason order by created_at, id)
             from public.points_register('65000000-0000-0000-0000-000000000001', null, array['penalty'])),
  array['penalty:-10:Rude to a sibling', 'penalty:-20:Rude to a sibling', 'penalty:-5:Slammed a door', 'penalty:5:Slammed a door'],
  '[PTS-09-i] the points register lists penalties as their own type, a take-back included');

select * from finish();
rollback;
