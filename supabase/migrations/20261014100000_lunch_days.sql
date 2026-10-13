-- [CHR-19][US-321] Chores on lunch days (WP-61, D-86). An item everyone does on their own can follow
-- each child's school lunch: only on days they bring lunch ("Pack lunch", "Empty lunch box"), or only
-- on days they buy it. A child's lunch on a date is public.lunch_mode (WP-26): the day's change, else
-- their usual for the weekday; none on a day that isn't a school day for them, and none for an adult,
-- so a lunch-day item never comes up for an adult or on a weekend, break or day off.
--
-- Changing a child's lunch (their usual week or one day) re-plans their lunch-day items at once: from
-- today when today's lunch changed (today's item comes or goes; one already checked off stays), else
-- from tomorrow.

alter table public.chore
  add column lunch_days text check (lunch_days in ('bring', 'buy'));
-- Each person has their own lunch, so only an item everyone does on their own can follow it.
alter table public.chore
  add constraint chore_lunch_days_each check (lunch_days is null or assignment = 'each');

-- [CHR-18][CHR-19] As in WP-43, and for a lunch-day item, this person's lunch on the date.
create or replace function private.occurrence_due(p_chore uuid, p_member uuid, p_date date) returns boolean
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
         and public.resolve_day_type(p_member, p_date) = any (c.day_types)
         and (c.lunch_days is null or public.lunch_mode(p_member, p_date) = c.lunch_days))
  end
$$;
revoke all on function private.occurrence_due(uuid, uuid, date) from public, anon, authenticated;

-- An item's own edit now includes its lunch days.
drop trigger trg_chore_replan on public.chore;
create trigger trg_chore_replan after insert or update of schedule, day_types, due_time, points, approval,
  kind, start_date, end_date, archived_at, assignment, lunch_days on public.chore
  for each row execute function private.replan_chore();

-- ---------------------------------------------------------------------------
-- A child's lunch changed: re-plan their lunch-day items
-- ---------------------------------------------------------------------------

-- [CHR-19] Re-plans the lunch-day items a child is on, from p_date: today's included when p_date is
-- today, nothing for a date already past.
create function private.replan_lunch_days(p_member uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_today     date;
  v_chores    uuid[];
begin
  select household_id into v_household from public.member where id = p_member;
  if v_household is null then
    return;
  end if;
  v_today := private.household_today(v_household);
  if v_today is null or p_date < v_today then
    return;
  end if;
  select array_agg(c.id) into v_chores
    from public.chore c
    join public.chore_assignee a on a.chore_id = c.id and a.member_id = p_member
   where c.household_id = v_household and c.lunch_days is not null and c.archived_at is null;
  if v_chores is null then
    return;
  end if;
  -- replan() takes back every untouched future occurrence of these items and adds what is due from
  -- its p_from: today, or tomorrow so today's stays as it is.
  perform private.replan(v_household, case when p_date = v_today then v_today else v_today + 1 end, v_chores);
end $$;
revoke all on function private.replan_lunch_days(uuid, date) from public, anon, authenticated;

create function private.lunch_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_table_name = 'lunch_override' then
    perform private.replan_lunch_days(v_row.member_id, v_row.lunch_date);
    if tg_op = 'UPDATE' and old.lunch_date <> new.lunch_date then
      perform private.replan_lunch_days(old.member_id, old.lunch_date);
    end if;
  else
    -- A new usual week can change today's lunch too.
    perform private.replan_lunch_days(v_row.member_id,
      private.household_today((select household_id from public.member where id = v_row.member_id)));
  end if;
  return null;
end $$;
revoke all on function private.lunch_changed() from public, anon, authenticated;

create trigger trg_lunch_override_replan after insert or update or delete on public.lunch_override
  for each row execute function private.lunch_changed();
create trigger trg_member_lunch_replan after insert or update of defaults or delete on public.member_lunch
  for each row execute function private.lunch_changed();

-- ---------------------------------------------------------------------------
-- Saving an item takes its lunch days (as WP-43's save_chore, plus lunch_days). A shared item with
-- lunch days is refused by chore_lunch_days_each.
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
                              schedule, due_time, day_types, visibility, start_date, end_date, assignment,
                              lunch_days)
    values (v_id, p_household_id, p_item ->> 'title', p_item ->> 'description',
            coalesce(p_item ->> 'icon', 'list-check'), coalesce(p_item ->> 'kind', 'chore'),
            coalesce((p_item ->> 'points')::int, 0), coalesce(p_item ->> 'approval', 'inherit'),
            p_item -> 'schedule', (p_item ->> 'due_time')::time,
            coalesce((select array_agg(d) from jsonb_array_elements_text(p_item -> 'day_types') d),
                     array['school_day', 'no_school', 'break', 'weekend', 'summer']),
            coalesce(p_item ->> 'visibility', 'family'),
            (p_item ->> 'start_date')::date, (p_item ->> 'end_date')::date,
            coalesce(p_item ->> 'assignment', 'shared'),
            p_item ->> 'lunch_days');
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
           assignment  = coalesce(p_item ->> 'assignment', assignment),
           lunch_days  = case when p_item ? 'lunch_days' then p_item ->> 'lunch_days' else lunch_days end
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
