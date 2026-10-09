-- [CHR-09][CHR-18] Everyone does their own (WP-43, D-47). An item with several people is either:
-- - shared ("any one of them"): one occurrence per due date, done once by whoever gets to it and
--   covered for the rest (D-30); or
-- - each ("everyone does their own"): one occurrence per person per due date, so each bed is its
--   own check-off, its own points and its own miss, and each person's own day type decides their day.
-- Events, the fold, day close and the drift check work per occurrence, so they are unchanged.
-- Existing items stay shared until someone changes them. The item form starts a new chore as each
-- and a new task as shared, and always says which; save_chore() given no mode keeps an item's mode
-- (shared for a new one), so the app already in production behaves as before while this waits for
-- approval on a preview (D-37).

alter table public.chore
  add column assignment text not null default 'shared' check (assignment in ('shared', 'each'));

-- The person an "each" occurrence belongs to; null for a shared one.
alter table public.chore_occurrence add column member_id uuid;
alter table public.chore_occurrence
  add constraint chore_occurrence_member_fkey foreign key (household_id, member_id)
    references public.member (household_id, id) on delete cascade;
alter table public.chore_occurrence drop constraint chore_occurrence_chore_id_due_date_key;
alter table public.chore_occurrence
  add constraint chore_occurrence_chore_id_due_date_member_id_key unique nulls not distinct (chore_id, due_date, member_id);

-- ---------------------------------------------------------------------------
-- When an occurrence is due
-- ---------------------------------------------------------------------------

-- [CHR-18] Whether an item has an occurrence for this person (or, with no person, the shared one) on
-- a date. Shared: its schedule and dates, and any active assignee's day type (chore_due_on). Each: its
-- schedule and dates, and this person's own day type, while they are an active assignee.
create function private.occurrence_due(p_chore uuid, p_member uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_member is null then
      exists (select from public.chore c where c.id = p_chore and c.assignment = 'shared')
      and private.chore_due_on(p_chore, p_date)
    else exists (
      select from public.chore c
        join public.chore_assignee a on a.chore_id = c.id and a.member_id = p_member
        join public.member m on m.id = p_member and m.archived_at is null
       where c.id = p_chore and c.assignment = 'each' and c.archived_at is null
         and private.schedule_matches(c.schedule, c.start_date, p_date)
         and (c.schedule ->> 'freq' = 'once' or p_date >= c.start_date)
         and (c.end_date is null or p_date <= c.end_date)
         and public.resolve_day_type(p_member, p_date) = any (c.day_types))
  end
$$;

-- ---------------------------------------------------------------------------
-- Generation and re-planning (as in WP-09, now per mode)
-- ---------------------------------------------------------------------------

-- [CHR-03][CHR-18] Adds the missing occurrences from p_from to p_to: one per date for a shared item,
-- one per date and person for an "each" item, plus late one-off tasks (D-31). A date that still has an
-- occurrence of the other mode (someone acted on it before the mode changed) is left as it is, so a
-- day is never counted twice.
create or replace function private.generate_occurrences(
  p_household uuid, p_from date, p_to date, p_chores uuid[] default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
begin
  with people as (
    -- Who each item's occurrences are for: nobody in particular (shared) or each active assignee.
    select c.id as chore_id, null::uuid as member_id
      from public.chore c
     where c.household_id = p_household and c.archived_at is null and c.assignment = 'shared'
       and (p_chores is null or c.id = any (p_chores))
    union all
    select c.id, a.member_id
      from public.chore c
      join public.chore_assignee a on a.chore_id = c.id
      join public.member m on m.id = a.member_id and m.archived_at is null
     where c.household_id = p_household and c.archived_at is null and c.assignment = 'each'
       and (p_chores is null or c.id = any (p_chores))
  ),
  wanted as (
    select p.chore_id, d::date as due_date, p.member_id
      from people p
     cross join generate_series(p_from, p_to, interval '1 day') d
     where private.occurrence_due(p.chore_id, p.member_id, d::date)
    union
    select p.chore_id, (c.schedule ->> 'on_date')::date, p.member_id
      from people p
      join public.chore c on c.id = p.chore_id
     where c.kind = 'task' and c.schedule ->> 'freq' = 'once' and (c.schedule ->> 'on_date')::date < p_from
       and private.occurrence_due(p.chore_id, p.member_id, (c.schedule ->> 'on_date')::date)
  ),
  added as (
    insert into public.chore_occurrence (household_id, chore_id, due_date, member_id, due_time, kind,
                                         points_snapshot, requires_approval_snapshot)
    select p_household, c.id, w.due_date, w.member_id, c.due_time, c.kind, c.points,
           private.chore_requires_approval(c.id)
      from wanted w
      join public.chore c on c.id = w.chore_id
     where not exists (select from public.chore_occurrence o
                        where o.chore_id = w.chore_id and o.due_date = w.due_date
                          and (o.member_id is null) <> (w.member_id is null))
    on conflict (chore_id, due_date, member_id) do nothing
    returning id, chore_id, due_date, member_id
  ),
  snapshot as (
    insert into public.chore_occurrence_assignee (household_id, occurrence_id, member_id, due_date, day_type)
    select p_household, ad.id, a.member_id, ad.due_date, public.resolve_day_type(a.member_id, ad.due_date)
      from added ad
      join public.chore_assignee a on a.chore_id = ad.chore_id and (ad.member_id is null or a.member_id = ad.member_id)
      join public.member m on m.id = a.member_id and m.archived_at is null
    returning 1
  )
  -- The snapshot insert runs with this statement whether or not its rows are read.
  select count(*) into v_added from added;
  return v_added;
end $$;

-- [CHR-03][CHR-18] Re-plans after a change, as in WP-09 (D-24, D-45), with the mode: today's
-- untouched occurrence goes if it is no longer due for its person (or the item changed mode), and a
-- shared one's snapshot follows the item's assignees; an "each" occurrence's person never changes.
create or replace function private.replan(p_household uuid, p_from date, p_chores uuid[] default null)
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
          or (o.due_date = v_today and p_from <= v_today and not private.occurrence_due(o.chore_id, o.member_id, v_today))
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
       and o.member_id is null and o.status = 'scheduled' and o.status_event_id is null
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
       and o.member_id is null and o.status = 'scheduled' and o.status_event_id is null
       and (p_chores is null or o.chore_id = any (p_chores))
    on conflict do nothing;
  end if;
  return private.generate_occurrences(p_household, greatest(p_from, v_today), v_today + 14, p_chores);
end $$;

-- An item's own edit now includes its mode.
drop trigger trg_chore_replan on public.chore;
create trigger trg_chore_replan after insert or update of schedule, day_types, due_time, points, approval,
  kind, start_date, end_date, archived_at, assignment on public.chore
  for each row execute function private.replan_chore();

revoke all on function private.occurrence_due(uuid, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saving an item (WP-08) takes its mode; without one, a new item is shared and an edit keeps it
-- ---------------------------------------------------------------------------

create or replace function public.save_chore(
  p_household_id uuid,
  p_id           uuid,
  p_item         jsonb,
  p_assignees    uuid[],
  p_tags         uuid[] default '{}'
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  v_assignees uuid[];
  v_tags      uuid[];
begin
  select coalesce(array_agg(m.id), '{}') into v_assignees
    from public.member m
   where m.id = any (coalesce(p_assignees, '{}')) and m.household_id = p_household_id and m.archived_at is null;
  if cardinality(v_assignees) = 0 then
    raise exception 'choose who it is for' using errcode = '23514', hint = 'chore_needs_assignee';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_tags
    from public.tag t
   where t.id = any (coalesce(p_tags, '{}')) and t.household_id = p_household_id and t.archived_at is null;

  if p_id is null then
    insert into public.chore (id, household_id, title, description, icon, kind, points, approval,
                              schedule, due_time, day_types, visibility, start_date, end_date, assignment)
    values (v_id, p_household_id, p_item ->> 'title', p_item ->> 'description',
            coalesce(p_item ->> 'icon', 'list-check'), coalesce(p_item ->> 'kind', 'chore'),
            coalesce((p_item ->> 'points')::int, 0), coalesce(p_item ->> 'approval', 'inherit'),
            p_item -> 'schedule', (p_item ->> 'due_time')::time,
            coalesce((select array_agg(d) from jsonb_array_elements_text(p_item -> 'day_types') d),
                     array['school_day', 'no_school', 'break', 'weekend', 'summer']),
            coalesce(p_item ->> 'visibility', 'family'),
            (p_item ->> 'start_date')::date, (p_item ->> 'end_date')::date,
            coalesce(p_item ->> 'assignment', 'shared'));
  else
    update public.chore
       set title       = p_item ->> 'title',
           description = case when p_item ? 'description' then p_item ->> 'description' else description end,
           icon        = coalesce(p_item ->> 'icon', icon),
           kind        = coalesce(p_item ->> 'kind', kind),
           points      = coalesce((p_item ->> 'points')::int, points),
           approval    = coalesce(p_item ->> 'approval', approval),
           schedule    = coalesce(p_item -> 'schedule', schedule),
           due_time    = case when p_item ? 'due_time' then (p_item ->> 'due_time')::time else due_time end,
           day_types   = coalesce((select array_agg(d) from jsonb_array_elements_text(p_item -> 'day_types') d), day_types),
           visibility  = coalesce(p_item ->> 'visibility', visibility),
           end_date    = case when p_item ? 'end_date' then (p_item ->> 'end_date')::date else end_date end,
           assignment  = coalesce(p_item ->> 'assignment', assignment)
     where id = p_id and household_id = p_household_id;
    if not found then
      raise exception 'that item was not found' using errcode = 'P0002', hint = 'chore_not_found';
    end if;
  end if;

  delete from public.chore_assignee where chore_id = v_id and member_id <> all (v_assignees);
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select p_household_id, v_id, unnest(v_assignees)
  on conflict do nothing;

  delete from public.chore_tag ct
   using public.tag t
   where ct.chore_id = v_id and t.id = ct.tag_id and t.archived_at is null and ct.tag_id <> all (v_tags);
  insert into public.chore_tag (household_id, chore_id, tag_id)
  select p_household_id, v_id, unnest(v_tags)
  on conflict do nothing;

  return v_id;
end $$;
