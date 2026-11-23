-- [DEV-05][NFR-04] WP-126, D-159: a change to a board-readable table is sent to each active board it
-- concerns as one Broadcast message a statement, on the board's own private topic; and Realtime's
-- authorization lets an active board receive on its own topic only, and nobody send on it.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'kitchen@devices.example'),
  ('f5000000-0000-0000-0000-000000000005', 'hall@devices.example'),
  ('f4000000-0000-0000-0000-000000000004', 'next-door@devices.example'),
  ('f6000000-0000-0000-0000-000000000006', 'gone@devices.example');
insert into public.household (id, name, timezone, week_start) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Broadcasts', 'America/Chicago', 0),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Next door', 'America/Chicago', 0);
insert into public.household_user (household_id, user_id, role) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'owner');
insert into public.device (id, household_id, name, auth_user_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Kitchen', 'f3000000-0000-0000-0000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'Hall', 'f5000000-0000-0000-0000-000000000005'),
  ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Next door', 'f4000000-0000-0000-0000-000000000004'),
  ('dddddddd-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'Gone', 'f6000000-0000-0000-0000-000000000006');
update public.device set status = 'revoked', revoked_at = now() where id = 'dddddddd-0000-4000-8000-000000000004';

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- What was sent since the last call: topic, event and payload, without the id send() adds.
create function pg_temp.sent() returns text[] language plpgsql as $$
declare
  got text[];
begin
  select coalesce(array_agg(topic || ' ' || event || ' ' || (payload - 'id')::text || ' ' || private::text
                            order by topic, payload ->> 'table'), '{}')
    into got from realtime.messages;
  delete from realtime.messages;
  return got;
end $$;
select pg_temp.sent();

-- Sending -------------------------------------------------------------------------------
select is(
  (select array_agg(distinct c.relname::text order by c.relname::text)
     from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where g.tgname in ('board_notify_insert', 'board_notify_update', 'board_notify_delete')),
  (select array_agg(tablename::text order by tablename::text) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'),
  '[DEV-05-f] every board-readable table (the supabase_realtime publication) sends to the boards');
select is(
  (select count(*)::int from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where g.tgname like 'board_notify_%' and g.tgtype & 1 = 1),
  0, '[DEV-05-f] once a statement, never once a row');
select is(
  (select array_agg(c.relname::text || ':' || encode(g.tgargs, 'escape') order by c.relname::text)
     from pg_trigger g join pg_class c on c.oid = g.tgrelid
    where g.tgname = 'board_notify_insert' and encode(g.tgargs, 'escape') not like 'household\\000household_id\\000'),
  array['device:device\000id\000', 'device_calendar:device\000device_id\000', 'household:household\000id\000'],
  '[DEV-05-f] a board''s own rows go to that board only; every other table goes to its household''s boards');

insert into public.member (household_id, display_name, role, color) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Maya', 'child', 'member-1'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Leo', 'child', 'member-3'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Zoe', 'adult', 'member-2');
select is(pg_temp.sent(),
  array['board:dddddddd-0000-4000-8000-000000000001 change {"table": "member"} true',
        'board:dddddddd-0000-4000-8000-000000000003 change {"table": "member"} true'],
  '[DEV-05-f] three rows added: one private message to each of the household''s active boards, naming the table only');
update public.member set display_name = display_name || '!' where household_id = 'bbbbbbbb-0000-4000-8000-000000000001';
select is(array_length(pg_temp.sent(), 1), 2, '[DEV-05-f] an update sends once a board');
delete from public.member where display_name = 'Zoe!';
select is(array_length(pg_temp.sent(), 1), 2, '[DEV-05-f] and so does a delete');
update public.member set display_name = 'Nobody' where display_name = 'No such member';
select is(pg_temp.sent(), '{}'::text[], '[DEV-05-f] a statement that changes no row sends nothing');

insert into public.member (household_id, display_name, role, color) values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Neighbour', 'child', 'member-5');
select is(pg_temp.sent(),
  array['board:dddddddd-0000-4000-8000-000000000002 change {"table": "member"} true'],
  '[DEV-05-f][NFR-04] another household''s change reaches its own board only; a disconnected board hears nothing');

update public.device set name = 'Kitchen wall' where id = 'dddddddd-0000-4000-8000-000000000001';
select is(pg_temp.sent(),
  array['board:dddddddd-0000-4000-8000-000000000001 change {"table": "device"} true'],
  '[DEV-05-f] a board''s own settings go to that board only');
update public.device set status = 'revoked', revoked_at = now() where id = 'dddddddd-0000-4000-8000-000000000003';
select is(pg_temp.sent(), '{}'::text[], '[DEV-05-f][DEV-02] disconnecting a board sends it nothing');
update public.member set display_name = 'Maya' where display_name = 'Maya!';
select is(pg_temp.sent(),
  array['board:dddddddd-0000-4000-8000-000000000001 change {"table": "member"} true'],
  '[DEV-05-f][DEV-02] and from then on it hears nothing of its household');

-- Receiving (Realtime authorization) -----------------------------------------------------
select realtime.send('{"table": "member"}', 'change', 'board:dddddddd-0000-4000-8000-000000000001', true);
create function pg_temp.hears(p_user uuid, p_topic text) returns integer language plpgsql as $$
declare
  n integer;
begin
  perform pg_temp.act_as(p_user);
  perform set_config('realtime.topic', p_topic, true);
  select count(*) into n from realtime.messages;
  perform pg_temp.act_as_owner();
  return n;
end $$;
select is(pg_temp.hears('f3000000-0000-0000-0000-000000000003', 'board:dddddddd-0000-4000-8000-000000000001'), 1,
  '[DEV-05-g] an active board may receive on its own topic');
select is(pg_temp.hears('f4000000-0000-0000-0000-000000000004', 'board:dddddddd-0000-4000-8000-000000000001'), 0,
  '[DEV-05-g][NFR-04] another household''s board may not join it');
select is(pg_temp.hears('f1000000-0000-0000-0000-000000000001', 'board:dddddddd-0000-4000-8000-000000000001'), 0,
  '[DEV-05-g] nor may a parent, even of the same household');
select is(pg_temp.hears('f5000000-0000-0000-0000-000000000005', 'board:dddddddd-0000-4000-8000-000000000003'), 0,
  '[DEV-05-g][DEV-02] a disconnected board may not join even its own topic');
select is(pg_temp.hears('f3000000-0000-0000-0000-000000000003', 'board:dddddddd-0000-4000-8000-000000000003'), 0,
  '[DEV-05-g] a board may not join another board''s topic in its household');

select pg_temp.act_as('f3000000-0000-0000-0000-000000000003');
select set_config('realtime.topic', 'board:dddddddd-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into realtime.messages (topic, extension, event, payload, private)
    values ('board:dddddddd-0000-4000-8000-000000000001', 'broadcast', 'change', '{}', true)$$,
  '42501', null, '[DEV-05-g] no client may send on a board''s topic, not even the board');

select * from finish();
rollback;
