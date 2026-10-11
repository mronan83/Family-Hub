-- [BRD-08][US-1007] Each board's text size (WP-47, D-73): Smaller, Standard, Larger or Largest, kept
-- beside its theme. Only those four are stored; an admin sets their own household's boards only, a
-- board cannot set its own, and each board reads its size in its snapshot (Standard until set).
begin;
select plan(10);

insert into auth.users (id, email) values
  ('31100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('31300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('31d00000-0000-0000-0000-00000000000a', null),
  ('31d00000-0000-0000-0000-00000000000b', null);
insert into public.household (id, name, timezone, week_start) values
  ('31000000-0000-0000-0000-000000000001', 'Text size family', 'America/New_York', 0),
  ('31000000-0000-0000-0000-000000000002', 'Neighbours', 'America/New_York', 0);
insert into public.household_settings (household_id) values
  ('31000000-0000-0000-0000-000000000001'), ('31000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('31000000-0000-0000-0000-000000000001', '31100000-0000-0000-0000-000000000001', 'owner'),
  ('31000000-0000-0000-0000-000000000002', '31300000-0000-0000-0000-000000000003', 'owner');
insert into public.device (id, household_id, name, auth_user_id, board_config) values
  ('31dd0000-0000-0000-0000-00000000000a', '31000000-0000-0000-0000-000000000001', 'Kitchen',
   '31d00000-0000-0000-0000-00000000000a', '{"theme": "day"}'),
  ('31dd0000-0000-0000-0000-00000000000b', '31000000-0000-0000-0000-000000000001', 'Hallway',
   '31d00000-0000-0000-0000-00000000000b', '{}');

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
create function pg_temp.size_of(p_device uuid) returns text language sql as $$
  select board_config ->> 'text_size' from public.device where id = p_device
$$;

-- The four sizes, and nothing else ----------------------------------------------------------------
select lives_ok($$ update public.device set board_config = board_config || '{"text_size": "smaller"}'
                     where id = '31dd0000-0000-0000-0000-00000000000b';
                   update public.device set board_config = board_config || '{"text_size": "largest"}'
                     where id = '31dd0000-0000-0000-0000-00000000000b';
                   update public.device set board_config = board_config - 'text_size'
                     where id = '31dd0000-0000-0000-0000-00000000000b' $$,
  '[BRD-08] a board takes Smaller to Largest, or none (Standard)');
select throws_ok($$ update public.device set board_config = board_config || '{"text_size": "huge"}'
                     where id = '31dd0000-0000-0000-0000-00000000000a' $$,
  '23514', null, '[BRD-08] and no other size');
select throws_ok($$ update public.device set board_config = board_config || '{"text_size": 2}'
                     where id = '31dd0000-0000-0000-0000-00000000000a' $$,
  '23514', null, '[BRD-08] given by name');

-- Who sets it -----------------------------------------------------------------------------------------
select pg_temp.as_user('31100000-0000-0000-0000-000000000001');
update public.device set board_config = board_config || '{"text_size": "larger"}'
 where id = '31dd0000-0000-0000-0000-00000000000a';
select pg_temp.as_owner();
select is(pg_temp.size_of('31dd0000-0000-0000-0000-00000000000a'), 'larger',
  '[BRD-08][US-1007] an admin sets their board''s text size');
select is((select board_config ->> 'theme' from public.device where id = '31dd0000-0000-0000-0000-00000000000a'), 'day',
  '[BRD-08] beside its theme, which stays');

select pg_temp.as_user('31300000-0000-0000-0000-000000000003');
update public.device set board_config = board_config || '{"text_size": "smaller"}'
 where id = '31dd0000-0000-0000-0000-00000000000a';
select pg_temp.as_owner();
select is(pg_temp.size_of('31dd0000-0000-0000-0000-00000000000a'), 'larger',
  '[BRD-08] an admin of another household cannot');

select pg_temp.as_user('31d00000-0000-0000-0000-00000000000a');
update public.device set board_config = board_config || '{"text_size": "smaller"}'
 where id = '31dd0000-0000-0000-0000-00000000000a';
select pg_temp.as_owner();
select is(pg_temp.size_of('31dd0000-0000-0000-0000-00000000000a'), 'larger',
  '[BRD-08] nor can the board itself');

-- The snapshot ------------------------------------------------------------------------------------------
select pg_temp.as_user('31d00000-0000-0000-0000-00000000000a');
select is(public.board_snapshot() -> 'device' ->> 'text_size', 'larger',
  '[BRD-08][US-1007] the board reads its text size in its snapshot');
select is(public.board_snapshot() -> 'device' ->> 'theme', 'day', '[BRD-08] beside its theme');
select pg_temp.as_user('31d00000-0000-0000-0000-00000000000b');
select is(public.board_snapshot() -> 'device' ->> 'text_size', 'standard',
  '[BRD-08] a board never given one is Standard');

select * from finish();
rollback;
