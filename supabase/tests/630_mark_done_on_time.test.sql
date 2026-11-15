-- [CHR-24] A parent marks a missed or late chore done on time (WP-117, D-151): a parent's
-- admin_complete marked on time, "On time" or at an earlier time on its day; it folds as a parent's
-- completion (approved, credited, points earned once); the facts a goal reads take its time (none for
-- "On time", so never late); a time not on its day, after its due time or after now is refused, as is
-- a board, a task, or a chore not due yet; its goals are marked to be worked out again; check_offs()
-- says who marked it and when, through RLS; Uncheck takes it back.
begin;
select plan(33);

insert into auth.users (id, email) values
  ('63100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('63100000-0000-0000-0000-000000000002', 'other@example.com'),
  ('63100000-0000-0000-0000-0000000000b1', 'board@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('63000000-0000-0000-0000-000000000001', 'On time family', 'America/Chicago', 1),
  ('63000000-0000-0000-0000-000000000002', 'Another family', 'America/Chicago', 1);
insert into public.household_settings (household_id) values
  ('63000000-0000-0000-0000-000000000001'), ('63000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('63000000-0000-0000-0000-000000000001', '63100000-0000-0000-0000-000000000001', 'owner'),
  ('63000000-0000-0000-0000-000000000002', '63100000-0000-0000-0000-000000000002', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('63110000-0000-0000-0000-00000000000a', '63000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('63110000-0000-0000-0000-00000000000b', '63000000-0000-0000-0000-000000000001', 'Alex', 'adult',
   '63100000-0000-0000-0000-000000000001');
insert into public.device (household_id, name, auth_user_id) values
  ('63000000-0000-0000-0000-000000000001', 'Kitchen', '63100000-0000-0000-0000-0000000000b1');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('63000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.parent() returns void language sql as $$
  select pg_temp.as_user('63100000-0000-0000-0000-000000000001')
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Homework folder home, due 3:30 pm, 5 points; Feed the fish, no due time; Call grandma, a task.
insert into public.chore (id, household_id, title, kind, points, schedule, created_by, start_date, due_time, approval)
values
  ('63c00000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', 'Homework folder home', 'chore', 5,
   '{"freq": "daily"}', '63100000-0000-0000-0000-000000000001', pg_temp.today() - 10, '15:30', 'none'),
  ('63c00000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000001', 'Feed the fish', 'chore', 2,
   '{"freq": "daily"}', '63100000-0000-0000-0000-000000000001', pg_temp.today() - 10, null, 'none'),
  ('63c00000-0000-0000-0000-000000000003', '63000000-0000-0000-0000-000000000001', 'Call grandma', 'task', 0,
   '{"freq": "daily"}', '63100000-0000-0000-0000-000000000001', pg_temp.today() - 10, null, 'none');
insert into public.chore_assignee (household_id, chore_id, member_id)
select '63000000-0000-0000-0000-000000000001', c, '63110000-0000-0000-0000-00000000000a'
  from unnest(array['63c00000-0000-0000-0000-000000000001', '63c00000-0000-0000-0000-000000000002',
                    '63c00000-0000-0000-0000-000000000003']::uuid[]) c;
select private.generate_occurrences('63000000-0000-0000-0000-000000000001', pg_temp.today() - 6, pg_temp.today() + 1);
select private.close_past_due('63000000-0000-0000-0000-000000000001');

create function pg_temp.occ(p_chore int, p_day int) returns uuid language sql as $$
  select id from public.chore_occurrence
   where chore_id = ('63c00000-0000-0000-0000-00000000000' || p_chore)::uuid and due_date = pg_temp.today() + p_day
$$;
create function pg_temp.at(p_day int, p_time text) returns timestamptz language sql as $$
  select ((pg_temp.today() + p_day) + p_time::time) at time zone 'America/Chicago'
$$;
-- A parent's Mark done on time, through record_completions as the caller; its result and reason.
create function pg_temp.on_time(p_occ uuid, p_at timestamptz default null, p_id uuid default gen_random_uuid(),
                                p_type text default 'admin_complete') returns text
language sql as $$
  select r ->> 'result' || coalesce(' ' || (r ->> 'reason'), '')
    from jsonb_array_elements(public.record_completions(jsonb_build_array(jsonb_build_object(
           'id', p_id, 'occurrence_id', p_occ, 'event_type', p_type, 'occurred_at', now(),
           'done_by', jsonb_build_array('63110000-0000-0000-0000-00000000000a'),
           'marked_on_time', true, 'on_time_at', p_at)))) r
$$;
create function pg_temp.status(p_occ uuid) returns text language sql as $$
  select status || ' ' || coalesce(array_to_string(done_by, ','), '') from public.chore_occurrence where id = p_occ
$$;
create function pg_temp.earned(p_occ uuid) returns bigint language sql as $$
  select coalesce(sum(amount), 0) from public.points_ledger where occurrence_id = p_occ
$$;
create function pg_temp.done_at(p_occ uuid) returns text language sql as $$
  select f ->> 'done_at'
    from jsonb_array_elements(private.goal_facts_between('63000000-0000-0000-0000-000000000001',
           '63110000-0000-0000-0000-00000000000a', pg_temp.today() - 6, pg_temp.today())) f
   where (f ->> 'id')::uuid = p_occ
$$;

select is(pg_temp.status(pg_temp.occ(1, -2)), 'missed ', 'two days ago, Homework folder home was missed');

-- CHR-24-a: a missed chore marked on time ------------------------------------------------------------
select pg_temp.parent();
select is(pg_temp.on_time(pg_temp.occ(1, -2), null, '63e00000-0000-0000-0000-000000000001'), 'recorded',
  '[CHR-24-a] a parent marks a missed chore done on time');
select is(pg_temp.status(pg_temp.occ(1, -2)), 'approved 63110000-0000-0000-0000-00000000000a',
  '[CHR-24-a] it is approved, credited to its person');
select is(pg_temp.earned(pg_temp.occ(1, -2)), 5::bigint, '[CHR-24-a] its points are earned');
select is(pg_temp.on_time(pg_temp.occ(1, -2), null, '63e00000-0000-0000-0000-000000000001'), 'duplicate',
  '[CHR-24-a] the same form sent twice records once');
select is(pg_temp.earned(pg_temp.occ(1, -2)), 5::bigint, '[CHR-24-a] and its points are earned once');
select ok((select marked_on_time and on_time_at is null and actor_type = 'admin'
             from public.chore_completion_event where id = '63e00000-0000-0000-0000-000000000001'),
  '[CHR-24-a] the event says it was marked on time, by a parent, "On time"');

-- CHR-24-b: what a goal reads ------------------------------------------------------------------------
select pg_temp.as_owner();
select is(pg_temp.done_at(pg_temp.occ(1, -2)), null,
  '[CHR-24-b] "On time" has no tick time for a goal: never late, by its due time or a set time');
-- A parent's ordinary Mark done, now, on a day gone by: its time is now, so a goal counts it late.
select pg_temp.parent();
select is((select r ->> 'result' from jsonb_array_elements(public.record_completions(jsonb_build_array(
            jsonb_build_object('id', '63e00000-0000-0000-0000-000000000005', 'occurrence_id', pg_temp.occ(1, -5),
                               'event_type', 'admin_complete', 'occurred_at', now(),
                               'done_by', jsonb_build_array('63110000-0000-0000-0000-00000000000a'))))) r),
  'recorded', '[CHR-24-b] a parent''s ordinary late Mark done is recorded');
select pg_temp.as_owner();
select is(pg_temp.done_at(pg_temp.occ(1, -5)), to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD"T"HH24:MI'),
  '[CHR-24-b] ... with its own time, so a goal done by a time still doesn''t count it (D-151)');
select pg_temp.parent();
-- Recorded in the same transaction, at the same time: its id breaks the tie as the later event.
select is(pg_temp.on_time(pg_temp.occ(1, -5), null, 'ffffffff-0000-0000-0000-000000000002'), 'recorded',
  '[CHR-24-b] then marked on time');
select pg_temp.as_owner();
select is(pg_temp.done_at(pg_temp.occ(1, -5)), null, '[CHR-24-b] and now a goal counts it on time');

-- CHR-24-c: an earlier time ------------------------------------------------------------------------------
select pg_temp.parent();
select is(pg_temp.on_time(pg_temp.occ(1, -3), pg_temp.at(-3, '15:45')), 'invalid on_time_bad_time',
  '[CHR-24-c] a time after its due time is refused');
select is(pg_temp.on_time(pg_temp.occ(1, -3), pg_temp.at(-4, '15:15')), 'invalid on_time_bad_time',
  '[CHR-24-c] a time on another day is refused');
select is(pg_temp.on_time(pg_temp.occ(2, 0), now() + interval '1 hour'), 'invalid on_time_bad_time',
  '[CHR-24-c] a time later than now is refused');
select is(pg_temp.on_time(pg_temp.occ(1, -3), pg_temp.at(-3, '15:15')), 'recorded',
  '[CHR-24-c] a time on its day, by its due time, is recorded');
select pg_temp.as_owner();
select is(pg_temp.done_at(pg_temp.occ(1, -3)), to_char(pg_temp.today() - 3, 'YYYY-MM-DD') || 'T15:15',
  '[CHR-24-c] and a goal reads it as the tick''s time');
select pg_temp.parent();
select is(pg_temp.on_time(pg_temp.occ(2, -3), pg_temp.at(-3, '23:59')), 'recorded',
  '[CHR-24-c] without a due time, any time on its day');

-- CHR-24-d: a board's late tick, then marked on time; its goals are marked ---------------------------
select public.save_goal(jsonb_build_object(
  'id', '63e10000-0000-0000-0000-000000000001', 'household_id', '63000000-0000-0000-0000-000000000001',
  'member_id', '63110000-0000-0000-0000-00000000000a', 'title', 'Homework home every school day',
  'icon', 'trophy', 'start_date', pg_temp.today() - 6, 'end_date', null, 'rule_logic', 'all',
  'repeat', 'week', 'payout', '{"type": "points", "amount": 10}',
  'rules', jsonb_build_array(jsonb_build_object('type', 'DAYS_DUE', 'scope', jsonb_build_object('all', true),
                                                'params', '{"on_time": "due_time"}'))));
select pg_temp.as_user('63100000-0000-0000-0000-0000000000b1');
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
values (gen_random_uuid(), pg_temp.occ(1, -4), 'complete', array['63110000-0000-0000-0000-00000000000a'::uuid],
        pg_temp.at(-4, '20:10'));
select pg_temp.as_owner();
select is(pg_temp.done_at(pg_temp.occ(1, -4)), to_char(pg_temp.today() - 4, 'YYYY-MM-DD') || 'T20:10',
  '[CHR-24-d] a board ticked it at 8:10 pm, after its 3:30 pm');
update public.reward_goal_progress set dirty = false where goal_id = '63e10000-0000-0000-0000-000000000001';
select pg_temp.parent();
select is(pg_temp.on_time(pg_temp.occ(1, -4)), 'recorded', '[CHR-24-d] a parent marks it on time');
select pg_temp.as_owner();
select is(pg_temp.status(pg_temp.occ(1, -4)), 'approved 63110000-0000-0000-0000-00000000000a',
  '[CHR-24-d] it stays done, now a parent''s');
select is(pg_temp.done_at(pg_temp.occ(1, -4)), null, '[CHR-24-d] and a goal counts it on time');
select ok((select bool_and(dirty) from public.reward_goal_progress
            where goal_id = '63e10000-0000-0000-0000-000000000001'),
  '[CHR-24-d] its goals are marked to be worked out again, though its status didn''t change');

-- CHR-24-e: who and what may be marked on time --------------------------------------------------------
select pg_temp.as_user('63100000-0000-0000-0000-0000000000b1');
select is(pg_temp.on_time(pg_temp.occ(1, -1), null, gen_random_uuid(), 'complete'), 'refused not_allowed',
  '[CHR-24-e] a board can''t mark on time');
select pg_temp.parent();
select is(pg_temp.on_time(pg_temp.occ(3, -2)), 'invalid on_time_chore_only', '[CHR-24-e] a task can''t');
select is(pg_temp.on_time(pg_temp.occ(1, 1)), 'invalid on_time_not_due',
  '[CHR-24-e] a chore whose day hasn''t come can''t');
select is(pg_temp.on_time(pg_temp.occ(1, -1), null, gen_random_uuid(), 'approve'), 'invalid on_time_not_done',
  '[CHR-24-e] only a parent''s Mark done can be on time');

-- CHR-24-i: check_offs() ----------------------------------------------------------------------------------
select is((select marked_on_time::text || ' ' || coalesce(on_time_at, '-') || ' ' || marked_by || ' ' ||
                  (marked_on = pg_temp.today())::text
             from public.check_offs(array[pg_temp.occ(1, -2)])),
  'true - Alex true', '[CHR-24-i] check_offs() says it was marked on time, by Alex, today');
select is((select on_time_at from public.check_offs(array[pg_temp.occ(1, -3)])), '15:15',
  '[CHR-24-i] ... with the time given');
select is((select marked_on_time::text || ' ' || checked_at from public.check_offs(array[pg_temp.occ(1, -6)])),
  null, '[CHR-24-i] a missed chore has no check-off');
select pg_temp.as_user('63100000-0000-0000-0000-000000000002');
select is((select count(*) from public.check_offs(array[pg_temp.occ(1, -2), pg_temp.occ(1, -3)])), 0::bigint,
  '[CHR-24-i] another household''s parent reads none of them');

-- CHR-24-l: Uncheck takes it back --------------------------------------------------------------------------
-- In one transaction every event has the same time, so the uncheck's id breaks the tie as the later.
select pg_temp.parent();
select public.record_completions(jsonb_build_array(jsonb_build_object(
  'id', 'ffffffff-0000-0000-0000-000000000001', 'occurrence_id', pg_temp.occ(1, -2), 'event_type', 'admin_uncomplete',
  'occurred_at', now())));
select is(pg_temp.status(pg_temp.occ(1, -2)), 'missed ', '[CHR-24-l] Uncheck makes the day missed again');
select is(pg_temp.earned(pg_temp.occ(1, -2)), 0::bigint, '[CHR-24-l] and takes its points back');

select * from finish();
rollback;
