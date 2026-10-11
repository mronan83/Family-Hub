-- [BRD-05][US-1004] The home screen's layout (WP-35, D-67): the household's, and a board's own. Only
-- a layout of the known shape is stored; an admin saves the household's or a board's, and a board
-- without its own follows the household's. Each board reads both in its snapshot, with each item's
-- description for "More info" (D-66) and three weeks of calendar for "Coming up".
begin;
select plan(27);

insert into auth.users (id, email) values
  ('28100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('28300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('28d00000-0000-0000-0000-00000000000a', null),
  ('28d00000-0000-0000-0000-00000000000b', null),
  ('28d00000-0000-0000-0000-00000000000c', null);
insert into public.household (id, name, timezone, week_start) values
  ('28000000-0000-0000-0000-000000000001', 'Layout family', 'America/New_York', 0),
  ('28000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('28000000-0000-0000-0000-000000000001'), ('28000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('28000000-0000-0000-0000-000000000001', '28100000-0000-0000-0000-000000000001', 'owner'),
  ('28000000-0000-0000-0000-000000000002', '28300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('28110000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-000000000001', 'Ava', 'child');
insert into public.device (id, household_id, name, auth_user_id, board_config) values
  ('28dd0000-0000-0000-0000-00000000000a', '28000000-0000-0000-0000-000000000001', 'Kitchen',
   '28d00000-0000-0000-0000-00000000000a', '{"theme": "day"}'),
  ('28dd0000-0000-0000-0000-00000000000b', '28000000-0000-0000-0000-000000000001', 'Bedroom',
   '28d00000-0000-0000-0000-00000000000b', '{}'),
  ('28dd0000-0000-0000-0000-00000000000c', '28000000-0000-0000-0000-000000000002', 'Porch',
   '28d00000-0000-0000-0000-00000000000c', '{}');
insert into public.chore (id, household_id, title, description, icon, kind, points, schedule, created_by,
                          start_date)
values ('28c00000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'Feed the dog',
        'One scoop of dry food, and fresh water.', 'paw', 'chore', 5, '{"freq": "daily"}',
        '28100000-0000-0000-0000-000000000001', private.household_today('28000000-0000-0000-0000-000000000001') - 1);
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('28000000-0000-0000-0000-000000000001', '28c00000-0000-0000-0000-000000000001', '28110000-0000-0000-0000-00000000000a');
select private.generate_occurrences('28000000-0000-0000-0000-000000000001',
  private.household_today('28000000-0000-0000-0000-000000000001'),
  private.household_today('28000000-0000-0000-0000-000000000001'));

create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_parent() returns void language sql as $$ select pg_temp.as_user('28100000-0000-0000-0000-000000000001') $$;
create function pg_temp.as_kitchen() returns void language sql as $$ select pg_temp.as_user('28d00000-0000-0000-0000-00000000000a') $$;
create function pg_temp.as_bedroom() returns void language sql as $$ select pg_temp.as_user('28d00000-0000-0000-0000-00000000000b') $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- The shape ------------------------------------------------------------------------------------------
select ok(private.valid_board_layout('{}'), '[BRD-05] the empty layout is the defaults');
select ok(private.valid_board_layout(null), '[BRD-05] and no layout at all (a board following the household)');
select ok(private.valid_board_layout('{"calendar": "month", "cards": [{"id": "goals", "show": true}, {"id": "meals", "show": false}]}'),
  '[BRD-05][US-1004] a calendar view and some cards, in order');
select ok(not private.valid_board_layout('{"calendar": "4"}'), '[BRD-05] only 3, 5 or 7 days, or the month');
select ok(not private.valid_board_layout('{"calendar": 5}'), '[BRD-05] given as text');
select ok(not private.valid_board_layout('{"cards": [{"id": "goals", "show": true}, {"id": "goals", "show": false}]}'),
  '[BRD-05] a card listed once');
select ok(not private.valid_board_layout('{"cards": [{"id": "weather", "show": true}]}'), '[BRD-05] only the known cards');
select ok(not private.valid_board_layout('{"cards": [{"id": "goals", "show": "yes"}]}'), '[BRD-05] shown or not, as a boolean');
select ok(not private.valid_board_layout('{"cards": [{"id": "goals", "show": true, "size": 2}]}'), '[BRD-05] nothing else on a card');
select ok(not private.valid_board_layout('{"theme": "day"}'), '[BRD-05] nothing else in a layout');
select ok(not private.valid_board_layout('[]') and not private.valid_board_layout('"5"') and not private.valid_board_layout('null'),
  '[BRD-05] a layout is an object');
select throws_ok($$ update public.household_settings set board_layout = '{"calendar": "9"}'
                     where household_id = '28000000-0000-0000-0000-000000000001' $$,
  '23514', null, '[BRD-05] the household''s layout is checked where it is stored');
select throws_ok($$ update public.device set board_config = board_config || '{"layout": {"cards": 3}}'
                     where id = '28dd0000-0000-0000-0000-00000000000a' $$,
  '23514', null, '[BRD-05] and a board''s own');

-- Saving ---------------------------------------------------------------------------------------------
select pg_temp.as_parent();
select lives_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000001', null,
                  '{"calendar": "7", "cards": [{"id": "coming", "show": true}, {"id": "goals", "show": false}]}') $$,
  '[BRD-05][US-1004] a parent saves the household''s layout');
select lives_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000001', '28dd0000-0000-0000-0000-00000000000b',
                  '{"calendar": "3", "cards": [{"id": "goals", "show": true}]}') $$,
  '[BRD-05] and a board''s own');
select throws_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000001', null, '{"calendar": "2"}') $$,
  '22023', 'not a board layout', '[BRD-05] a layout of the wrong shape is refused, saying so');
select throws_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000002', null, '{}') $$,
  '42501', 'not allowed', '[NFR-07] not another household''s');
select throws_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000001', '28dd0000-0000-0000-0000-00000000000c', '{}') $$,
  'P0002', 'no such board', '[NFR-07] nor another household''s board');

select pg_temp.as_owner();
select is((select board_config from public.device where id = '28dd0000-0000-0000-0000-00000000000b'),
  '{"layout": {"calendar": "3", "cards": [{"id": "goals", "show": true}]}}'::jsonb,
  '[BRD-05] a board''s own layout sits in its settings');
select is((select board_config from public.device where id = '28dd0000-0000-0000-0000-00000000000a'),
  '{"theme": "day"}'::jsonb, '[BRD-05] beside its theme; the other board has none');

-- What each board reads ------------------------------------------------------------------------------
select pg_temp.as_kitchen();
select is(public.board_snapshot() -> 'layout',
  '{"household": {"calendar": "7", "cards": [{"id": "coming", "show": true}, {"id": "goals", "show": false}]}, "board": null}'::jsonb,
  '[BRD-05] a board without its own reads the household''s layout');
select pg_temp.as_bedroom();
select is(public.board_snapshot() -> 'layout' -> 'board', '{"calendar": "3", "cards": [{"id": "goals", "show": true}]}'::jsonb,
  '[BRD-05] a board with its own reads it too');
select throws_ok($$ select public.set_board_layout('28000000-0000-0000-0000-000000000001', null, '{}') $$,
  '42501', 'not allowed', '[NFR-07] a board doesn''t change layouts');
select is((public.board_snapshot() -> 'occurrences' -> 0) ->> 'description', 'One scoop of dry food, and fresh water.',
  '[D-66] each item carries its description for "More info"');
select is(public.board_snapshot() -> 'range',
  jsonb_build_object('from', private.household_today('28000000-0000-0000-0000-000000000001') - 1,
                     'to', private.household_today('28000000-0000-0000-0000-000000000001') + 21),
  '[D-66] the snapshot covers yesterday to three weeks ahead, for "Coming up"');

-- Back to the household's, and back to the defaults ----------------------------------------------------
select pg_temp.as_parent();
select public.set_board_layout('28000000-0000-0000-0000-000000000001', '28dd0000-0000-0000-0000-00000000000b', null);
select public.set_board_layout('28000000-0000-0000-0000-000000000001', null, null);
select pg_temp.as_bedroom();
select is(public.board_snapshot() -> 'layout', '{"household": {}, "board": null}'::jsonb,
  '[BRD-05] a board sent back follows the household''s again, which is back to the defaults');
select pg_temp.as_owner();
select is((select count(*) from public.audit_log
            where household_id = '28000000-0000-0000-0000-000000000001' and action = 'update'
              and ((entity_type = 'device' and entity_id = '28dd0000-0000-0000-0000-00000000000b')
                   or entity_type = 'household_settings')), 4::bigint,
  '[NFR-08] each layout saved, the household''s and the board''s, is in the audit log');

select * from finish();
rollback;
