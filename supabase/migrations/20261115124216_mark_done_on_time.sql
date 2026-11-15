-- [CHR-24] A parent marks a missed or late chore done on time (WP-117, D-151). A parent's Mark done on
-- time is an `admin_complete` event that says so: `marked_on_time`, and `on_time_at` when the parent
-- gives the time it was done (null: "On time", by its due time). It folds as any parent's completion
-- (approved, credited to whoever did it, its points earned once); a goal done by a time reads the
-- given time as the tick's time, and "On time" as never late. The event keeps who marked it and when,
-- for "Marked on time by Alex, Nov 13", and later items (penalties, WP-121) read the same flag on the
-- occurrence's status event. Only an admin (or the database itself) can mark one; never a board.

alter table public.chore_completion_event
  add column marked_on_time boolean not null default false,
  add column on_time_at     timestamptz,
  add constraint chore_completion_event_on_time_check
    check ((marked_on_time and event_type = 'admin_complete') or (not marked_on_time and on_time_at is null));

comment on column public.chore_completion_event.marked_on_time is
  '[CHR-24] A parent''s Mark done on time (WP-117, D-151): counts as done by its time for every goal.';
comment on column public.chore_completion_event.on_time_at is
  '[CHR-24] The time it was done, as the parent gave it; null for "On time" (by its due time).';

-- [NFR-06][D-20][D-21][D-32][CHR-24] As WP-10 built it, and: a Mark done on time is a parent's (or the
-- system's) admin_complete on a chore (a routine), on or after its day; a time given falls on its due
-- date, by its due time, and not after now. "On time" on today's chore waits until its due time has
-- passed: before then it is an ordinary Mark done.
create or replace function private.normalize_completion_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o        record;
  v_uid    uuid := auth.uid();
  v_device uuid;
begin
  if new.occurrence_id is null then
    raise exception 'say which occurrence' using errcode = '23502', hint = 'occurrence_required';
  end if;
  select occ.household_id, occ.due_date, occ.due_time, occ.kind, occ.done_by as current_done_by, h.timezone,
         coalesce(s.undo_window_seconds, 120) as undo_window
    into o
    from public.chore_occurrence occ
    join public.household h on h.id = occ.household_id
    left join public.household_settings s on s.household_id = occ.household_id
   where occ.id = new.occurrence_id
     for update of occ;
  if not found then
    -- A parent's edit removed it after the board queued this (D-45).
    raise exception 'occurrence not found' using errcode = 'P0002', hint = 'occurrence_gone';
  end if;
  new.household_id := o.household_id;

  select d.id into v_device from public.device d
   where d.auth_user_id = v_uid and d.status = 'active' and d.household_id = o.household_id;
  if v_device is not null then
    new.actor_type := 'device';
    new.actor_id := v_device;
  elsif v_uid is not null and exists (select from public.household_user hu
                                       where hu.household_id = o.household_id and hu.user_id = v_uid) then
    new.actor_type := 'admin';
    new.actor_id := v_uid;
  elsif v_uid is null then
    new.actor_type := 'system';  -- the database itself (seed, jobs); never a signed-in caller
    new.actor_id := null;
  else
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;

  new.recorded_at := now();
  new.occurred_at := least(coalesce(new.occurred_at, new.recorded_at), new.recorded_at);

  if new.actor_type = 'device' then
    if new.event_type not in ('complete', 'undo') or coalesce(new.marked_on_time, false) then
      raise exception 'a board can only check off and undo' using errcode = '42501', hint = 'not_allowed';
    end if;
    new.batch_id := null;
    if new.event_type = 'undo' and not exists (
         select from public.chore_completion_event e
          where e.occurrence_id = new.occurrence_id and e.event_type = 'complete'
            and e.occurred_at between new.occurred_at - make_interval(secs => o.undo_window) and new.occurred_at) then
      raise exception 'too late to undo on the board' using errcode = '42501', hint = 'undo_window_passed';
    end if;
  end if;

  -- [CHR-24] Mark done on time.
  new.marked_on_time := coalesce(new.marked_on_time, false);
  if new.marked_on_time then
    if new.event_type <> 'admin_complete' then
      raise exception 'only a parent''s Mark done can be on time' using errcode = '23514', hint = 'on_time_not_done';
    end if;
    if o.kind <> 'chore' then
      raise exception 'only a chore can be marked done on time' using errcode = '23514', hint = 'on_time_chore_only';
    end if;
    if new.on_time_at is not null then
      if private.local_date(o.timezone, new.on_time_at) <> o.due_date
         or new.on_time_at > new.recorded_at
         or (o.due_time is not null
             and (new.on_time_at at time zone o.timezone)::time > o.due_time) then
        raise exception 'the time must be on its day, by its due time, and not later than now'
          using errcode = '23514', hint = 'on_time_bad_time';
      end if;
    elsif (o.due_date + coalesce(o.due_time, time '00:00')) at time zone o.timezone > new.recorded_at then
      -- Its day (or its due time today) hasn't come yet: nothing can be late.
      raise exception 'not due yet' using errcode = '23514', hint = 'on_time_not_due';
    end if;
  else
    new.on_time_at := null;
  end if;

  if new.event_type = 'approve' and cardinality(new.done_by) = 0 then
    new.done_by := o.current_done_by;
  elsif new.event_type not in ('complete', 'approve', 'admin_complete') then
    new.done_by := '{}';
  end if;
  new.done_by := array(select distinct d from unnest(new.done_by) d order by d);
  if new.event_type in ('complete', 'approve', 'admin_complete') and cardinality(new.done_by) = 0 then
    raise exception 'say who did it' using errcode = '23514', hint = 'done_by_required';
  end if;
  if exists (select from unnest(new.done_by) d (id)
              where not exists (select from public.member m where m.id = d.id and m.household_id = o.household_id)) then
    raise exception 'done_by must name members of this household' using errcode = '23514', hint = 'done_by_not_member';
  end if;
  new.rewarded := array(select m.id from public.member m
                         where m.id = any (new.done_by) and m.earns_rewards order by m.id);

  new.credit_date := case when o.kind = 'chore' then o.due_date
                          else private.local_date(o.timezone, new.occurred_at) end;
  new.review_status := case when new.actor_type = 'device' and o.kind = 'chore'
                                 and private.local_date(o.timezone, new.occurred_at) <> o.due_date
                            then 'flagged' else 'accepted' end;
  return new;
end $$;

-- [CHR-24] record_completions (WP-10's) passes `marked_on_time` and `on_time_at` through. The rest is
-- as before.
create or replace function public.record_completions(p_events jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  e        jsonb;
  v_out    jsonb := '[]';
  v_result text;
  v_reason text;
  v_state  text;
  v_occ    uuid;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 100 then
    raise exception 'events must be a list of at most 100' using errcode = '22023', hint = 'bad_batch';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    v_reason := null;
    v_occ := null;
    begin
      v_occ := (e ->> 'occurrence_id')::uuid;
      insert into public.chore_completion_event
        (id, occurrence_id, event_type, done_by, occurred_at, batch_id, note, marked_on_time, on_time_at)
      values ((e ->> 'id')::uuid, v_occ, e ->> 'event_type',
              coalesce((select array_agg(d::uuid) from jsonb_array_elements_text(e -> 'done_by') d), '{}'),
              (e ->> 'occurred_at')::timestamptz, (e ->> 'batch_id')::uuid, e ->> 'note',
              coalesce((e ->> 'marked_on_time')::boolean, false), (e ->> 'on_time_at')::timestamptz)
      on conflict (id) do nothing;
      v_result := case when found then 'recorded' else 'duplicate' end;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_reason = pg_exception_hint;
      v_result := case
        when v_reason = 'occurrence_gone' then 'gone'
        when v_state = '42501' then 'refused'
        when v_state in ('23514', '23502', '22P02', '22007', '22008', '23503') then 'invalid'
      end;
      if v_result is null then
        raise;
      end if;
      v_reason := coalesce(nullif(v_reason, ''), case v_state when '42501' then 'not_allowed' else 'invalid' end);
    end;
    v_out := v_out || jsonb_build_object(
      'id', e ->> 'id',
      'result', v_result,
      'reason', v_reason,
      'occurrence', (select jsonb_build_object('id', o.id, 'status', o.status, 'done_by', o.done_by,
                                               'rewarded', o.rewarded, 'status_changed_at', o.status_changed_at)
                       from public.chore_occurrence o where o.id = v_occ));
  end loop;
  return v_out;
end $$;

-- [CHR-24] Marking a chore ticked late on time leaves its status (approved) and who did it as they
-- were, so the occurrence's own trigger doesn't mark its goals: this does, for the goals it may count
-- for, as private.mark_goals_dirty_for_occurrence() picks them.
create function private.mark_goals_dirty_on_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reward_goal_progress p
     set dirty = true, marked_at = clock_timestamp()
    from public.reward_goal g, public.chore_occurrence o
   where o.id = new.occurrence_id
     and p.goal_id = g.id
     and g.household_id = o.household_id
     and g.status in ('scheduled', 'active', 'achieved', 'expired', 'redeemed')
     and (g.member_id is null
          or g.member_id = any (o.done_by)
          or exists (select from public.chore_occurrence_assignee a
                      where a.occurrence_id = o.id and a.member_id = g.member_id))
     and o.due_date >= g.start_date and (g.end_date is null or o.due_date <= g.end_date);
  return null;
end $$;
create trigger trg_cce_on_time_goals_dirty after insert on public.chore_completion_event
  for each row when (new.marked_on_time) execute function private.mark_goals_dirty_on_time();

-- [RWD-17][CHR-24] goal_facts_between (WP-81's) reads a Mark done on time's own time: the time the
-- parent gave, or none ("On time", so never late). The rest is as before.
create or replace function private.goal_facts_between(p_household uuid, p_member uuid, p_start date, p_to date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.occurrence_id,
             'chore_id', v.chore_id,
             'member_id', v.member_id,
             'kind', v.kind,
             'tag_ids', coalesce((select jsonb_agg(t.tag_id order by t.tag_id)
                                    from public.chore_tag t where t.chore_id = v.chore_id), '[]'::jsonb),
             'due_date', v.due_date,
             'credit_date', case when v.kind = 'chore' then v.due_date
                                 when o.status in ('completed', 'approved', 'pending_approval')
                                   then e.credit_date end,
             'status', v.member_status,
             'credited', v.credited,
             'points', v.points_snapshot,
             'due_time', to_char(o.due_time, 'HH24:MI'),
             'done_at', case when o.status in ('completed', 'approved', 'pending_approval') then (
                          select to_char(case when c.marked_on_time then c.on_time_at else c.occurred_at end
                                           at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI')
                            from public.chore_completion_event c
                           where c.occurrence_id = o.id and c.event_type in ('complete', 'admin_complete')
                             and (c.occurred_at, c.recorded_at) <= (e.occurred_at, e.recorded_at)
                           order by c.occurred_at desc, c.recorded_at desc, c.id desc
                           limit 1) end)
           order by v.due_date, v.occurrence_id, v.member_id)
      from public.v_member_occurrence v
      join public.chore_occurrence o on o.id = v.occurrence_id
      join public.household h on h.id = v.household_id
      left join public.chore_completion_event e on e.id = o.status_event_id
     where v.household_id = p_household
       and (p_member is null or v.member_id = p_member)
       and p_to >= p_start
       and ((v.due_date between p_start and p_to)
            or (e.credit_date between p_start and p_to))), '[]'::jsonb)
$$;

-- [CHR-24] How each of these occurrences was checked off, as the caller may see them (RLS): the
-- check-off its status stands on (the latest board tick or parent's Mark done up to its status event),
-- its time on the household's clock ('YYYY-MM-DDTHH:MM'), and for a Mark done on time, the time given
-- ('HH:MM', or null for "On time"), who marked it (their member name, else null) and on which day.
-- Only for an occurrence that is done or waiting; nothing for the rest.
create function public.check_offs(p_occurrences uuid[])
returns table (
  occurrence_id  uuid,
  checked_at     text,
  marked_on_time boolean,
  on_time_at     text,
  marked_by      text,
  marked_on      date)
language sql stable security invoker set search_path = '' as $$
  select o.id,
         to_char(c.occurred_at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI'),
         c.marked_on_time,
         to_char(c.on_time_at at time zone h.timezone, 'HH24:MI'),
         case when c.marked_on_time then (
           select m.display_name from public.member m
            where m.household_id = o.household_id and m.user_id = c.actor_id
            order by m.archived_at nulls first limit 1) end,
         case when c.marked_on_time then private.local_date(h.timezone, c.recorded_at) end
    from public.chore_occurrence o
    join public.household h on h.id = o.household_id
    join public.chore_completion_event e on e.id = o.status_event_id
    cross join lateral (
      select ev.occurred_at, ev.recorded_at, ev.marked_on_time, ev.on_time_at, ev.actor_id
        from public.chore_completion_event ev
       where ev.occurrence_id = o.id and ev.event_type in ('complete', 'admin_complete')
         and (ev.occurred_at, ev.recorded_at) <= (e.occurred_at, e.recorded_at)
       order by ev.occurred_at desc, ev.recorded_at desc, ev.id desc
       limit 1) c
   where o.id = any (p_occurrences)
     and o.status in ('completed', 'approved', 'pending_approval')
$$;

revoke all on function private.mark_goals_dirty_on_time() from public, anon, authenticated;
revoke all on function public.check_offs(uuid[]) from public, anon;
grant execute on function public.check_offs(uuid[]) to authenticated, service_role;
