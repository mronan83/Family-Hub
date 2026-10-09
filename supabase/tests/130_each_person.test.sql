-- [CHR-09][CHR-18] Everyone does their own (WP-43, D-47): an "each" item has one occurrence per person
-- per day, with that person's own day type; each person's check-off, miss and credit are their own;
-- switching mode, changing who it is for and archiving a member re-plan without touching history or
-- anything someone acted on; a new chore starts as each and a new task as shared.
begin;
select plan(19);

-- Fixtures ---------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('0f100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone) values ('0f000000-0000-0000-0000-000000000001', 'Each family', 'America/Chicago');
insert into public.household_settings (household_id) values ('0f000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('0f000000-0000-0000-0000-000000000001', '0f100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('0f110000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('0f110000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('0f110000-0000-0000-0000-000000000003', '0f000000-0000-0000-0000-000000000001', 'Pat', 'adult', '0f100000-0000-0000-0000-000000000001');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('0f000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.item(p_id uuid, p_title text, p_kind text, p_schedule jsonb, p_members uuid[],
                             p_assignment text, p_day_types text[] default array['school_day', 'no_school', 'break', 'weekend', 'summer'])
returns uuid language plpgsql as $$
begin
  insert into public.chore (id, household_id, title, kind, points, schedule, day_types, created_by, start_date, assignment)
  values (p_id, '0f000000-0000-0000-0000-000000000001', p_title, p_kind, 5, p_schedule, p_day_types,
          '0f100000-0000-0000-0000-000000000001', pg_temp.today() - 30, p_assignment);
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select '0f000000-0000-0000-0000-000000000001', p_id, unnest(p_members);
  return p_id;
end $$;
-- Occurrences of an item from p_from to p_to, by person ('shared' for a shared one).
create function pg_temp.who(p_chore uuid, p_from date, p_to date) returns text language sql as $$
  select coalesce(string_agg(coalesce(m.display_name, 'shared') || '=' || n, ',' order by coalesce(m.display_name, 'shared')), '')
    from (select o.member_id, count(*) as n from public.chore_occurrence o
           where o.chore_id = p_chore and o.due_date between p_from and p_to group by o.member_id) x
    left join public.member m on m.id = x.member_id
$$;
create function pg_temp.occ(p_chore uuid, p_date date, p_member uuid) returns uuid language sql as $$
  select id from public.chore_occurrence where chore_id = p_chore and due_date = p_date and member_id is not distinct from p_member
$$;
create function pg_temp.done(p_occ uuid, p_by uuid) returns void language sql as $$
  select public.record_completions(jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'occurrence_id', p_occ, 'event_type', 'complete', 'occurred_at', now() - interval '1 minute',
    'done_by', jsonb_build_array(p_by))));
$$;

-- Maya follows the default school year (weekdays); Leo follows his own school's, which has a break
-- from tomorrow for five days.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('0f5e0000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000001', 'Default', pg_temp.today() - 60, pg_temp.today() + 120, true),
  ('0f5e0000-0000-0000-0000-000000000002', '0f000000-0000-0000-0000-000000000001', 'Leo''s school', pg_temp.today() - 60, pg_temp.today() + 120, false);
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('0f000000-0000-0000-0000-000000000001', '0f5e0000-0000-0000-0000-000000000002', 'Leo''s break', 'break', pg_temp.today() + 1, pg_temp.today() + 5);
insert into public.member_school_profile (household_id, member_id, school_year_id) values
  ('0f000000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002', '0f5e0000-0000-0000-0000-000000000002');

-- One occurrence per person per day ----------------------------------------------------------------
select pg_temp.item('0f4e0000-0000-0000-0000-000000000001', 'Make bed', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 'each');
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 14), 'Leo=15,Maya=15',
  '[CHR-18] everyone does their own: one occurrence a day for Maya and one for Leo');
select is((select count(*)::int from public.chore_occurrence o join public.chore_occurrence_assignee a on a.occurrence_id = o.id
            where o.chore_id = '0f4e0000-0000-0000-0000-000000000001' and a.member_id = o.member_id), 30,
  '[CHR-18] each occurrence''s snapshot is its own person, and nobody else');
select is(public.generate_household_occurrences('0f000000-0000-0000-0000-000000000001') ->> 'added', '0',
  '[CHR-03] the hourly job finds nothing to add (idempotent)');

select pg_temp.item('0f4e0000-0000-0000-0000-000000000002', 'Homework', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 'each',
                    array['school_day']);
select results_eq(
  $$ select coalesce(m.display_name, 'shared')::text, count(*)::int
       from public.chore_occurrence o left join public.member m on m.id = o.member_id
      where o.chore_id = '0f4e0000-0000-0000-0000-000000000002' and o.due_date between pg_temp.today() + 1 and pg_temp.today() + 5
      group by 1 order by 1 $$,
  $$ select 'Maya'::text, count(*)::int from generate_series(pg_temp.today() + 1, pg_temp.today() + 5, interval '1 day') d
      where extract(isodow from d) < 6 having count(*) > 0 $$,
  '[CHR-18][SCH-03] each person''s own day type decides: Maya has school-day homework while Leo''s school is on break');

-- Each person's own check-off, credit and miss -----------------------------------------------------
select pg_temp.done(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                    '0f110000-0000-0000-0000-000000000001');
select results_eq(
  $$ select m.display_name::text, v.member_status, v.credited
       from public.v_member_occurrence v join public.member m on m.id = v.member_id
      where v.chore_id = '0f4e0000-0000-0000-0000-000000000001' and v.due_date = pg_temp.today() order by 1 $$,
  $$ values ('Leo'::text, 'scheduled'::text, false), ('Maya', 'completed', true) $$,
  '[CHR-09][CHR-18] Maya making her bed does not make Leo''s: his is still to do, not covered');
select pg_temp.done(pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002'),
                    '0f110000-0000-0000-0000-000000000001');
select results_eq(
  $$ select m.display_name::text, v.member_status, v.credited
       from public.v_member_occurrence v join public.member m on m.id = v.member_id
      where v.occurrence_id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 1, '0f110000-0000-0000-0000-000000000002')
      order by 1 $$,
  $$ values ('Leo'::text, 'covered'::text, false), ('Maya', 'completed', true) $$,
  '[CHR-09] when Maya makes Leo''s bed for him, she is credited and his is covered');

select private.generate_occurrences('0f000000-0000-0000-0000-000000000001', pg_temp.today() - 1, pg_temp.today() - 1);
select public.record_completions(jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'event_type', 'complete', 'occurred_at', now() - interval '1 day',
  'occurrence_id', pg_temp.occ('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() - 1, '0f110000-0000-0000-0000-000000000001'),
  'done_by', jsonb_build_array('0f110000-0000-0000-0000-000000000001'))));
select private.close_past_due('0f000000-0000-0000-0000-000000000001');
select results_eq(
  $$ select m.display_name::text, o.status from public.chore_occurrence o join public.member m on m.id = o.member_id
      where o.chore_id = '0f4e0000-0000-0000-0000-000000000001' and o.due_date = pg_temp.today() - 1 order by 1 $$,
  $$ values ('Leo'::text, 'missed'::text), ('Maya', 'completed') $$,
  '[CHR-07][CHR-18] at day close, only the one who did not make their bed missed it');

-- Switching mode (D-45: nothing someone acted on changes; the past never does) ----------------------
select pg_temp.item('0f4e0000-0000-0000-0000-000000000003', 'Brush teeth', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 'each');
select pg_temp.done(pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today(), '0f110000-0000-0000-0000-000000000001'),
                    '0f110000-0000-0000-0000-000000000001');
update public.chore set assignment = 'shared' where id = '0f4e0000-0000-0000-0000-000000000003';
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today()), 'Maya=1',
  '[CHR-18] switched to shared: today keeps Maya''s done one and drops Leo''s untouched one; no shared one is added, so today is not counted twice');
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000003', pg_temp.today() + 1, pg_temp.today() + 14), 'shared=14',
  '[CHR-18] from tomorrow there is one shared occurrence a day');
update public.chore set assignment = 'each' where id = '0f4e0000-0000-0000-0000-000000000003';
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today() + 14), 'Leo=15,Maya=15',
  '[CHR-18] switched back: each person''s own again, today included, with Maya''s check-off kept');
select is((select status from public.chore_occurrence
            where id = pg_temp.occ('0f4e0000-0000-0000-0000-000000000003', pg_temp.today(), '0f110000-0000-0000-0000-000000000001')),
  'completed', '[CHR-18] the occurrence someone acted on is the same one, still done');

select pg_temp.item('0f4e0000-0000-0000-0000-000000000006', 'Water the plants', 'chore', '{"freq": "daily"}',
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 'shared');
update public.chore set assignment = 'each' where id = '0f4e0000-0000-0000-0000-000000000006';
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000006', pg_temp.today(), pg_temp.today() + 14), 'Leo=15,Maya=15',
  '[CHR-18] a shared item nobody has done today, switched to each, becomes each person''s own from today');

-- Who it is for ----------------------------------------------------------------------------------------
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('0f000000-0000-0000-0000-000000000001', '0f4e0000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000003');
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 14), 'Leo=15,Maya=15,Pat=15',
  '[CHR-18] someone added gets their own occurrences from today');
delete from public.chore_assignee where chore_id = '0f4e0000-0000-0000-0000-000000000001' and member_id = '0f110000-0000-0000-0000-000000000003';
update public.member set archived_at = now() where id = '0f110000-0000-0000-0000-000000000002';
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 14), 'Leo=1,Maya=15',
  '[CHR-18] someone taken off, or archived, loses their untouched occurrences from today; Leo keeps tomorrow''s, which Maya did for him');
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000001', pg_temp.today() - 1, pg_temp.today() - 1), 'Leo=1,Maya=1',
  '[CHR-18] and yesterday stays as it was');
update public.member set archived_at = null where id = '0f110000-0000-0000-0000-000000000002';
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 14), 'Leo=15,Maya=15',
  '[CHR-18] restored, Leo has his own again');

-- Late one-off tasks, shared and each ------------------------------------------------------------------
select pg_temp.item('0f4e0000-0000-0000-0000-000000000004', 'Thank-you notes', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 2),
                    array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[], 'each');
select is(pg_temp.who('0f4e0000-0000-0000-0000-000000000004', pg_temp.today() - 2, pg_temp.today() - 2), 'Leo=1,Maya=1',
  '[CHR-12][CHR-18] a one-off task for each person, entered after its date, is open and overdue for each of them');

select throws_ok(
  $$ insert into public.chore_occurrence (household_id, chore_id, due_date, member_id, kind, points_snapshot, requires_approval_snapshot)
     values ('0f000000-0000-0000-0000-000000000001', '0f4e0000-0000-0000-0000-000000000001', pg_temp.today() + 3,
             '0f110000-0000-0000-0000-000000000001', 'chore', 5, false) $$,
  '23505', null, '[CHR-18] one occurrence per item, day and person');

-- Saving: the form's mode is kept; with none (the app before WP-43), a new item is shared and an edit
-- keeps its mode (D-37: production keeps working while this is on a preview) --------------------------
select set_config('request.jwt.claims', json_build_object('sub', '0f100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
create temp table saved (kind text, id uuid);
grant all on saved to authenticated;
select set_config('role', 'authenticated', true);
insert into saved select 'chore', public.save_chore('0f000000-0000-0000-0000-000000000001', null,
  '{"kind": "chore", "title": "Tidy room", "schedule": {"freq": "daily"}, "assignment": "each"}',
  array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[]);
insert into saved select 'task', public.save_chore('0f000000-0000-0000-0000-000000000001', null,
  jsonb_build_object('kind', 'task', 'title', 'Call the plumber', 'schedule', jsonb_build_object('freq', 'once', 'on_date', pg_temp.today())),
  array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000003']::uuid[]);
select public.save_chore('0f000000-0000-0000-0000-000000000001', (select id from saved where kind = 'chore'),
  '{"title": "Tidy your room"}', array['0f110000-0000-0000-0000-000000000001', '0f110000-0000-0000-0000-000000000002']::uuid[]);
reset role;
select results_eq(
  $$ select s.kind, c.title, c.assignment from saved s join public.chore c on c.id = s.id order by 1 $$,
  $$ values ('chore'::text, 'Tidy your room'::text, 'each'::text), ('task', 'Call the plumber', 'shared') $$,
  '[CHR-18] the mode saved is the one given; with none, a new item is shared and an edit keeps its mode');

select * from finish();
rollback;
