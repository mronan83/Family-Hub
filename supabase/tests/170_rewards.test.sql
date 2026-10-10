-- [PTS-03][PTS-04] The rewards shop (WP-18): a household's catalog, read by its admins and boards and
-- changed only by its admins; redemptions asked for on the board within the available balance (less
-- what is already asked for), stock and weekly limit; approved (a spend, once), denied, cancelled (a
-- refund once approved) and fulfilled by a parent; photos in the household's own folder. Two requests
-- at once are tested in scripts/redemption-race.sh.
begin;
select plan(49);

insert into auth.users (id, email) values
  ('17100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('17300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('17d00000-0000-0000-0000-00000000000d', null),
  ('17d00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone, week_start) values
  ('17000000-0000-0000-0000-000000000001', 'Shop family', 'America/Chicago', 1),
  ('17000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('17000000-0000-0000-0000-000000000001', '17100000-0000-0000-0000-000000000001', 'owner'),
  ('17000000-0000-0000-0000-000000000002', '17300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('17110000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('17110000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('17110000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000001', 'Pat', 'adult', '17100000-0000-0000-0000-000000000001'),
  ('17110000-0000-0000-0000-000000000009', '17000000-0000-0000-0000-000000000002', 'Dee', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('17dd0000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Kitchen', '17d00000-0000-0000-0000-00000000000d'),
  ('17dd0000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000002', 'Hall', '17d00000-0000-0000-0000-00000000000e');

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.ask(p_id text, p_member text, p_item text) returns jsonb language sql as $$
  select public.request_redemption(p_id::uuid, p_member::uuid, p_item::uuid)
$$;
create function pg_temp.balance(p_member text) returns int language sql as $$
  select coalesce(sum(amount), 0)::int from public.points_ledger where member_id = p_member::uuid
$$;
create function pg_temp.status(p_id text) returns text language sql as $$
  select status from public.redemption where id = p_id::uuid
$$;

-- [PTS-03] The parent stocks the shop and gives Maya 120 points, Leo 50.
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
insert into public.reward_catalog_item (id, household_id, title, icon, cost_points, stock, weekly_limit, active) values
  ('17c00000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Movie night', 'ticket', 100, null, null, true),
  ('17c00000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000001', 'Ice cream trip', 'gift', 20, null, 1, true),
  ('17c00000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000001', 'Stay up late', 'moon', 10, 1, null, true),
  ('17c00000-0000-0000-0000-000000000004', '17000000-0000-0000-0000-000000000001', 'Old prize', 'gift', 10, null, null, false);
select public.adjust_points('17110000-0000-0000-0000-000000000001', 120, 'Saved up', gen_random_uuid());
select public.adjust_points('17110000-0000-0000-0000-000000000002', 50, 'Saved up', gen_random_uuid());
select is((select count(*)::int from public.reward_catalog_item), 4, '[PTS-03] a parent adds rewards to the shop');
select throws_ok($$ delete from public.reward_catalog_item where id = '17c00000-0000-0000-0000-000000000004' $$,
                 '42501', null, '... and archives rather than deletes them');
select throws_ok($$ insert into public.reward_catalog_item (household_id, title, cost_points)
                    values ('17000000-0000-0000-0000-000000000002', 'Not mine', 5) $$,
                 '42501', null, '... only in their own household');
select throws_ok($$ insert into public.reward_catalog_item (household_id, title, cost_points)
                    values ('17000000-0000-0000-0000-000000000001', 'Free', 0) $$,
                 '23514', null, 'a reward costs at least a point');

select pg_temp.as_user('17300000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.reward_catalog_item), 0, 'another household sees none of it');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int from public.reward_catalog_item), 4, 'its board reads the shop');
update public.reward_catalog_item set cost_points = 1;
select is((select sum(cost_points)::int from public.reward_catalog_item), 140, '... but cannot change it');

-- [PTS-04][US-1104] Maya asks for Movie night on the board.
select is(pg_temp.ask('17e00000-0000-0000-0000-000000000001', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000001') ->> 'status',
          'requested', 'a child asks for a reward on the board');
select is((select requested_by_type || ':' || requested_by || ':' || cost_snapshot from public.redemption
            where id = '17e00000-0000-0000-0000-000000000001'),
          'device:17dd0000-0000-0000-0000-000000000001:100', '... recorded as that board, at its cost now');
select is(pg_temp.ask('17e00000-0000-0000-0000-000000000001', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000001') ->> 'duplicate',
          'true', 'asking again with the same id is the same request');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000001', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000002') $$,
                 '23514', null, 'a request id cannot be reused for something else');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000002', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000001') $$,
                 '23514', 'not enough points', '[US-1104] 120 points with 100 asked for: another 100 is refused');
select is(pg_temp.ask('17e00000-0000-0000-0000-000000000003', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000002') ->> 'status',
          'requested', '... while 20 more still fits');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000004', '17110000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000004') $$,
                 'P0002', null, 'a reward taken off the shop cannot be asked for');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000005', '17110000-0000-0000-0000-000000000003', '17c00000-0000-0000-0000-000000000003') $$,
                 '23514', null, '[D-32] a member who does not earn rewards cannot ask');
select is(pg_temp.ask('17e00000-0000-0000-0000-000000000006', '17110000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000003') ->> 'status',
          'requested', 'Leo asks for the last Stay up late');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000007', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000003') $$,
                 '23514', 'that reward is out of stock', '[US-1103] with its one in stock asked for, it is out of stock');
select is(pg_temp.ask('17e00000-0000-0000-0000-000000000008', '17110000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000002') ->> 'status',
          'requested', 'Leo asks for an ice cream trip');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-000000000009', '17110000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000002') $$,
                 '23514', 'asked for enough of that this week', '... and not a second one this week (its weekly limit)');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000e');
select throws_ok($$ select pg_temp.ask('17e00000-0000-0000-0000-00000000000a', '17110000-0000-0000-0000-000000000001', '17c00000-0000-0000-0000-000000000003') $$,
                 '42501', null, 'another household''s board cannot ask for this family');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select throws_ok($$ insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot, requested_by_type)
                    values (gen_random_uuid(), '17000000-0000-0000-0000-000000000001', '17110000-0000-0000-0000-000000000001',
                            '17c00000-0000-0000-0000-000000000004', 1, 'device') $$,
                 '42501', null, 'requests are made only by the function, never directly');
select throws_ok($$ select public.decide_redemption('17e00000-0000-0000-0000-000000000001', 'approve') $$,
                 '42501', null, 'a board cannot approve');
select pg_temp.as_nobody();
select is(pg_temp.balance('17110000-0000-0000-0000-000000000001'), 120, 'asking spends nothing yet');

-- [PTS-04][US-1105] The parent approves Movie night: one spend of its cost.
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
select is(public.decide_redemption('17e00000-0000-0000-0000-000000000001', 'approve') ->> 'status', 'approved',
          'a parent approves');
select is(public.decide_redemption('17e00000-0000-0000-0000-000000000001', 'approve') ->> 'duplicate', 'true',
          'approving again changes nothing');
select throws_ok($$ select public.decide_redemption('17e00000-0000-0000-0000-000000000001', 'deny') $$,
                 '23514', null, 'an approved request is not denied after');
select pg_temp.as_nobody();
select is((select string_agg(entry_type || ' ' || amount || ' ' || reason || ' ' || (redemption_id is not null), ',')
             from public.points_ledger where redemption_id = '17e00000-0000-0000-0000-000000000001'),
          'spend -100 Movie night true', '... one spend of its cost, named for it');
select is(pg_temp.balance('17110000-0000-0000-0000-000000000001'), 20, 'the balance drops by the cost asked');
select throws_ok($$ insert into public.points_ledger (household_id, member_id, entry_type, amount, dedupe_key, created_by_type)
                    values ('17000000-0000-0000-0000-000000000001', '17110000-0000-0000-0000-000000000001', 'spend', -5, 'x', 'admin') $$,
                 '23514', null, 'a spend always names its redemption');

-- A board shows what the points went on.
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select is((select x -> 'points' -> 'recent' -> 0 ->> 'label' from jsonb_array_elements(public.board_snapshot() -> 'members') m(x)
            where x ->> 'display_name' = 'Maya'),
          'Movie night', 'the board''s points list says what was bought');
select is((select count(*)::int from public.redemption), 4, 'the board reads its family''s requests');

-- Denied: nothing spent. Cancelled while waiting: nothing posted.
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
select is(public.decide_redemption('17e00000-0000-0000-0000-000000000008', 'deny', 'Not this week') ->> 'status', 'denied',
          '[US-1105] a parent denies');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select is(public.cancel_redemption('17e00000-0000-0000-0000-000000000006') ->> 'status', 'cancelled',
          '[US-1104] a child cancels a waiting request on the board');
select is(public.cancel_redemption('17e00000-0000-0000-0000-000000000006') ->> 'duplicate', 'true',
          '... once');
select pg_temp.as_nobody();
select is((select count(*)::int from public.points_ledger
            where redemption_id in ('17e00000-0000-0000-0000-000000000006', '17e00000-0000-0000-0000-000000000008')),
          0, 'neither a denial nor a waiting cancel posts anything');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select is(pg_temp.ask('17e00000-0000-0000-0000-00000000000b', '17110000-0000-0000-0000-000000000002', '17c00000-0000-0000-0000-000000000003') ->> 'status',
          'requested', 'a cancelled request frees its stock');

-- Cancelled after approval: refunded once, only by a parent.
select throws_ok($$ select public.cancel_redemption('17e00000-0000-0000-0000-000000000001') $$,
                 '42501', null, 'a board cannot cancel an approved reward');
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
select is(public.decide_redemption('17e00000-0000-0000-0000-000000000003', 'approve') ->> 'status', 'approved',
          'the ice cream trip is approved');
select is(public.cancel_redemption('17e00000-0000-0000-0000-000000000003') ->> 'status', 'cancelled',
          'a parent cancels an approved reward');
select pg_temp.as_nobody();
select is((select string_agg(entry_type || ' ' || amount, ',' order by created_at) from public.points_ledger
            where redemption_id = '17e00000-0000-0000-0000-000000000003'),
          'spend -20,refund 20', '... and its points come back once');

-- Fulfilled: bookkeeping.
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
select throws_ok($$ select public.fulfil_redemption('17e00000-0000-0000-0000-00000000000b') $$,
                 '23514', 'approve it first', 'a waiting request is approved before it is given');
select is(public.fulfil_redemption('17e00000-0000-0000-0000-000000000001') ->> 'status', 'fulfilled',
          '[US-1105] a parent marks an approved reward given');
select throws_ok($$ select public.cancel_redemption('17e00000-0000-0000-0000-000000000001') $$,
                 '23514', null, 'a reward already given is not cancelled');
select pg_temp.as_user('17300000-0000-0000-0000-000000000003');
select throws_ok($$ select public.decide_redemption('17e00000-0000-0000-0000-00000000000b', 'approve') $$,
                 '42501', null, 'another household''s parent cannot decide');

-- Photos: each household's own folder.
select pg_temp.as_user('17100000-0000-0000-0000-000000000001');
select lives_ok($$ insert into storage.objects (bucket_id, name)
                   values ('rewards', '17000000-0000-0000-0000-000000000001/17c00000-0000-0000-0000-000000000001/a.jpg') $$,
                'a parent adds a photo in their household''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name)
                    values ('rewards', '17000000-0000-0000-0000-000000000002/17c00000-0000-0000-0000-000000000001/b.jpg') $$,
                 '42501', null, '... not in another''s');
select pg_temp.as_user('17d00000-0000-0000-0000-00000000000d');
select is((select count(*)::int from storage.objects where bucket_id = 'rewards'), 1, 'its board can read it');
select pg_temp.as_user('17300000-0000-0000-0000-000000000003');
select is((select count(*)::int from storage.objects where bucket_id = 'rewards'), 0, 'another household cannot');

select pg_temp.as_nobody();
select ok(not has_function_privilege('anon', 'public.request_redemption(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid)', 'execute'),
          'signed-out callers cannot ask, and nobody outside writes the ledger');

select * from finish();
rollback;
