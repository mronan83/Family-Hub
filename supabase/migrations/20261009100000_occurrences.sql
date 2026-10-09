-- [CHR-02][CHR-03][CHR-09][CHR-11][CHR-12][SCH-03] The occurrence generator (WP-09, 02 §3.2, §4.2,
-- D-24, D-30, D-31, D-45): one chore_occurrence per item per due date for a rolling 14 days, shared by
-- its assignees, with a snapshot of who was responsible, its kind, due time, points and approval
-- flag. Generation runs in the database: the hourly occurrence_gen job fills the window, and edits
-- re-plan at once. Only occurrences nothing has happened to ever change: an item's own edit reaches
-- today's in place, a school-year change starts tomorrow (D-24), and the past is history.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Status columns are the projection WP-10 maintains from completion events (02 §4.2); until then
-- every occurrence is `scheduled`.
create table public.chore_occurrence (
  id                         uuid primary key default gen_random_uuid(),
  household_id               uuid not null,
  chore_id                   uuid not null,
  due_date                   date not null,
  due_time                   time,
  kind                       text not null check (kind in ('chore', 'task')),
  points_snapshot            integer not null check (points_snapshot >= 0),
  requires_approval_snapshot boolean not null,
  status                     text not null default 'scheduled'
                               check (status in ('scheduled', 'completed', 'pending_approval', 'approved',
                                                 'rejected', 'skipped', 'missed')),
  done_by                    uuid[] not null default '{}',
  rewarded                   uuid[] not null default '{}',
  status_event_id            uuid,
  status_changed_at          timestamptz,
  finalized_at               timestamptz,
  created_at                 timestamptz not null default now(),
  unique (chore_id, due_date),
  unique (household_id, id),
  foreign key (household_id, chore_id) references public.chore (household_id, id) on delete cascade
);
create index on public.chore_occurrence (household_id, due_date, status);
create index on public.chore_occurrence (household_id, due_date)
  where kind = 'task' and status = 'scheduled';

-- Who was responsible on that date, and each one's day type then. Later assignee changes affect
-- only later occurrences.
create table public.chore_occurrence_assignee (
  household_id   uuid not null,
  occurrence_id  uuid not null,
  member_id      uuid not null,
  due_date       date not null,
  day_type       text not null check (day_type in ('school_day', 'no_school', 'break', 'weekend', 'summer')),
  primary key (occurrence_id, member_id),
  foreign key (household_id, occurrence_id) references public.chore_occurrence (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.chore_occurrence_assignee (household_id, member_id, due_date);

-- ---------------------------------------------------------------------------
-- Dates and schedules
-- ---------------------------------------------------------------------------

-- A business date: the instant's date in a time zone (02 §1). DST changes the offset, never the date
-- arithmetic, because occurrences are dates.
create function private.local_date(p_timezone text, p_at timestamptz) returns date
language sql stable set search_path = '' as $$
  select (p_at at time zone p_timezone)::date
$$;

create function private.household_today(p_household uuid) returns date
language sql stable security definer set search_path = '' as $$
  select private.local_date(h.timezone, now()) from public.household h where h.id = p_household
$$;

-- [CHR-02] Whether a schedule (02 §3.2, checked by private.valid_schedule) falls on a date, counting
-- its interval from the item's start date. Weeks are ISO (Monday first). A month day past the end of
-- a short month falls on its last day ("the 31st" is the 30th in April, the 28th or 29th in
-- February; D-45). A one-off falls on its date whatever the start date.
create function private.schedule_matches(p_schedule jsonb, p_start date, p_date date) returns boolean
language sql immutable set search_path = '' as $$
  select case p_schedule ->> 'freq'
    when 'once' then p_date = (p_schedule ->> 'on_date')::date
    when 'daily' then
      p_date >= p_start
      and (p_date - p_start) % coalesce((p_schedule ->> 'interval')::int, 1) = 0
    when 'weekly' then
      p_date >= p_start
      and extract(isodow from p_date)::int in (
        select d::int from jsonb_array_elements_text(p_schedule -> 'by_weekday') d)
      and ((date_trunc('week', p_date::timestamp)::date - date_trunc('week', p_start::timestamp)::date) / 7)
          % coalesce((p_schedule ->> 'interval')::int, 1) = 0
    when 'monthly' then
      p_date >= p_start
      and exists (
        select from jsonb_array_elements_text(p_schedule -> 'by_month_day') d
         where least(d::int, extract(day from (date_trunc('month', p_date::timestamp) + interval '1 month - 1 day'))::int)
               = extract(day from p_date)::int)
      and ((extract(year from p_date)::int * 12 + extract(month from p_date)::int)
           - (extract(year from p_start)::int * 12 + extract(month from p_start)::int))
          % coalesce((p_schedule ->> 'interval')::int, 1) = 0
    else false
  end
$$;

-- [SCH-03] As in WP-21, counting only active members: an archived member is off the board.
create or replace function public.chore_day_type_matches(p_chore uuid, p_date date) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select from public.chore c
      join public.chore_assignee a on a.chore_id = c.id
      join public.member m on m.id = a.member_id and m.archived_at is null
     where c.id = p_chore
       and public.resolve_day_type(a.member_id, p_date) = any (c.day_types))
$$;

-- Whether an item is due on a date: its schedule, its start and end, not archived, and the day type
-- of at least one active assignee.
create function private.chore_due_on(p_chore uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from public.chore c
     where c.id = p_chore and c.archived_at is null
       and private.schedule_matches(c.schedule, c.start_date, p_date)
       and (c.schedule ->> 'freq' = 'once' or p_date >= c.start_date)
       and (c.end_date is null or p_date <= c.end_date)
       and public.chore_day_type_matches(c.id, p_date))
$$;

-- An item's approval flag at generation: its own setting, or the household's switch (CHR-05).
create function private.chore_requires_approval(p_chore uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case c.approval
           when 'required' then true
           when 'none' then false
           else coalesce((select s.approval_mode = 'on' from public.household_settings s
                           where s.household_id = c.household_id), false)
         end
    from public.chore c where c.id = p_chore
$$;

-- ---------------------------------------------------------------------------
-- Generation
-- ---------------------------------------------------------------------------

-- [CHR-03] Adds the missing occurrences of a household's items (or just p_chores) from p_from to
-- p_to, each with its assignee snapshot. Idempotent: UNIQUE (chore_id, due_date) and ON CONFLICT DO
-- NOTHING. A one-off task whose date is before p_from still gets its occurrence, so a to-do entered
-- late shows as overdue (D-31). Returns how many occurrences it added.
create function private.generate_occurrences(
  p_household uuid, p_from date, p_to date, p_chores uuid[] default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
begin
  with wanted as (
    select c.id as chore_id, d::date as due_date
      from public.chore c
      cross join generate_series(p_from, p_to, interval '1 day') d
     where c.household_id = p_household and c.archived_at is null
       and (p_chores is null or c.id = any (p_chores))
       and private.chore_due_on(c.id, d::date)
    union
    select c.id, (c.schedule ->> 'on_date')::date
      from public.chore c
     where c.household_id = p_household and c.archived_at is null and c.kind = 'task'
       and c.schedule ->> 'freq' = 'once' and (c.schedule ->> 'on_date')::date < p_from
       and (p_chores is null or c.id = any (p_chores))
       and private.chore_due_on(c.id, (c.schedule ->> 'on_date')::date)
  ),
  added as (
    insert into public.chore_occurrence (household_id, chore_id, due_date, due_time, kind,
                                         points_snapshot, requires_approval_snapshot)
    select p_household, c.id, w.due_date, c.due_time, c.kind, c.points, private.chore_requires_approval(c.id)
      from wanted w join public.chore c on c.id = w.chore_id
    on conflict (chore_id, due_date) do nothing
    returning id, chore_id, due_date
  ),
  snapshot as (
    insert into public.chore_occurrence_assignee (household_id, occurrence_id, member_id, due_date, day_type)
    select p_household, ad.id, a.member_id, ad.due_date, public.resolve_day_type(a.member_id, ad.due_date)
      from added ad
      join public.chore_assignee a on a.chore_id = ad.chore_id
      join public.member m on m.id = a.member_id and m.archived_at is null
    returning 1
  )
  -- The snapshot insert runs with this statement whether or not its rows are read.
  select count(*) into v_added from added;
  return v_added;
end $$;

-- [CHR-03] Re-plans after a change (D-24, D-45). Only occurrences nothing has happened to
-- (`scheduled`, no event folded in) change, and never a past one:
-- - after today they are replaced, up to 14 days ahead;
-- - today's follow an item's own edit or a member's (p_from is today) in place, keeping their ids,
--   since a board's check-off (perhaps queued offline) points at them: gone if the item is no longer
--   due today, else brought up to date with its points, time, approval and who it is for. A school-year
--   change (p_from is tomorrow) leaves today as it was planned;
-- - an open one-off task whose date moved, or that was archived, goes on any date: it was never done.
create function private.replan(p_household uuid, p_from date, p_chores uuid[] default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household);
begin
  if v_today is null then
    return 0;  -- the household is being deleted
  end if;
  delete from public.chore_occurrence o
   where o.household_id = p_household and o.status = 'scheduled' and o.status_event_id is null
     and (p_chores is null or o.chore_id = any (p_chores))
     and (o.due_date > v_today
          or (o.due_date = v_today and p_from <= v_today and not private.chore_due_on(o.chore_id, v_today))
          or exists (select from public.chore c
                      where c.id = o.chore_id and c.kind = 'task' and c.schedule ->> 'freq' = 'once'
                        and (c.archived_at is not null or (c.schedule ->> 'on_date')::date <> o.due_date)));
  if p_from <= v_today then
    update public.chore_occurrence o
       set due_time = c.due_time, kind = c.kind, points_snapshot = c.points,
           requires_approval_snapshot = private.chore_requires_approval(c.id)
      from public.chore c
     where c.id = o.chore_id and o.household_id = p_household and o.due_date = v_today
       and o.status = 'scheduled' and o.status_event_id is null
       and (p_chores is null or o.chore_id = any (p_chores))
       and (o.due_time, o.kind, o.points_snapshot, o.requires_approval_snapshot)
           is distinct from (c.due_time, c.kind, c.points, private.chore_requires_approval(c.id));
    delete from public.chore_occurrence_assignee oa
     using public.chore_occurrence o
     where o.id = oa.occurrence_id and o.household_id = p_household and o.due_date = v_today
       and o.status = 'scheduled' and o.status_event_id is null
       and (p_chores is null or o.chore_id = any (p_chores))
       and not exists (select from public.chore_assignee a
                         join public.member m on m.id = a.member_id and m.archived_at is null
                        where a.chore_id = o.chore_id and a.member_id = oa.member_id);
    insert into public.chore_occurrence_assignee (household_id, occurrence_id, member_id, due_date, day_type)
    select p_household, o.id, a.member_id, o.due_date, public.resolve_day_type(a.member_id, o.due_date)
      from public.chore_occurrence o
      join public.chore_assignee a on a.chore_id = o.chore_id
      join public.member m on m.id = a.member_id and m.archived_at is null
     where o.household_id = p_household and o.due_date = v_today
       and o.status = 'scheduled' and o.status_event_id is null
       and (p_chores is null or o.chore_id = any (p_chores))
    on conflict do nothing;
  end if;
  return private.generate_occurrences(p_household, greatest(p_from, v_today), v_today + 14, p_chores);
end $$;

-- [CHR-03] The occurrence_gen job (hourly, 01 §5.6): tomorrow to 14 days ahead, plus late one-off
-- tasks. Never today: today was planned before it began, and only an item's own edit changes it, so
-- a closure added this morning cannot change today through the next run (D-24). Service role only.
create function public.generate_household_occurrences(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household_id);
  v_added integer;
begin
  if v_today is null then
    raise exception 'unknown household' using errcode = 'P0002';
  end if;
  v_added := private.generate_occurrences(p_household_id, v_today + 1, v_today + 14);
  return jsonb_build_object('added', v_added, 'from', v_today + 1, 'through', v_today + 14);
end $$;

-- ---------------------------------------------------------------------------
-- Re-planning on changes
-- ---------------------------------------------------------------------------

-- An item's own edit: what it is, when, for whom, or archived. From today, so a new item shows today.
create function private.replan_chore() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.replan(new.household_id, private.household_today(new.household_id), array[new.id]);
  return null;
end $$;
create trigger trg_chore_replan after insert or update of schedule, day_types, due_time, points, approval,
  kind, start_date, end_date, archived_at on public.chore
  for each row execute function private.replan_chore();

-- Assignees added or removed: those items, from today.
create function private.replan_assignees() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in select household_id, array_agg(distinct chore_id) as chores from changed group by household_id loop
    perform private.replan(r.household_id, private.household_today(r.household_id), r.chores);
  end loop;
  return null;
end $$;
create trigger trg_chore_assignee_added after insert on public.chore_assignee
  referencing new table as changed for each statement execute function private.replan_assignees();
create trigger trg_chore_assignee_removed after delete on public.chore_assignee
  referencing old table as changed for each statement execute function private.replan_assignees();

-- A member archived or restored: their items, from today.
create function private.replan_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.replan(new.household_id, private.household_today(new.household_id),
                         array(select a.chore_id from public.chore_assignee a where a.member_id = new.id));
  return null;
end $$;
create trigger trg_member_replan after update of archived_at on public.member
  for each row when (old.archived_at is distinct from new.archived_at)
  execute function private.replan_member();

-- The school year changed (a year, a closure, who follows which year): from tomorrow, so today stays
-- as it was planned (D-24).
create function private.replan_school() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := coalesce(new.household_id, old.household_id);
begin
  if exists (select from public.household where id = v_household) then
    perform private.replan(v_household, private.household_today(v_household) + 1);
  end if;
  return null;
end $$;
create trigger trg_school_year_replan after insert or update or delete on public.school_year
  for each row execute function private.replan_school();
create trigger trg_school_closure_replan after insert or update or delete on public.school_closure
  for each row execute function private.replan_school();
create trigger trg_member_school_profile_replan after insert or update or delete on public.member_school_profile
  for each row execute function private.replan_school();

-- The approval switch re-resolves occurrences nothing has happened to (D-22); check-offs already
-- waiting for a parent stay in the queue.
create function private.reresolve_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chore_occurrence o
     set requires_approval_snapshot = private.chore_requires_approval(o.chore_id)
   where o.household_id = new.household_id and o.status = 'scheduled' and o.status_event_id is null;
  return null;
end $$;
create trigger trg_household_settings_approval after update of approval_mode on public.household_settings
  for each row when (old.approval_mode is distinct from new.approval_mode)
  execute function private.reresolve_approval();

revoke all on function private.local_date(text, timestamptz), private.household_today(uuid),
                       private.schedule_matches(jsonb, date, date), private.chore_due_on(uuid, date),
                       private.chore_requires_approval(uuid), private.generate_occurrences(uuid, date, date, uuid[]),
                       private.replan(uuid, date, uuid[]), private.replan_chore(), private.replan_assignees(),
                       private.replan_member(), private.replan_school(), private.reresolve_approval()
  from public, anon, authenticated;
grant execute on function private.local_date(text, timestamptz), private.household_today(uuid),
                          private.schedule_matches(jsonb, date, date)
  to authenticated, service_role;
revoke all on function public.generate_household_occurrences(uuid) from public, anon, authenticated;
grant execute on function public.generate_household_occurrences(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Per-member view (D-30): every assignee, plus anyone credited who was not assigned. Someone else's
-- check-off is `covered` for an assignee: neutral, like skipped. Security invoker, so it follows the
-- occurrence's visibility.
-- ---------------------------------------------------------------------------

create view public.v_member_occurrence with (security_invoker = true) as
select o.id as occurrence_id, o.household_id, o.chore_id, o.kind, o.due_date, o.due_time,
       m.member_id,
       m.member_id = any (o.done_by)  as credited,
       m.member_id = any (o.rewarded) as rewarded,
       case when cardinality(o.done_by) > 0 and not m.member_id = any (o.done_by) then 'covered'
            else o.status end         as member_status,
       o.points_snapshot, o.finalized_at
  from public.chore_occurrence o
 cross join lateral (
   select a.member_id from public.chore_occurrence_assignee a where a.occurrence_id = o.id
   union
   select unnest(o.done_by)
 ) m (member_id);

-- ---------------------------------------------------------------------------
-- Row level security: read-only for admins and the board, following the item's visibility (D-34).
-- Occurrences are written by the generator and, from WP-10, by completion events; never directly.
-- Derived rows are not audited (the edits and events that cause them are).
-- ---------------------------------------------------------------------------

alter table public.chore_occurrence          enable row level security;
alter table public.chore_occurrence_assignee enable row level security;

create policy chore_occurrence_admin_select on public.chore_occurrence for select to authenticated
  using (household_id in (select private.admin_household_ids()) and private.can_see_chore(chore_id));
create policy chore_occurrence_device_select on public.chore_occurrence for select to authenticated
  using (household_id = (select private.device_household_id()) and private.can_see_chore(chore_id));
-- An occurrence's visibility is its item's.
create function private.can_see_occurrence(p_occurrence uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_see_chore((select o.chore_id from public.chore_occurrence o where o.id = p_occurrence))
$$;
revoke all on function private.can_see_occurrence(uuid) from public, anon;
grant execute on function private.can_see_occurrence(uuid) to authenticated, service_role;

create policy chore_occurrence_assignee_admin_select on public.chore_occurrence_assignee for select to authenticated
  using (household_id in (select private.admin_household_ids()) and private.can_see_occurrence(occurrence_id));
create policy chore_occurrence_assignee_device_select on public.chore_occurrence_assignee for select to authenticated
  using (household_id = (select private.device_household_id()) and private.can_see_occurrence(occurrence_id));

revoke insert, update, delete on public.chore_occurrence, public.chore_occurrence_assignee from anon, authenticated;

-- Items saved before the generator existed (WP-08): plan today and the next 14 days once.
do $$
declare
  h record;
begin
  for h in select id from public.household loop
    perform private.generate_occurrences(h.id, private.household_today(h.id), private.household_today(h.id) + 14);
  end loop;
end $$;
