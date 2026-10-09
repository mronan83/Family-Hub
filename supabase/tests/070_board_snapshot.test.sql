-- [DEV-05][DEV-02][NFR-04] The board snapshot (WP-06, 02 §4.6): one read, through RLS, for an active
-- board only; household-local dates; and every board-readable table notifies the board.
begin;
select plan(19);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'board-a@devices.example'),
  ('f4000000-0000-0000-0000-000000000004', 'board-b@devices.example');
insert into public.household (id, name, timezone, week_start) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Snapshots', 'Pacific/Kiritimati', 1),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Next door', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'owner');
insert into public.member (household_id, display_name, role, avatar_key, color, archived_at) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Zoe', 'adult', null, 'member-2', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Maya', 'child', 'owl', 'member-1', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Leo', 'child', null, 'member-3', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Gone', 'child', null, 'member-4', now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Neighbour', 'child', null, 'member-5', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Kitchen', 'f3000000-0000-0000-0000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Hall', 'f4000000-0000-0000-0000-000000000004');

create function pg_temp.act_as(p_user uuid, p_app jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'app_metadata', p_app)::text, true);
end $$;
create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform pg_temp.act_as('f3000000-0000-0000-0000-000000000003',
    '{"role": "device", "device_id": "dddddddd-0000-4000-8000-000000000001"}');
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create temp table snap (s jsonb);
grant all on snap to authenticated;

-- What a board reads ------------------------------------------------------------
select pg_temp.as_board();
insert into snap select public.board_snapshot();
select is((select s -> 'household' from snap),
  '{"id": "bbbbbbbb-0000-4000-8000-000000000001", "name": "Snapshots", "timezone": "Pacific/Kiritimati", "week_start": 1}'::jsonb,
  '[DEV-05] the snapshot carries the board''s household, its timezone and week start');
select is((select s -> 'device' from snap),
  '{"id": "dddddddd-0000-4000-8000-000000000001", "name": "Kitchen", "theme": "auto"}'::jsonb,
  '[DEV-05] and the board itself, with its theme');
select is((select array_agg(m ->> 'display_name') from snap, jsonb_array_elements(s -> 'members') m),
  array['Leo', 'Maya', 'Zoe'],
  '[DEV-05] members of this household only, without archived ones; children first, then by name');
select is((select s -> 'members' -> 1 from snap),
  jsonb_build_object('id', (select id from public.member where display_name = 'Maya'), 'display_name', 'Maya',
    'role', 'child', 'avatar_key', 'owl', 'color', 'member-1', 'earns_rewards', true,
    'points', jsonb_build_object('balance', 0, 'recent', '[]'::jsonb)),
  '[DEV-05][PTS-02] each member with what the board draws: name, role, avatar, color, earns rewards, points');
select is((select (s ->> 'today')::date from snap), (now() at time zone 'Pacific/Kiritimati')::date,
  '[DEV-05] today is the household''s date, not the server''s');
select is((select s -> 'range' from snap),
  jsonb_build_object('from', (now() at time zone 'Pacific/Kiritimati')::date - 1,
                     'to', (now() at time zone 'Pacific/Kiritimati')::date + 14),
  '[DEV-05] by default it covers yesterday through two weeks ahead');
select is((select (s ->> 'v')::int from snap), 1, '[DEV-05] the snapshot says which shape it has');
select ok((select (s ->> 'fetched_at')::timestamptz = now() from snap), '[DEV-05] and when it was read');
select is(public.board_snapshot('2026-10-01', '2026-10-07') -> 'range', '{"from": "2026-10-01", "to": "2026-10-07"}'::jsonb,
  '[DEV-05] a board can ask for another window');
select throws_ok($$ select public.board_snapshot('2026-10-07', '2026-10-01') $$, '22023', null,
  '[DEV-05] a window that ends before it starts is refused');
select throws_ok($$ select public.board_snapshot('2026-10-01', '2026-11-30') $$, '22023', null,
  '[DEV-05] and so is one longer than 32 days');

-- Theme --------------------------------------------------------------------------
select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
update public.device set board_config = board_config || '{"theme": "evening"}' where id = 'dddddddd-0000-4000-8000-000000000001';
select pg_temp.as_board();
select is(public.board_snapshot() -> 'device' ->> 'theme', 'evening', '[DEV-05] an admin can hold a board on Evening');
select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.device set board_config = '{"theme": "dusk"}' where id = 'dddddddd-0000-4000-8000-000000000001' $$,
  '23514', null, '[DEV-05] a board''s theme is automatic, Day or Evening');

-- Who gets nothing ---------------------------------------------------------------
select is(public.board_snapshot(), null, '[DEV-02] an admin is not a board and gets no snapshot');
select pg_temp.act_as('f4000000-0000-0000-0000-000000000004',
  '{"role": "device", "device_id": "dddddddd-0000-4000-8000-000000000002"}');
select is(public.board_snapshot() -> 'members' -> 0 ->> 'display_name', 'Neighbour',
  '[NFR-04] another household''s board reads its own family only');
select pg_temp.act_as_owner();
select ok(not has_function_privilege('anon', 'public.board_snapshot(date, date)', 'execute'),
  '[NFR-04] signed out, there is no snapshot');
select pg_temp.act_as('f1000000-0000-0000-0000-000000000001');
select public.revoke_device('dddddddd-0000-4000-8000-000000000001');
select pg_temp.as_board();
select is(public.board_snapshot(), null, '[DEV-02] a disconnected board gets nothing at once');

-- Realtime -------------------------------------------------------------------------
select pg_temp.act_as_owner();
select is(
  (select array_agg(tablename::text order by tablename::text) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'),
  array['device', 'household', 'household_settings', 'member', 'points_ledger'],
  '[DEV-05] the board-readable tables notify the board (apps/web/lib/live.ts listens to each)');
select ok((select bool_and(has_table_privilege('authenticated', format('public.%I', tablename), 'select'))
             from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  '[DEV-05] and a board may read each of them (RLS still decides the rows)');

select * from finish();
rollback;
