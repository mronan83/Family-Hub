-- [BRD-01][BRD-07][CHR-04][CHR-11][CHR-12] The board's Today (WP-11): the snapshot's items are today's
-- and the open overdue tasks, family-visible only, each with what its tile needs and when its
-- check-off was made, as the board may see them.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('15100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('15d00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('15000000-0000-0000-0000-000000000001', 'Today family', 'America/Chicago');
insert into public.household_settings (household_id, undo_window_seconds) values
  ('15000000-0000-0000-0000-000000000001', 90);
insert into public.household_user (household_id, user_id, role) values
  ('15000000-0000-0000-0000-000000000001', '15100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('15110000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('15110000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('15110000-0000-0000-0000-000000000003', '15000000-0000-0000-0000-000000000001', 'Pat', 'adult', '15100000-0000-0000-0000-000000000001');
insert into public.device (id, household_id, name, auth_user_id) values
  ('15dd0000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Kitchen', '15d00000-0000-0000-0000-00000000000d');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('15000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.item(p_id uuid, p_title text, p_kind text, p_schedule jsonb, p_members uuid[],
                             p_due_time time default null, p_visibility text default 'family',
                             p_assignment text default 'shared')
returns uuid language plpgsql as $$
begin
  insert into public.chore (id, household_id, title, icon, kind, points, schedule, due_time, visibility,
                            created_by, start_date, assignment)
  values (p_id, '15000000-0000-0000-0000-000000000001', p_title, 'chore-bed', p_kind, 5, p_schedule, p_due_time,
          p_visibility, '15100000-0000-0000-0000-000000000001', pg_temp.today() - 10, p_assignment);
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select '15000000-0000-0000-0000-000000000001', p_id, unnest(p_members);
  return p_id;
end $$;
create function pg_temp.occ(p_chore uuid, p_date date, p_member uuid default null) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = p_chore and due_date = p_date and member_id is not distinct from p_member
$$;
create function pg_temp.as_board() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '15d00000-0000-0000-0000-00000000000d', 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.items() returns jsonb language sql as $$
  select public.board_snapshot() -> 'occurrences'
$$;

-- Make bed is each child's own; Feed the dog is shared by Maya and Pat; a private gift task; a task
-- from three days ago still open, one done late, and one of an archived item.
select pg_temp.item('15c00000-0000-0000-0000-000000000001', 'Make bed', 'chore', '{"freq": "daily"}',
                    array['15110000-0000-0000-0000-000000000001', '15110000-0000-0000-0000-000000000002']::uuid[],
                    '07:30', p_assignment => 'each');
select pg_temp.item('15c00000-0000-0000-0000-000000000002', 'Feed the dog', 'chore', '{"freq": "daily"}',
                    array['15110000-0000-0000-0000-000000000001', '15110000-0000-0000-0000-000000000003']::uuid[],
                    '17:00');
select pg_temp.item('15c00000-0000-0000-0000-000000000003', 'Buy a gift', 'task', '{"freq": "daily"}',
                    array['15110000-0000-0000-0000-000000000003']::uuid[], p_visibility => 'private');
select pg_temp.item('15c00000-0000-0000-0000-000000000004', 'Return library books', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 3),
                    array['15110000-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.item('15c00000-0000-0000-0000-000000000005', 'Post the letter', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 2),
                    array['15110000-0000-0000-0000-000000000002']::uuid[]);
select pg_temp.item('15c00000-0000-0000-0000-000000000006', 'Old errand', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 4),
                    array['15110000-0000-0000-0000-000000000002']::uuid[]);
select private.generate_occurrences('15000000-0000-0000-0000-000000000001', pg_temp.today() - 4, pg_temp.today() - 1);
-- Yesterday's routine for Maya is left open; the letter was posted; the errand's item is archived.
select public.record_completions(jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'occurrence_id', pg_temp.occ('15c00000-0000-0000-0000-000000000005', pg_temp.today() - 2),
  'event_type', 'complete', 'occurred_at', now() - interval '1 hour', 'done_by', array['15110000-0000-0000-0000-000000000002'])));
update public.chore set archived_at = now() where id = '15c00000-0000-0000-0000-000000000006';
-- Leo makes his bed now (the board's check-off; it can still be undone).
select public.record_completions(jsonb_build_array(jsonb_build_object(
  'id', '15ee0000-0000-0000-0000-000000000001',
  'occurrence_id', pg_temp.occ('15c00000-0000-0000-0000-000000000001', pg_temp.today(), '15110000-0000-0000-0000-000000000002'),
  'event_type', 'complete', 'occurred_at', now() - interval '10 seconds',
  'done_by', array['15110000-0000-0000-0000-000000000002'])));

select pg_temp.as_board();
create temp table snap as select pg_temp.items() as s;

select is((select array_agg(x ->> 'title' || coalesce(':' || (x ->> 'member_id'), '') order by ord)
             from snap, jsonb_array_elements(s) with ordinality as t (x, ord)),
          array['Return library books', 'Make bed:15110000-0000-0000-0000-000000000001',
                'Make bed:15110000-0000-0000-0000-000000000002', 'Feed the dog'],
  '[BRD-01][CHR-12][D-21] today''s items and the open overdue task, overdue first, then by due time');
select ok(not exists (select from snap, jsonb_array_elements(s) x where x ->> 'title' = 'Buy a gift'),
  '[CHR-14][D-34] a private item never reaches the board');
select ok(not exists (select from snap, jsonb_array_elements(s) x where x ->> 'title' = 'Post the letter'),
  '[CHR-12] an overdue task already done is not on today''s list');
select ok(not exists (select from snap, jsonb_array_elements(s) x where x ->> 'title' = 'Old errand'),
  '[CHR-12] nor is an overdue task whose item was archived');
select ok(not exists (select from snap, jsonb_array_elements(s) x
                       where x ->> 'title' = 'Make bed' and (x ->> 'due_date')::date < pg_temp.today()),
  '[D-21] yesterday''s open routine stays off the board (a parent catches it up)');

select is((select x - 'id' - 'chore_id' - 'checked_at' from snap, jsonb_array_elements(s) x
            where x ->> 'title' = 'Feed the dog'),
          jsonb_build_object('title', 'Feed the dog', 'icon', 'chore-bed', 'kind', 'chore', 'due_date', pg_temp.today(),
                             'due_time', '17:00', 'member_id', null,
                             'assignees', jsonb_build_array('15110000-0000-0000-0000-000000000001', '15110000-0000-0000-0000-000000000003'),
                             'status', 'scheduled', 'done_by', '[]'::jsonb, 'rewarded', '[]'::jsonb, 'points', 5,
                             'requires_approval', false),
  '[BRD-07][CHR-11] each item carries what its tile needs: title, icon, kind, due time and who it is for');
select is((select x ->> 'member_id' from snap, jsonb_array_elements(s) x
            where x ->> 'title' = 'Make bed' and x -> 'assignees' ? '15110000-0000-0000-0000-000000000002'),
          '15110000-0000-0000-0000-000000000002',
  '[CHR-18] an each-their-own item says whose it is');
select is((select (x ->> 'checked_at')::timestamptz from snap, jsonb_array_elements(s) x
            where x ->> 'title' = 'Make bed' and x ->> 'member_id' = '15110000-0000-0000-0000-000000000002'),
          now() - interval '10 seconds',
  '[CHR-04][US-305] a check-off says when it was made, so the board knows if it can still undo it');
select is((select x ->> 'checked_at' from snap, jsonb_array_elements(s) x
            where x ->> 'title' = 'Make bed' and x ->> 'member_id' = '15110000-0000-0000-0000-000000000001'),
          null, '[CHR-04] an open item has no check-off time');
select is((public.board_snapshot() -> 'household' ->> 'undo_window_seconds')::int, 90,
  '[US-305] and the household''s undo window comes with it');

-- A parent's correction afterwards: the check-off time follows the event the status shows.
reset role;
select set_config('request.jwt.claims', '{}', true);
select public.record_completions(jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(),
  'occurrence_id', pg_temp.occ('15c00000-0000-0000-0000-000000000001', pg_temp.today(), '15110000-0000-0000-0000-000000000002'),
  'event_type', 'admin_complete', 'occurred_at', now() - interval '5 seconds',
  'done_by', array['15110000-0000-0000-0000-000000000002'])));
select pg_temp.as_board();
select is((select x ->> 'checked_at' from jsonb_array_elements(pg_temp.items()) x
            where x ->> 'title' = 'Make bed' and x ->> 'member_id' = '15110000-0000-0000-0000-000000000002'),
          null, '[D-46] a parent''s check-off is not the board''s to undo');

-- Another household's board sees none of it.
reset role;
insert into auth.users (id) values ('15d00000-0000-0000-0000-0000000000ee');
insert into public.household (id, name, timezone) values ('15000000-0000-0000-0000-000000000002', 'Next door', 'America/Chicago');
insert into public.device (household_id, name, auth_user_id) values
  ('15000000-0000-0000-0000-000000000002', 'Hall', '15d00000-0000-0000-0000-0000000000ee');
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '15d00000-0000-0000-0000-0000000000ee', 'role', 'authenticated')::text, true);
select is(public.board_snapshot() -> 'occurrences', '[]'::jsonb, '[NFR-04] another household''s board sees none of it');
reset role;
select is((select count(*)::int from pg_publication_tables
            where pubname = 'supabase_realtime' and tablename in ('chore_occurrence', 'chore')), 2,
  '[BRD-01][DEV-05] a check-off or an item''s edit tells the board to read again');

select * from finish();
rollback;
