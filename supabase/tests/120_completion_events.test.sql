-- [CHR-04][CHR-07][CHR-09][CHR-12][NFR-06] Completion events (WP-10): an append-only log, normalized by
-- the database (who, when, credit date, flag, rewarded), folded by event time into the occurrence's
-- status, day close for routines (tasks carry over), rebuild and drift, and who may record what.
-- Board events use a time ten minutes ago at the start of a minute, so they share one local date
-- whatever time the file runs.
begin;
select plan(49);

-- Fixtures ---------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('0e100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('0e200000-0000-0000-0000-000000000002', 'other-parent@example.com'),
  ('0e300000-0000-0000-0000-000000000003', 'neighbour@example.com'),
  ('0ed00000-0000-0000-0000-00000000000d', null),
  ('0ed00000-0000-0000-0000-00000000000e', null);
insert into public.household (id, name, timezone) values
  ('0e000000-0000-0000-0000-000000000001', 'Event family', 'America/Chicago'),
  ('0e000000-0000-0000-0000-000000000002', 'Neighbours', 'America/Chicago');
insert into public.household_settings (household_id) values
  ('0e000000-0000-0000-0000-000000000001'), ('0e000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('0e000000-0000-0000-0000-000000000001', '0e100000-0000-0000-0000-000000000001', 'owner'),
  ('0e000000-0000-0000-0000-000000000001', '0e200000-0000-0000-0000-000000000002', 'admin'),
  ('0e000000-0000-0000-0000-000000000002', '0e300000-0000-0000-0000-000000000003', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('0e110000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('0e110000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('0e110000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-000000000001', 'Pat', 'adult', '0e100000-0000-0000-0000-000000000001'),
  ('0e110000-0000-0000-0000-000000000009', '0e000000-0000-0000-0000-000000000002', 'Dee', 'child', null);
insert into public.device (id, household_id, name, auth_user_id) values
  ('0edd0000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000001', 'Kitchen', '0ed00000-0000-0000-0000-00000000000d'),
  ('0edd0000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-000000000002', 'Hall', '0ed00000-0000-0000-0000-00000000000e');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('0e000000-0000-0000-0000-000000000001')
$$;
-- Ten minutes ago at the start of a minute, and its local date: board events happen then.
create function pg_temp.t0() returns timestamptz language sql as $$
  select date_trunc('minute', now()) - interval '10 minutes'
$$;
create function pg_temp.d0() returns date language sql as $$
  select private.local_date('America/Chicago', pg_temp.t0())
$$;
create function pg_temp.item(p_id uuid, p_title text, p_kind text, p_schedule jsonb, p_members uuid[],
                             p_approval text default 'inherit', p_visibility text default 'family',
                             p_household uuid default '0e000000-0000-0000-0000-000000000001',
                             p_creator uuid default '0e100000-0000-0000-0000-000000000001')
returns uuid language plpgsql as $$
begin
  insert into public.chore (id, household_id, title, kind, points, approval, schedule, visibility, created_by, start_date)
  values (p_id, p_household, p_title, p_kind, 5, p_approval, p_schedule, p_visibility, p_creator, pg_temp.today() - 30);
  insert into public.chore_assignee (household_id, chore_id, member_id) select p_household, p_id, unnest(p_members);
  return p_id;
end $$;
create function pg_temp.occ(p_chore uuid, p_date date) returns uuid language sql as $$
  select id from public.chore_occurrence where chore_id = p_chore and due_date = p_date
$$;
create function pg_temp.status(p_occ uuid) returns text language sql as $$
  select status from public.chore_occurrence where id = p_occ
$$;
-- One event as record_completions takes it.
create function pg_temp.ev(p_id uuid, p_occ uuid, p_type text, p_at timestamptz, p_done_by uuid[] default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'occurrence_id', p_occ, 'event_type', p_type,
                            'occurred_at', p_at, 'done_by', to_jsonb(p_done_by))
$$;
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.item('0e4e0000-0000-0000-0000-000000000001', 'Make bed', 'chore', '{"freq": "daily"}',
                    array['0e110000-0000-0000-0000-000000000001', '0e110000-0000-0000-0000-000000000002']::uuid[]);
select pg_temp.item('0e4e0000-0000-0000-0000-000000000002', 'Homework', 'chore', '{"freq": "daily"}',
                    array['0e110000-0000-0000-0000-000000000001']::uuid[], 'required');
select pg_temp.item('0e4e0000-0000-0000-0000-000000000003', 'Call the plumber', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 2),
                    array['0e110000-0000-0000-0000-000000000003']::uuid[]);
select pg_temp.item('0e4e0000-0000-0000-0000-000000000004', 'Gift for Pat', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() + 1),
                    array['0e110000-0000-0000-0000-000000000001']::uuid[], 'inherit', 'private',
                    p_creator => '0e200000-0000-0000-0000-000000000002');
select pg_temp.item('0e4e0000-0000-0000-0000-000000000009', 'Neighbour chore', 'chore', '{"freq": "daily"}',
                    array['0e110000-0000-0000-0000-000000000009']::uuid[],
                    p_household => '0e000000-0000-0000-0000-000000000002', p_creator => '0e300000-0000-0000-0000-000000000003');
-- Last week too, as if planned then.
select private.generate_occurrences('0e000000-0000-0000-0000-000000000001', pg_temp.today() - 7, pg_temp.today() - 1);

-- The board checks off and undoes ----------------------------------------------------------------
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select results_eq(
  $$ select r ->> 'result', r -> 'occurrence' ->> 'status'
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000001', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                    'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[])))) r $$,
  $$ values ('recorded'::text, 'completed'::text) $$,
  '[CHR-04] a board''s check-off is recorded and the occurrence is completed at once');
select results_eq(
  $$ select r ->> 'result', r -> 'occurrence' ->> 'status'
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000001', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                    'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[])))) r $$,
  $$ values ('duplicate'::text, 'completed'::text) $$,
  '[CHR-04][NFR-06] replaying the same event is a duplicate: nothing new is recorded');
reset role;
select results_eq(
  $$ select count(*)::int, min(actor_type), min(actor_id::text), min(review_status), min(credit_date)
       from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000001' $$,
  $$ values (1, 'device'::text, '0edd0000-0000-0000-0000-000000000001'::text, 'accepted'::text, pg_temp.d0()) $$,
  '[NFR-06] one event, recorded as the Kitchen board, accepted, credited to its due date');
select results_eq(
  $$ select m.display_name::text, v.member_status, v.credited, v.rewarded
       from public.v_member_occurrence v join public.member m on m.id = v.member_id
      where v.occurrence_id = pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()) order by 1 $$,
  $$ values ('Leo'::text, 'covered'::text, false, false), ('Maya', 'completed', true, true) $$,
  '[CHR-09] a shared routine done by Maya is done for her and covered for Leo; only Maya is credited');

select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select is((public.record_completions(jsonb_build_array(
            pg_temp.ev('0e5e0000-0000-0000-0000-000000000002', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                       'undo', pg_temp.t0() + interval '30 seconds')))) -> 0 -> 'occurrence' ->> 'status',
  'scheduled', '[CHR-04] undo within the window reopens it');
select is((public.record_completions(jsonb_build_array(
            pg_temp.ev('0e5e0000-0000-0000-0000-000000000003', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                       'complete', pg_temp.t0() + interval '40 seconds', array['0e110000-0000-0000-0000-000000000002']::uuid[])))) -> 0 -> 'occurrence' ->> 'status',
  'completed', '[CHR-04] Leo checks it off again');
reset role;
update public.household_settings set undo_window_seconds = 10 where household_id = '0e000000-0000-0000-0000-000000000001';
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select results_eq(
  $$ select r ->> 'result', r ->> 'reason', r -> 'occurrence' ->> 'status'
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000004', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                    'undo', pg_temp.t0() + interval '55 seconds')))) r $$,
  $$ values ('refused'::text, 'undo_window_passed'::text, 'completed'::text) $$,
  '[CHR-04] after the undo window the board cannot undo (US-305); it stays done');
select results_eq(
  $$ select r ->> 'result', r ->> 'reason'
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000005', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                    'admin_uncomplete', pg_temp.t0() + interval '56 seconds'),
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000006', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0()),
                    'approve', pg_temp.t0() + interval '56 seconds', array['0e110000-0000-0000-0000-000000000001']::uuid[])))) r $$,
  $$ values ('refused'::text, 'not_allowed'::text), ('refused', 'not_allowed') $$,
  '[CHR-06] a board cannot uncheck or approve; those are a parent''s');
reset role;
update public.household_settings set undo_window_seconds = 120 where household_id = '0e000000-0000-0000-0000-000000000001';
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select results_eq(
  $$ select r ->> 'result', r -> 'occurrence' ->> 'status'
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         pg_temp.ev('0e5e0000-0000-0000-0000-000000000007', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0()),
                    'admin_uncomplete', pg_temp.t0() + interval '57 seconds')))) r $$,
  $$ values ('recorded'::text, 'scheduled'::text) $$,
  '[CHR-06] a parent can uncheck at any time');
reset role;
select is((select actor_type || ':' || actor_id from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000007'),
  'admin:0e100000-0000-0000-0000-000000000001', '[NFR-06] a parent''s event is recorded as that parent');

-- The board, refused and gone --------------------------------------------------------------------
-- Ids the board cannot read: the neighbours' chore and the private item.
select pg_temp.occ('0e4e0000-0000-0000-0000-000000000009', pg_temp.today()) as neighbour_occ,
       pg_temp.occ('0e4e0000-0000-0000-0000-000000000004', pg_temp.today() + 1) as private_occ \gset
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select results_eq(
  format($$ select r ->> 'result' from jsonb_array_elements(public.record_completions(jsonb_build_array(
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000010', %L,
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000009']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000011', %L,
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000012', '0e999999-0000-0000-0000-000000000000',
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000013', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 1),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000009']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000014', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 1),
                  'complete', pg_temp.t0()),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000015', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 1),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000002']::uuid[])))) r $$,
         :'neighbour_occ', :'private_occ'),
  $$ values ('refused'::text), ('refused'), ('gone'), ('invalid'), ('invalid'), ('recorded') $$,
  '[CHR-04][CHR-13] in one batch: another family''s chore and a private item are refused, a removed occurrence is gone (D-45), someone from another family or nobody is invalid, and the rest is recorded');
select results_eq(
  $$ select r ->> 'reason' from jsonb_array_elements(public.record_completions(jsonb_build_array(
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000013', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 1),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000009']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000014', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 1),
                  'complete', pg_temp.t0())))) r $$,
  $$ values ('done_by_not_member'::text), ('done_by_required') $$,
  '[CHR-09] the reasons say what was wrong');
select throws_ok($$ select public.record_completions('{"id": 1}') $$, '22023', null,
  '[NFR-06] a batch must be a list');
reset role;

-- Flags, credit dates and the clamp ----------------------------------------------------------------
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select results_eq(
  $$ select r -> 'occurrence' ->> 'status' from jsonb_array_elements(public.record_completions(jsonb_build_array(
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000020', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() - 1),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000021', pg_temp.occ('0e4e0000-0000-0000-0000-000000000003', pg_temp.today() - 2),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000003']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000022', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0()),
                  'complete', now() + interval '1 day', array['0e110000-0000-0000-0000-000000000001']::uuid[])))) r $$,
  $$ values ('pending_approval'::text), ('completed'), ('pending_approval') $$,
  '[CHR-07][CHR-12] a board''s check-off of yesterday''s routine waits for a parent; a late task is done; an approval item waits');
reset role;
select results_eq(
  $$ select id::text, review_status, credit_date from public.chore_completion_event
      where id in ('0e5e0000-0000-0000-0000-000000000020', '0e5e0000-0000-0000-0000-000000000021') order by id $$,
  $$ values ('0e5e0000-0000-0000-0000-000000000020'::text, 'flagged'::text, pg_temp.d0() - 1),
            ('0e5e0000-0000-0000-0000-000000000021', 'accepted', pg_temp.d0()) $$,
  '[CHR-12][D-21] the routine is flagged and credited to its day; the task is accepted and credited to the day it was done (late)');
select ok((select occurred_at <= recorded_at and occurred_at <= now() from public.chore_completion_event
            where id = '0e5e0000-0000-0000-0000-000000000022'),
  '[D-20] a time in the future is clamped to when the event was received');

-- Approval (D-32) ---------------------------------------------------------------------------------
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select results_eq(
  $$ select r -> 'occurrence' ->> 'status', r -> 'occurrence' -> 'done_by' ->> 0
       from jsonb_array_elements(public.record_completions(jsonb_build_array(
         jsonb_build_object('id', '0e5e0000-0000-0000-0000-000000000023', 'event_type', 'approve',
                            'occurrence_id', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0()))))) r $$,
  $$ values ('approved'::text, '0e110000-0000-0000-0000-000000000001'::text) $$,
  '[CHR-05] a parent''s approval credits whoever the check-off credited');
select results_eq(
  $$ select r -> 'occurrence' ->> 'status' from jsonb_array_elements(public.record_completions(jsonb_build_array(
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000024', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0() + 1),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000003']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000025', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0() + 2),
                  'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000026', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0() + 2),
                  'reject', pg_temp.t0() + interval '5 seconds')))) r $$,
  $$ values ('completed'::text), ('pending_approval'), ('rejected') $$,
  '[CHR-05][D-32] approval applies only when someone credited earns rewards; a rejection reopens it');
reset role;
select is((select rewarded from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000024'), '{}'::uuid[],
  '[D-32] an adult who does not earn rewards is credited but not rewarded');

-- Event time decides (D-20) ------------------------------------------------------------------------
-- The child taps at :00 offline; a parent unchecks at :20; the tap arrives afterwards.
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select public.record_completions(jsonb_build_array(
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000030', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 3),
             'admin_uncomplete', pg_temp.t0() + interval '20 seconds')));
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000d');
select public.record_completions(jsonb_build_array(
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000031', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 3),
             'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[])));
reset role;
select results_eq(
  $$ select o.status, o.status_event_id::text from public.chore_occurrence o
      where o.id = pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.d0() + 3) $$,
  $$ values ('scheduled'::text, '0e5e0000-0000-0000-0000-000000000030'::text) $$,
  '[D-20] a tap that arrives late but happened earlier never overrides the parent''s later uncheck');

-- Append-only ---------------------------------------------------------------------------------------
select throws_ok($$ update public.chore_completion_event set event_type = 'skip' where id = '0e5e0000-0000-0000-0000-000000000001' $$,
  '42501', null, '[NFR-06] an event cannot be changed, even by the owner');
select throws_ok($$ delete from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000001' $$,
  '42501', null, '[NFR-06] an event cannot be deleted while its household exists');
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select throws_ok($$ update public.chore_completion_event set note = 'x' where id = '0e5e0000-0000-0000-0000-000000000001' $$,
  '42501', null, '[NFR-06] an admin has no update or delete on events');
insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at, actor_type, actor_id)
values ('0e5e0000-0000-0000-0000-000000000039', pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.today() + 4),
        'admin_complete', '{0e110000-0000-0000-0000-000000000001}', now(), 'system', null);
reset role;
select is((select actor_type || ':' || actor_id from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000039'),
  'admin:0e100000-0000-0000-0000-000000000001',
  '[NFR-06] who recorded an event comes from the session: an admin who claims to be the system is recorded as themselves');
select ok(not has_table_privilege('anon', 'public.chore_completion_event', 'select')
          and not has_function_privilege('anon', 'public.record_completions(jsonb)', 'execute')
          and not has_table_privilege('authenticated', 'public.chore_completion_event', 'truncate'),
  '[NFR-04] anon cannot read events or record any; nobody signed in can truncate them');

-- Who reads events (D-34) --------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', true);
select public.record_completions(jsonb_build_array(
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000040', pg_temp.occ('0e4e0000-0000-0000-0000-000000000004', pg_temp.today() + 1),
             'complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[])));
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select results_eq(
  $$ select count(*) filter (where id = '0e5e0000-0000-0000-0000-000000000040')::int, (count(*) > 5)
       from public.chore_completion_event $$,
  $$ values (0, true) $$, '[CHR-13] the other admin reads the family''s events but not a private item''s');
select pg_temp.act_as('0e200000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000040'), 1,
  '[CHR-13] the private item''s creator reads its event');
select pg_temp.act_as('0ed00000-0000-0000-0000-00000000000e');
select is((select count(*)::int from public.chore_completion_event), 0, '[NFR-04] another family''s board reads none of them');
reset role;
select is((select actor_type from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000040'),
  'system', '[NFR-06] an event recorded by the database itself (no session) is the system''s');

-- Events protect the occurrence they belong to (D-45) -----------------------------------------------
update public.chore set points = 9 where id = '0e4e0000-0000-0000-0000-000000000002';
select results_eq(
  $$ select status, points_snapshot from public.chore_occurrence
      where id = pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.d0()) $$,
  $$ values ('approved'::text, 5) $$,
  '[CHR-03] an item edit leaves an occurrence someone acted on as it was');

-- Day close (D-23, D-31) ---------------------------------------------------------------------------
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select public.record_completions(jsonb_build_array(
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000050', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 3),
             'complete', pg_temp.t0() - interval '3 days', array['0e110000-0000-0000-0000-000000000001']::uuid[]),
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000051', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 4),
             'complete', pg_temp.t0() - interval '4 days', array['0e110000-0000-0000-0000-000000000001']::uuid[]),
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000052', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 4),
             'reject', pg_temp.t0() - interval '4 days' + interval '1 minute'),
  pg_temp.ev('0e5e0000-0000-0000-0000-000000000053', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 5),
             'skip', pg_temp.t0() - interval '5 days')));
reset role;
select ok(private.close_past_due('0e000000-0000-0000-0000-000000000001') > 0, '[CHR-07] day close finalizes past routines');
select results_eq(
  $$ select o.status, count(*)::int from public.chore_occurrence o
      where o.chore_id = '0e4e0000-0000-0000-0000-000000000002' and o.due_date between pg_temp.today() - 5 and pg_temp.today() - 3
      group by 1 order by 1 $$,
  $$ values ('missed'::text, 1), ('pending_approval', 1), ('skipped', 1) $$,
  '[CHR-07][D-23] a rejected routine is missed; one waiting for a parent waits; a skipped one stays skipped');
select is((select count(*)::int from public.chore_occurrence o join public.household h on h.id = o.household_id
            where o.household_id = '0e000000-0000-0000-0000-000000000001' and o.kind = 'chore'
              and o.due_date < pg_temp.today() and (o.status in ('scheduled', 'rejected') or o.finalized_at is null)), 0,
  '[CHR-07] a closed day has no scheduled or rejected routine and nothing left unfinalized');
select results_eq(
  $$ select status, finalized_at is null from public.chore_occurrence
      where id = pg_temp.occ('0e4e0000-0000-0000-0000-000000000003', pg_temp.today() - 2) $$,
  $$ values ('completed'::text, true) $$,
  '[CHR-12][D-31] a task is never finalized: it carries over until done');
select ok((select count(*) from public.chore_occurrence where due_date >= pg_temp.today() and finalized_at is not null) = 0,
  '[CHR-07] today and later are never closed');
select is(private.close_past_due('0e000000-0000-0000-0000-000000000001'), 0, '[CHR-07] running day close again changes nothing');
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select results_eq(
  $$ select r -> 'occurrence' ->> 'status' from jsonb_array_elements(public.record_completions(jsonb_build_array(
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000054', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 4),
                  'admin_complete', pg_temp.t0(), array['0e110000-0000-0000-0000-000000000001']::uuid[]),
       pg_temp.ev('0e5e0000-0000-0000-0000-000000000055', pg_temp.occ('0e4e0000-0000-0000-0000-000000000002', pg_temp.today() - 4),
                  'admin_uncomplete', pg_temp.t0() + interval '1 second')))) r $$,
  $$ values ('approved'::text), ('missed') $$,
  '[CHR-06][D-21] a parent''s late credit approves a missed routine; unchecking it again makes it missed, not open');
reset role;
select is((select credit_date from public.chore_completion_event where id = '0e5e0000-0000-0000-0000-000000000054'),
  pg_temp.today() - 4, '[CHR-07] late credit for a routine counts on its due date');

-- Rebuild and drift (NFR-06) --------------------------------------------------------------------------
select is_empty($$ select * from private.rebuild_occurrence_status('0e000000-0000-0000-0000-000000000001',
                                                                    pg_temp.today() - 7, pg_temp.today() + 14) $$,
  '[CHR-07] rebuild finds every stored status equal to its events');
update public.chore_occurrence set status = 'completed'
 where id = pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.today() + 5);
select results_eq(
  $$ select was, now_is from private.rebuild_occurrence_status('0e000000-0000-0000-0000-000000000001',
                                                                pg_temp.today() - 7, pg_temp.today() + 14) $$,
  $$ values ('completed'::text, 'scheduled'::text) $$,
  '[NFR-06] a status written some other way shows as drift, report-only');
select ok((public.occurrence_status_drift('0e000000-0000-0000-0000-000000000001') ->> 'drift')::int = 1
          and pg_temp.status(pg_temp.occ('0e4e0000-0000-0000-0000-000000000001', pg_temp.today() + 5)) = 'completed',
  '[NFR-06] the nightly check reports it and changes nothing');
select private.rebuild_occurrence_status('0e000000-0000-0000-0000-000000000001', pg_temp.today() - 7, pg_temp.today() + 14, true);
select is((public.occurrence_status_drift('0e000000-0000-0000-0000-000000000001') ->> 'drift')::int, 0,
  '[NFR-06] applying the rebuild (a parent''s action) corrects it');

-- Property test: random events from parents and the system, in random order of event time, with day
-- close part way. After each one the stored status equals an independent fold of its events, and at
-- the end rebuild finds nothing.
create function pg_temp.expected_drift() returns int language sql as $$
  with latest as (
    select distinct on (e.occurrence_id) e.*
      from public.chore_completion_event e
     order by e.occurrence_id, e.occurred_at desc, e.recorded_at desc, e.id desc
  )
  select count(*)::int
    from public.chore_occurrence o
    left join latest l on l.occurrence_id = o.id
   where o.household_id = '0e000000-0000-0000-0000-000000000001'
     and o.status is distinct from (case
           when l.id is null then case when o.finalized_at is null then 'scheduled' else 'missed' end
           when l.event_type = 'complete' and (l.review_status = 'flagged' or (o.requires_approval_snapshot and l.rewarded <> '{}'))
             then 'pending_approval'
           when l.event_type = 'complete' then 'completed'
           when l.event_type in ('approve', 'admin_complete') then 'approved'
           when l.event_type = 'skip' then 'skipped'
           when o.finalized_at is not null then 'missed'
           when l.event_type = 'reject' then 'rejected'
           else 'scheduled' end)
$$;
create function pg_temp.random_events(p_n int) returns text language plpgsql as $$
declare
  v_types text[] := array['complete', 'undo', 'approve', 'reject', 'admin_complete', 'admin_uncomplete', 'skip'];
  v_members uuid[] := array['0e110000-0000-0000-0000-000000000001', '0e110000-0000-0000-0000-000000000002',
                            '0e110000-0000-0000-0000-000000000003']::uuid[];
  v_occs uuid[];
  v_type text;
  v_who uuid[];
begin
  perform setseed(0.27);
  select array_agg(id order by id) into v_occs from public.chore_occurrence
   where household_id = '0e000000-0000-0000-0000-000000000001' and due_date between pg_temp.today() - 7 and pg_temp.today() + 3;
  for i in 1..p_n loop
    v_type := v_types[1 + floor(random() * 7)::int];
    v_who := case when random() < 0.3 then array[v_members[1], v_members[2]]
                  else array[v_members[1 + floor(random() * 3)::int]] end;
    perform public.record_completions(jsonb_build_array(pg_temp.ev(
      gen_random_uuid(), v_occs[1 + floor(random() * cardinality(v_occs))::int], v_type,
      now() - make_interval(mins => floor(random() * 5000)::int),
      case when v_type in ('complete', 'admin_complete') or (v_type = 'approve' and random() < 0.5) then v_who else '{}' end)));
    if i = p_n / 2 then
      perform private.close_past_due('0e000000-0000-0000-0000-000000000001');
    end if;
    if pg_temp.expected_drift() <> 0 then
      return 'status differs from its events after event ' || i;
    end if;
  end loop;
  return 'ok';
end $$;
select is(pg_temp.random_events(200), 'ok',
  '[CHR-07] property: across 200 random events, each stored status equals an independent fold of its events');
select is_empty($$ select * from private.rebuild_occurrence_status('0e000000-0000-0000-0000-000000000001',
                                                                    pg_temp.today() - 7, pg_temp.today() + 14) $$,
  '[CHR-07] property: and rebuild agrees with every stored status');

-- Jobs and internals --------------------------------------------------------------------------------
select ok((public.close_household_day('0e000000-0000-0000-0000-000000000001') ->> 'through')::date = pg_temp.today() - 1,
  '[CHR-07] the day_close job closes through yesterday');
select pg_temp.act_as('0e100000-0000-0000-0000-000000000001');
select throws_ok($$ select public.close_household_day('0e000000-0000-0000-0000-000000000001') $$, '42501', null,
  '[CHR-07] only the job (service role) closes days through the API');
select throws_ok($$ select public.occurrence_status_drift('0e000000-0000-0000-0000-000000000001') $$, '42501', null,
  '[NFR-06] only the job (service role) runs the drift check');
reset role;
select ok(not has_function_privilege('authenticated', 'private.close_past_due(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.rebuild_occurrence_status(uuid, date, date, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'private.fold_occurrence_status(uuid)', 'execute'),
  '[NFR-04] day close, rebuild and the fold are not callable from outside');

-- A household's deletion takes its events with it --------------------------------------------------
delete from public.household where id = '0e000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.chore_completion_event where household_id = '0e000000-0000-0000-0000-000000000001'), 0,
  '[NFR-06] deleting a household (export and delete, or the demo reset) removes its events');

select * from finish();
rollback;
