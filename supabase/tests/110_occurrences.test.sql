-- [CHR-02][CHR-03][CHR-09][CHR-11][CHR-12][SCH-03] The occurrence generator (WP-09): schedules, one
-- shared occurrence per item per day with its assignee snapshot, day types, idempotent generation,
-- re-planning that never touches the past and reaches today only in place (a property test over
-- random edits), late
-- one-off tasks, closures, DST, the per-member view and who can read occurrences. Dates are relative
-- to today, so the file passes on any day.
begin;
select plan(41);

-- Fixtures ---------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('0c100000-0000-0000-0000-000000000001', 'parent@example.com'),
  ('0c200000-0000-0000-0000-000000000002', 'other-parent@example.com'),
  ('0cd00000-0000-0000-0000-00000000000d', null);
insert into public.household (id, name, timezone) values
  ('0c000000-0000-0000-0000-000000000001', 'Occurrence family', 'America/Chicago'),
  ('0c000000-0000-0000-0000-000000000002', 'DST family', 'America/New_York');
insert into public.household_settings (household_id) values
  ('0c000000-0000-0000-0000-000000000001'), ('0c000000-0000-0000-0000-000000000002');
insert into public.household_user (household_id, user_id, role) values
  ('0c000000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000001', 'owner'),
  ('0c000000-0000-0000-0000-000000000001', '0c200000-0000-0000-0000-000000000002', 'admin');
insert into public.member (id, household_id, display_name, role, user_id) values
  ('0c110000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'Maya', 'child', null),
  ('0c110000-0000-0000-0000-000000000002', '0c000000-0000-0000-0000-000000000001', 'Leo', 'child', null),
  ('0c110000-0000-0000-0000-000000000003', '0c000000-0000-0000-0000-000000000001', 'Pat', 'adult', '0c100000-0000-0000-0000-000000000001'),
  ('0c110000-0000-0000-0000-000000000009', '0c000000-0000-0000-0000-000000000002', 'Dee', 'child', null);
insert into public.device (household_id, name, auth_user_id) values
  ('0c000000-0000-0000-0000-000000000001', 'Kitchen', '0cd00000-0000-0000-0000-00000000000d');

-- Helpers: the household's today, and an item made directly (as the seed does).
create function pg_temp.today() returns date language sql as $$
  select private.household_today('0c000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.item(p_id uuid, p_title text, p_kind text, p_schedule jsonb, p_members uuid[],
                             p_day_types text[] default array['school_day', 'no_school', 'break', 'weekend', 'summer'],
                             p_visibility text default 'family')
returns uuid language plpgsql as $$
begin
  insert into public.chore (id, household_id, title, kind, points, schedule, day_types, visibility, created_by, start_date)
  values (p_id, '0c000000-0000-0000-0000-000000000001', p_title, p_kind, 5, p_schedule, p_day_types, p_visibility,
          '0c100000-0000-0000-0000-000000000001', pg_temp.today() - 30);
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select '0c000000-0000-0000-0000-000000000001', p_id, unnest(p_members);
  return p_id;
end $$;
create function pg_temp.count_in(p_chore uuid, p_from date, p_to date) returns int language sql as $$
  select count(*)::int from public.chore_occurrence where chore_id = p_chore and due_date between p_from and p_to
$$;
-- Everything about the occurrences up to a date, as one fingerprint.
create function pg_temp.history(p_through date) returns text language sql as $$
  select coalesce(md5(string_agg(
           o.id || '|' || o.chore_id || '|' || o.due_date || '|' || coalesce(o.due_time::text, '-') || '|'
           || o.points_snapshot || '|' || o.requires_approval_snapshot || '|' || o.kind || '|'
           || coalesce((select string_agg(a.member_id || ':' || a.day_type, ',' order by a.member_id)
                          from public.chore_occurrence_assignee a where a.occurrence_id = o.id), ''),
           ',' order by o.id)), 'none')
    from public.chore_occurrence o
   where o.household_id = '0c000000-0000-0000-0000-000000000001' and o.due_date <= p_through
$$;
-- Today's untouched occurrences that do not match their item as it is now: archived, the other mode
-- (D-47), or other points, time, kind, approval or people (a shared one: the active assignees; an
-- "each" one: its own person, still an active assignee). An item's own edit keeps this at zero (D-45).
create function pg_temp.today_drift() returns int language sql as $$
  select count(*)::int
    from public.chore_occurrence o join public.chore c on c.id = o.chore_id
   where o.household_id = '0c000000-0000-0000-0000-000000000001' and o.due_date = pg_temp.today()
     and o.status = 'scheduled' and o.status_event_id is null
     and (c.archived_at is not null
          or (o.member_id is null) <> (c.assignment = 'shared')
          or (o.due_time, o.kind, o.points_snapshot, o.requires_approval_snapshot)
             is distinct from (c.due_time, c.kind, c.points, private.chore_requires_approval(c.id))
          or (select array_agg(a.member_id order by a.member_id) from public.chore_occurrence_assignee a
               where a.occurrence_id = o.id)
             is distinct from (case when o.member_id is not null then array[o.member_id]
                                    else (select array_agg(a.member_id order by a.member_id) from public.chore_assignee a
                                            join public.member m on m.id = a.member_id and m.archived_at is null
                                           where a.chore_id = c.id) end)
          or (o.member_id is not null and not exists (
                select from public.chore_assignee a join public.member m on m.id = a.member_id and m.archived_at is null
                 where a.chore_id = c.id and a.member_id = o.member_id)))
$$;
-- Today's occurrences, as {"chore_id:person": id} (person "-" for a shared one).
create function pg_temp.today_ids() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(chore_id || ':' || coalesce(member_id::text, '-'), id), '{}') from public.chore_occurrence
   where household_id = '0c000000-0000-0000-0000-000000000001' and due_date = pg_temp.today()
$$;

-- A default school year around today with weekdays as school days.
insert into public.school_year (id, household_id, name, start_date, end_date, is_default) values
  ('0c5e0000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'This year',
   pg_temp.today() - 60, pg_temp.today() + 120, true);

-- Schedules ----------------------------------------------------------------------------------------
select results_eq(
  $$ select string_agg(d::date::text, ',' order by d)
       from generate_series('2026-10-01'::date, '2026-10-31'::date, interval '1 day') d
      where private.schedule_matches('{"freq": "weekly", "by_weekday": [1, 3], "interval": 2}', '2026-10-05', d::date) $$,
  $$ values ('2026-10-05,2026-10-07,2026-10-19,2026-10-21'::text) $$,
  '[CHR-02] every other week on Monday and Wednesday, counted from the start week');
select results_eq(
  $$ select string_agg(d::date::text, ',' order by d)
       from generate_series('2026-10-01'::date, '2026-10-10'::date, interval '1 day') d
      where private.schedule_matches('{"freq": "daily", "interval": 3}', '2026-10-02', d::date) $$,
  $$ values ('2026-10-02,2026-10-05,2026-10-08'::text) $$,
  '[CHR-02] every third day from the start date, nothing before it');
select results_eq(
  $$ select string_agg(d::date::text, ',' order by d)
       from generate_series('2027-01-01'::date, '2027-04-30'::date, interval '1 day') d
      where private.schedule_matches('{"freq": "monthly", "by_month_day": [31]}', '2026-12-01', d::date) $$,
  $$ values ('2027-01-31,2027-02-28,2027-03-31,2027-04-30'::text) $$,
  '[CHR-02] monthly on the 31st falls on the last day of a shorter month (D-45)');
select ok(private.schedule_matches('{"freq": "once", "on_date": "2026-09-01"}', '2026-10-01', '2026-09-01')
          and not private.schedule_matches('{"freq": "once", "on_date": "2026-09-01"}', '2026-10-01', '2026-09-02'),
  '[CHR-02] a one-off falls on its date only, whatever its start date');

-- Generation ---------------------------------------------------------------------------------------
select pg_temp.item('0c4e0000-0000-0000-0000-000000000001', 'Feed the dog', 'chore', '{"freq": "daily"}',
                    array['0c110000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000003']::uuid[]);
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today() + 14), 15,
  '[CHR-03] a daily item has one occurrence a day, today and the next 14 days, as soon as it is saved');
select is((select count(*)::int from public.chore_occurrence
            where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date < pg_temp.today()), 0,
  '[CHR-03] a new item is not back-filled into the past');
select results_eq(
  $$ select count(*)::int, count(distinct o.id)::int
       from public.chore_occurrence o join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      where o.chore_id = '0c4e0000-0000-0000-0000-000000000001' $$,
  $$ values (30, 15) $$,
  '[CHR-09] a shared item has one occurrence a day, with both assignees in its snapshot');
select is(public.generate_household_occurrences('0c000000-0000-0000-0000-000000000001') ->> 'added', '0',
  '[CHR-03] the hourly job finds nothing to add (idempotent)');

select pg_temp.item('0c4e0000-0000-0000-0000-000000000002', 'Homework', 'chore', '{"freq": "daily"}',
                    array['0c110000-0000-0000-0000-000000000001']::uuid[], array['school_day']);
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today(), pg_temp.today() + 14),
  (select count(*)::int from generate_series(pg_temp.today(), pg_temp.today() + 14, interval '1 day') d
    where extract(isodow from d) < 6),
  '[SCH-03] a school-days-only item has an occurrence on each weekday of the school year and none at weekends');
select results_eq(
  $$ select a.day_type from public.chore_occurrence o join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      where o.chore_id = '0c4e0000-0000-0000-0000-000000000002' group by a.day_type $$,
  $$ values ('school_day'::text) $$,
  '[SCH-03] each assignee''s day type on the day is kept with the snapshot');
update public.chore set due_time = '07:30' where id = '0c4e0000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000002'
             and due_date > pg_temp.today() and due_time = '07:30'),
          (select count(*)::int from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000002'
             and due_date > pg_temp.today()),
  '[CHR-11] a due time set later reaches every occurrence after today');

-- Late one-off tasks show as overdue; one-off routines in the past do not.
select pg_temp.item('0c4e0000-0000-0000-0000-000000000003', 'Pay the school fee', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 3),
                    array['0c110000-0000-0000-0000-000000000003']::uuid[]);
select pg_temp.item('0c4e0000-0000-0000-0000-000000000004', 'Clean the garage', 'chore',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() - 3),
                    array['0c110000-0000-0000-0000-000000000003']::uuid[]);
select results_eq(
  $$ select chore_id, due_date, status from public.chore_occurrence
      where chore_id in ('0c4e0000-0000-0000-0000-000000000003', '0c4e0000-0000-0000-0000-000000000004') $$,
  $$ values ('0c4e0000-0000-0000-0000-000000000003'::uuid, pg_temp.today() - 3, 'scheduled'::text) $$,
  '[CHR-12] a one-off task entered after its date is open and overdue; a one-off routine in the past is not made');
update public.chore set schedule = jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() + 2)
 where id = '0c4e0000-0000-0000-0000-000000000003';
select results_eq(
  $$ select due_date from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000003' $$,
  $$ values (pg_temp.today() + 2) $$,
  '[CHR-12] moving an open one-off task moves its occurrence; nothing was done, so nothing is kept');

-- Approval flag: the item's own, else the household switch; the switch re-resolves only untouched
-- occurrences (D-22).
update public.chore set approval = 'required' where id = '0c4e0000-0000-0000-0000-000000000002';
select ok((select bool_and(requires_approval_snapshot) from public.chore_occurrence
            where chore_id = '0c4e0000-0000-0000-0000-000000000002' and due_date > pg_temp.today())
          and not (select bool_or(requires_approval_snapshot) from public.chore_occurrence
                    where chore_id = '0c4e0000-0000-0000-0000-000000000001'),
  '[CHR-05] an item that requires approval says so; one that inherits follows the switch (off)');
update public.chore_occurrence set status = 'pending_approval', status_event_id = gen_random_uuid()
 where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date = pg_temp.today();
update public.household_settings set approval_mode = 'on' where household_id = '0c000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select status, requires_approval_snapshot, count(*)::int from public.chore_occurrence
      where chore_id = '0c4e0000-0000-0000-0000-000000000001' group by 1, 2 order by 1 $$,
  $$ values ('pending_approval'::text, false, 1), ('scheduled', true, 14) $$,
  '[CHR-05] switching approval on re-resolves untouched occurrences; one already waiting keeps its flag');
update public.household_settings set approval_mode = 'off' where household_id = '0c000000-0000-0000-0000-000000000001';
update public.chore_occurrence set status = 'scheduled', status_event_id = null
 where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date = pg_temp.today();

-- Re-planning keeps history ------------------------------------------------------------------------
-- Back-fill a week of past occurrences, as if generated over the last week.
select private.generate_occurrences('0c000000-0000-0000-0000-000000000001', pg_temp.today() - 7, pg_temp.today() - 1);
select pg_temp.history(pg_temp.today() - 1) as before \gset
select ok(:'before' <> 'none', '[CHR-03] there is history to protect');
select id as today_id from public.chore_occurrence
 where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date = pg_temp.today() \gset

update public.chore set schedule = '{"freq": "weekly", "by_weekday": [6, 7]}', points = 9
 where id = '0c4e0000-0000-0000-0000-000000000001';
select is(pg_temp.history(pg_temp.today() - 1), :'before', '[CHR-03] changing an item''s schedule and points leaves the past as it was');
select ok(case when extract(isodow from pg_temp.today()) >= 6
               then (select id = :'today_id' and points_snapshot = 9 from public.chore_occurrence
                      where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date = pg_temp.today())
               else not exists (select from public.chore_occurrence
                                 where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date = pg_temp.today()) end,
  '[CHR-03] today''s untouched occurrence follows the edit in place: new points on the same occurrence, or gone if no longer due (D-45)');
select ok((select bool_and(extract(isodow from due_date) >= 6 and points_snapshot = 9) from public.chore_occurrence
            where chore_id = '0c4e0000-0000-0000-0000-000000000001' and due_date > pg_temp.today()),
  '[CHR-03] after today, the item follows its new schedule and points');

delete from public.chore_assignee where chore_id = '0c4e0000-0000-0000-0000-000000000001'
   and member_id = '0c110000-0000-0000-0000-000000000003';
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('0c000000-0000-0000-0000-000000000001', '0c4e0000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000002');
select is(pg_temp.history(pg_temp.today() - 1), :'before', '[CHR-09] changing who an item is for leaves past snapshots as they were');
select ok(not exists (select from public.chore_occurrence o join public.chore_occurrence_assignee a on a.occurrence_id = o.id
                       where o.chore_id = '0c4e0000-0000-0000-0000-000000000001' and o.due_date > pg_temp.today()
                         and a.member_id = '0c110000-0000-0000-0000-000000000003'),
  '[CHR-09] after today, the snapshot has the new assignees');

-- Property test: 40 random edits of every kind, switching items between shared and each (D-47)
-- included; after each, the past is unchanged, today's untouched occurrences match their items and
-- keep their ids, and generating again adds nothing.
create function pg_temp.random_edits(p_n int) returns text language plpgsql as $$
declare
  v_items uuid[] := array['0c4e0000-0000-0000-0000-000000000001', '0c4e0000-0000-0000-0000-000000000002',
                          '0c4e0000-0000-0000-0000-000000000003']::uuid[];
  v_members uuid[] := array['0c110000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000002',
                            '0c110000-0000-0000-0000-000000000003']::uuid[];
  v_schedules jsonb[] := array['{"freq": "daily"}', '{"freq": "daily", "interval": 2}',
                               '{"freq": "weekly", "by_weekday": [1, 3, 5]}', '{"freq": "monthly", "by_month_day": [1, 15, 31]}']::jsonb[];
  v_types text[] := array['school_day', 'no_school', 'break', 'weekend', 'summer'];
  v_item uuid; v_member uuid; v_before text := pg_temp.history(pg_temp.today() - 1); v_added int; v_ids jsonb;
begin
  perform setseed(0.42);
  for i in 1..p_n loop
    v_item := v_items[1 + floor(random() * 3)::int];
    v_member := v_members[1 + floor(random() * 3)::int];
    v_ids := pg_temp.today_ids();
    case floor(random() * 8)::int
      when 0 then update public.chore set schedule = v_schedules[1 + floor(random() * 4)::int], kind = 'chore' where id = v_item;
      when 1 then update public.chore set day_types = (select array_agg(t) from unnest(v_types) t where random() < 0.6 or t = 'weekend') where id = v_item;
      when 2 then update public.chore set points = floor(random() * 20)::int, due_time = case when random() < 0.5 then null else '16:00'::time end where id = v_item;
      when 3 then
        if exists (select from public.chore_assignee where chore_id = v_item and member_id = v_member)
           and (select count(*) from public.chore_assignee where chore_id = v_item) > 1 then
          delete from public.chore_assignee where chore_id = v_item and member_id = v_member;
        else
          insert into public.chore_assignee (household_id, chore_id, member_id)
          values ('0c000000-0000-0000-0000-000000000001', v_item, v_member) on conflict do nothing;
        end if;
      when 4 then update public.chore set archived_at = case when archived_at is null then now() end where id = v_item;
      when 6 then update public.chore set assignment = case when assignment = 'shared' then 'each' else 'shared' end where id = v_item;
      when 5 then
        insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
        values ('0c000000-0000-0000-0000-000000000001', '0c5e0000-0000-0000-0000-000000000001', 'Random',
                case when random() < 0.5 then 'break' else 'snow_day' end,
                pg_temp.today() + floor(random() * 10)::int, pg_temp.today() + 10);
      else update public.member set archived_at = case when archived_at is null then now() end where id = v_member;
    end case;
    if pg_temp.history(pg_temp.today() - 1) <> v_before then
      return 'history changed at edit ' || i;
    end if;
    if pg_temp.today_drift() <> 0 then
      return 'today does not match its items after edit ' || i;
    end if;
    if exists (select from jsonb_each_text(pg_temp.today_ids()) n join jsonb_each_text(v_ids) b using (key)
                where n.value <> b.value) then
      return 'today''s occurrence was replaced at edit ' || i;
    end if;
    v_added := (public.generate_household_occurrences('0c000000-0000-0000-0000-000000000001') ->> 'added')::int;
    if v_added <> 0 then
      return 'generation after edit ' || i || ' added ' || v_added;
    end if;
  end loop;
  return 'ok';
end $$;
select is(pg_temp.random_edits(40), 'ok',
  '[CHR-03] property: across 40 random edits, the past never changes, today''s untouched occurrences follow each edit and keep their ids, and every re-plan is complete');
update public.member set archived_at = null where household_id = '0c000000-0000-0000-0000-000000000001';
update public.chore set archived_at = null where household_id = '0c000000-0000-0000-0000-000000000001';
delete from public.school_closure where name = 'Random';

-- School-year changes (D-24) -----------------------------------------------------------------------
update public.chore set schedule = '{"freq": "daily"}', day_types = '{school_day}', kind = 'chore'
 where id = '0c4e0000-0000-0000-0000-000000000002';
select pg_temp.history(pg_temp.today()) as before_closure \gset
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('0c000000-0000-0000-0000-000000000001', '0c5e0000-0000-0000-0000-000000000001', 'Snow day', 'snow_day', pg_temp.today(), pg_temp.today());
select is(pg_temp.history(pg_temp.today()), :'before_closure', '[SCH-03] a closure added for today leaves today alone (D-24)');
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today(), pg_temp.today()),
  case when extract(isodow from pg_temp.today()) < 6 then 1 else 0 end,
  '[SCH-03] today''s school-day occurrence stays even though today is now a snow day');
insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date) values
  ('0c000000-0000-0000-0000-000000000001', '0c5e0000-0000-0000-0000-000000000001', 'Next week''s break', 'break',
   pg_temp.today() + 7, pg_temp.today() + 13);
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today() + 7, pg_temp.today() + 13), 0,
  '[SCH-03] a break added for next week removes that week''s school-only occurrences');
delete from public.school_closure where name = 'Next week''s break';
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today() + 7, pg_temp.today() + 13), 5,
  '[SCH-03] removing the break brings them back');

-- Archived items and members ----------------------------------------------------------------------
update public.chore set archived_at = now() where id = '0c4e0000-0000-0000-0000-000000000002';
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today(), pg_temp.today() + 14), 0,
  '[CHR-01] archiving an item removes its untouched occurrences from today on, so today''s is never missed');
update public.chore set archived_at = null where id = '0c4e0000-0000-0000-0000-000000000002';
delete from public.chore_assignee where chore_id = '0c4e0000-0000-0000-0000-000000000002'
   and member_id <> '0c110000-0000-0000-0000-000000000001';
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('0c000000-0000-0000-0000-000000000001', '0c4e0000-0000-0000-0000-000000000002', '0c110000-0000-0000-0000-000000000001')
  on conflict do nothing;
update public.member set archived_at = now() where id = '0c110000-0000-0000-0000-000000000001';
select is(pg_temp.count_in('0c4e0000-0000-0000-0000-000000000002', pg_temp.today(), pg_temp.today() + 14), 0,
  '[CHR-09] an item whose only assignee is archived has nothing from today on');
update public.member set archived_at = null where id = '0c110000-0000-0000-0000-000000000001';

-- Today follows an item's own edits in place (D-45) -------------------------------------------------
select pg_temp.item('0c4e0000-0000-0000-0000-000000000007', 'Feed the cat', 'chore', '{"freq": "daily"}',
                    array['0c110000-0000-0000-0000-000000000001']::uuid[]);
select id as cat_today from public.chore_occurrence
 where chore_id = '0c4e0000-0000-0000-0000-000000000007' and due_date = pg_temp.today() \gset
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('0c000000-0000-0000-0000-000000000001', '0c4e0000-0000-0000-0000-000000000007', '0c110000-0000-0000-0000-000000000002');
select results_eq(
  $$ select o.id, array_agg(a.member_id order by a.member_id) from public.chore_occurrence o
       join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      where o.chore_id = '0c4e0000-0000-0000-0000-000000000007' and o.due_date = pg_temp.today() group by o.id $$,
  format($$ values ('%s'::uuid, array['0c110000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000002']::uuid[]) $$, :'cat_today'),
  '[CHR-09] someone added to an item in the morning is in today''s occurrence, which stays the same one');
delete from public.chore_assignee where chore_id = '0c4e0000-0000-0000-0000-000000000007'
   and member_id = '0c110000-0000-0000-0000-000000000001';
select results_eq(
  $$ select o.id, array_agg(a.member_id order by a.member_id) from public.chore_occurrence o
       join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      where o.chore_id = '0c4e0000-0000-0000-0000-000000000007' and o.due_date = pg_temp.today() group by o.id $$,
  format($$ values ('%s'::uuid, array['0c110000-0000-0000-0000-000000000002']::uuid[]) $$, :'cat_today'),
  '[CHR-09] someone taken off an item leaves today''s occurrence, which stays the same one');
update public.chore_occurrence set status = 'completed', done_by = '{0c110000-0000-0000-0000-000000000002}',
       rewarded = '{0c110000-0000-0000-0000-000000000002}', status_event_id = gen_random_uuid()
 where id = :'cat_today';
update public.chore set archived_at = now(), points = 50 where id = '0c4e0000-0000-0000-0000-000000000007';
select results_eq(
  $$ select id, status, points_snapshot from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000007' $$,
  format($$ values ('%s'::uuid, 'completed'::text, 5) $$, :'cat_today'),
  '[CHR-03] an occurrence someone acted on today stays as it was when its item changes or is archived');

-- Per-member view (D-30) --------------------------------------------------------------------------
select pg_temp.item('0c4e0000-0000-0000-0000-000000000006', 'Water the plants', 'chore', '{"freq": "daily"}',
                    array['0c110000-0000-0000-0000-000000000001', '0c110000-0000-0000-0000-000000000002']::uuid[]);
update public.chore_occurrence set status = 'completed', done_by = '{0c110000-0000-0000-0000-000000000002}',
       rewarded = '{0c110000-0000-0000-0000-000000000002}', status_event_id = gen_random_uuid()
 where chore_id = '0c4e0000-0000-0000-0000-000000000006' and due_date = pg_temp.today() + 1;
select results_eq(
  $$ select m.display_name, v.member_status, v.credited, v.rewarded
       from public.v_member_occurrence v join public.member m on m.id = v.member_id
      where v.chore_id = '0c4e0000-0000-0000-0000-000000000006' and v.due_date = pg_temp.today() + 1
      order by m.display_name $$,
  $$ values ('Leo'::text, 'completed'::text, true, true), ('Maya', 'covered', false, false) $$,
  '[CHR-09] a shared item done by one assignee is done for them and covered for the other');

-- DST (America/New_York ends DST on 2026-11-01 and starts it on 2027-03-14) ------------------------
select results_eq(
  $$ select private.local_date('America/New_York', t) from (values
       ('2026-11-01 03:59:00+00'::timestamptz), ('2026-11-01 04:00:00+00'), ('2026-11-02 04:59:00+00'), ('2026-11-02 05:00:00+00'),
       ('2027-03-14 04:59:00+00'), ('2027-03-14 05:00:00+00'), ('2027-03-15 03:59:00+00'), ('2027-03-15 04:00:00+00')) v (t) $$,
  $$ values ('2026-10-31'::date), ('2026-11-01'), ('2026-11-01'), ('2026-11-02'),
            ('2027-03-13'), ('2027-03-14'), ('2027-03-14'), ('2027-03-15') $$,
  '[CHR-03] the household''s date turns at local midnight on both sides of a DST change');
insert into public.chore (id, household_id, title, schedule, created_by, start_date) values
  ('0c4e0000-0000-0000-0000-000000000009', '0c000000-0000-0000-0000-000000000002', 'Brush teeth', '{"freq": "daily"}',
   '0c100000-0000-0000-0000-000000000001', '2026-10-25');
insert into public.chore_assignee (household_id, chore_id, member_id) values
  ('0c000000-0000-0000-0000-000000000002', '0c4e0000-0000-0000-0000-000000000009', '0c110000-0000-0000-0000-000000000009');
select private.generate_occurrences('0c000000-0000-0000-0000-000000000002', '2026-10-28', '2026-11-04');
select private.generate_occurrences('0c000000-0000-0000-0000-000000000002', '2027-03-11', '2027-03-17');
select results_eq(
  $$ select count(*)::int, count(distinct due_date)::int from public.chore_occurrence
      where chore_id = '0c4e0000-0000-0000-0000-000000000009'
        and (due_date between '2026-10-28' and '2026-11-04' or due_date between '2027-03-11' and '2027-03-17') $$,
  $$ values (15, 15) $$,
  '[CHR-03] across both DST changes a daily item has exactly one occurrence per day');

-- Who can read occurrences (D-34) ------------------------------------------------------------------
select pg_temp.item('0c4e0000-0000-0000-0000-000000000005', 'Buy a present', 'task',
                    jsonb_build_object('freq', 'once', 'on_date', pg_temp.today() + 1),
                    array['0c110000-0000-0000-0000-000000000003']::uuid[], p_visibility => 'private');
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', '0c200000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000005')
          + (select count(*)::int from public.chore_occurrence_assignee a join public.chore_occurrence o on o.id = a.occurrence_id
              where o.chore_id = '0c4e0000-0000-0000-0000-000000000005')
          + (select count(*)::int from public.v_member_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000005'), 0,
  '[CHR-13] the other admin gets no occurrence, snapshot or per-member row of a private item');
select ok((select count(*) from public.chore_occurrence) > 0, '[CHR-03] an admin reads the family''s occurrences');
select throws_ok(
  $$ insert into public.chore_occurrence (household_id, chore_id, due_date, kind, points_snapshot, requires_approval_snapshot)
     values ('0c000000-0000-0000-0000-000000000001', '0c4e0000-0000-0000-0000-000000000001', current_date + 100, 'chore', 5, false) $$,
  '42501', null, '[CHR-03] an admin cannot write occurrences directly; only the generator and events do');
select set_config('request.jwt.claims', json_build_object('sub', '0c100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.chore_occurrence where chore_id = '0c4e0000-0000-0000-0000-000000000005'), 1,
  '[CHR-13] the private item''s creator, its assignee, reads its occurrence');
select set_config('request.jwt.claims', json_build_object('sub', '0cd00000-0000-0000-0000-00000000000d', 'role', 'authenticated')::text, true);
select results_eq(
  $$ select count(*) filter (where chore_id = '0c4e0000-0000-0000-0000-000000000005')::int, (count(*) > 0) from public.chore_occurrence $$,
  $$ values (0, true) $$,
  '[CHR-13] the board reads family occurrences and never a private one');
select throws_ok(
  $$ select public.generate_household_occurrences('0c000000-0000-0000-0000-000000000001') $$,
  '42501', null, '[CHR-03] only the job (service role) runs the generator through the API');
reset role;

select ok(not has_function_privilege('anon', 'private.generate_occurrences(uuid, date, date, uuid[])', 'execute')
          and not has_function_privilege('authenticated', 'private.replan(uuid, date, uuid[])', 'execute'),
  '[NFR-04] the generator''s internals are not callable from outside');

select * from finish();
rollback;
