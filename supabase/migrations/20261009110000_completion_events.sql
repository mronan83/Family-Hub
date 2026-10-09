-- [CHR-04][CHR-07][CHR-09][CHR-12][NFR-06] Completion events (WP-10, 02 §4.1–4.2, D-20..D-23, D-30..D-32,
-- D-46): every check-off, undo, approval, rejection, skip and parent correction is an append-only event;
-- an occurrence's status is folded from its events by event time and kept on the occurrence. Day close
-- finalizes past routines (missed when not done); tasks carry over. A nightly check re-folds the last
-- 14 days and reports any drift between the events and the stored status.

-- ---------------------------------------------------------------------------
-- The event log
-- ---------------------------------------------------------------------------

create table public.chore_completion_event (
  id            uuid primary key,                 -- made by the caller: the idempotency key
  household_id  uuid not null,                    -- from the occurrence, never the caller
  occurrence_id uuid not null,
  event_type    text not null check (event_type in
                  ('complete', 'undo', 'approve', 'reject', 'admin_complete', 'admin_uncomplete', 'skip')),
  done_by       uuid[] not null default '{}',     -- who did it (D-30); on complete, approve, admin_complete
  rewarded      uuid[] not null default '{}',     -- those of them who earn rewards, fixed on insert (D-32)
  actor_type    text not null check (actor_type in ('device', 'admin', 'system')),
  actor_id      uuid,                             -- the board's device id, or the admin's user id
  occurred_at   timestamptz not null,             -- when it happened, clamped to when it was received
  recorded_at   timestamptz not null default now(),
  credit_date   date not null,                    -- routine: its due date; task: the day it was done
  review_status text not null default 'accepted' check (review_status in ('accepted', 'flagged')),
  batch_id      uuid,                             -- groups a parent's bulk uncheck (CHR-08)
  note          text check (char_length(note) <= 500),
  check ((event_type in ('complete', 'approve', 'admin_complete')) = (cardinality(done_by) > 0)),
  foreign key (household_id, occurrence_id) references public.chore_occurrence (household_id, id)
    on delete cascade
);
create index on public.chore_completion_event (household_id, credit_date);
create index on public.chore_completion_event using gin (done_by);
create index on public.chore_completion_event (occurrence_id, occurred_at desc, recorded_at desc, id desc);
create index on public.chore_completion_event (batch_id) where batch_id is not null;

-- [NFR-06][D-20][D-21][D-32] Never trust the caller. Before an event is stored:
-- - its household and credit date come from the occurrence, and who recorded it from the session
--   (a board, an admin of that household, or the system);
-- - occurred_at is clamped to when it was received, so a fast clock cannot win later conflicts;
-- - a board may only check off and undo, and undo only a check-off made within the household's undo
--   window (US-305); a parent can correct anything;
-- - done_by must name members of the household; an approval credits whoever the check-off credited;
--   rewarded is fixed from each one's earns-rewards switch now, so changing it later rewrites nothing;
-- - a board's check-off of a routine on another day than its due date is flagged for a parent.
-- The occurrence row is locked, so events on one occurrence are recorded one at a time and each
-- fold sees every earlier one.
create function private.normalize_completion_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o        record;
  v_uid    uuid := auth.uid();
  v_device uuid;
begin
  if new.occurrence_id is null then
    raise exception 'say which occurrence' using errcode = '23502', hint = 'occurrence_required';
  end if;
  select occ.household_id, occ.due_date, occ.kind, occ.done_by as current_done_by, h.timezone,
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
    if new.event_type not in ('complete', 'undo') then
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
create trigger trg_cce_normalize before insert on public.chore_completion_event
  for each row execute function private.normalize_completion_event();

-- Append-only: never updated, and deleted only with the household that owns it (its export and
-- delete, or the demo family's reset).
create function private.prevent_event_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' or exists (select from public.household where id = old.household_id) then
    raise exception 'completion events are append-only' using errcode = '42501', hint = 'append_only';
  end if;
  return old;
end $$;
create trigger trg_cce_immutable before update or delete on public.chore_completion_event
  for each row execute function private.prevent_event_change();

-- ---------------------------------------------------------------------------
-- The status projection (02 §4.2): events are the truth, status is kept on the occurrence
-- ---------------------------------------------------------------------------

create type private.folded_status as (status text, event_id uuid, done_by uuid[], rewarded uuid[]);

-- [CHR-07][D-20][D-23][D-32] The one place an occurrence's status is worked out: the latest event by
-- event time wins (ties: recorded_at, then id). A check-off needs a parent when someone credited earns
-- rewards and the item needs approval, or when it was flagged. Reject, undo and a parent's uncheck
-- reopen it, and once its day is closed a reopened routine is missed.
create function private.fold_occurrence_status(p_occ uuid) returns private.folded_status
language sql stable security definer set search_path = '' as $$
  select row(
           case
             when e.event_type is null then
               case when o.finalized_at is not null then 'missed' else 'scheduled' end
             when e.event_type = 'complete' then
               case when (o.requires_approval_snapshot and cardinality(e.rewarded) > 0)
                         or e.review_status = 'flagged'
                    then 'pending_approval' else 'completed' end
             when e.event_type in ('approve', 'admin_complete') then 'approved'
             when e.event_type = 'skip' then 'skipped'
             when o.finalized_at is not null then 'missed'
             when e.event_type = 'reject' then 'rejected'
             else 'scheduled'
           end,
           e.id,
           case when e.event_type in ('complete', 'approve', 'admin_complete') then e.done_by else '{}'::uuid[] end,
           case when e.event_type in ('complete', 'approve', 'admin_complete') then e.rewarded else '{}'::uuid[] end
         )::private.folded_status
    from public.chore_occurrence o
    left join lateral (
      select ev.id, ev.event_type, ev.review_status, ev.done_by, ev.rewarded
        from public.chore_completion_event ev
       where ev.occurrence_id = o.id
       order by ev.occurred_at desc, ev.recorded_at desc, ev.id desc
       limit 1
    ) e on true
   where o.id = p_occ
$$;

-- Keeps the status current in the same transaction as each event. status_event_id is the event the
-- status was folded from, which is not the new one when the new one happened earlier.
create function private.apply_completion_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chore_occurrence o
     set status            = f.status,
         done_by           = f.done_by,
         rewarded          = f.rewarded,
         status_event_id   = f.event_id,
         status_changed_at = case when o.status is distinct from f.status then now() else o.status_changed_at end
    from private.fold_occurrence_status(new.occurrence_id) f
   where o.id = new.occurrence_id;
  return null;
end $$;
create trigger trg_cce_apply after insert on public.chore_completion_event
  for each row execute function private.apply_completion_event();

-- [CHR-07][CHR-12][D-23][D-31] Day close: once a household's local day has ended, its routines are
-- finalized, and those still open (scheduled or rejected) become missed. Tasks are never finalized:
-- they carry over and show as overdue. Idempotent, and it catches up every earlier day at once.
create function private.close_past_due(p_household uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_closed integer;
begin
  with closing as (
    select o.id
      from public.chore_occurrence o
      join public.household h on h.id = o.household_id
     where o.finalized_at is null
       and o.kind = 'chore'
       and o.due_date < private.local_date(h.timezone, now())
       and (p_household is null or o.household_id = p_household)
       for update of o skip locked
  )
  update public.chore_occurrence o
     set finalized_at      = now(),
         status            = case when o.status in ('scheduled', 'rejected') then 'missed' else o.status end,
         status_changed_at = case when o.status in ('scheduled', 'rejected') then now() else o.status_changed_at end
    from closing c
   where o.id = c.id;
  get diagnostics v_closed = row_count;
  return v_closed;
end $$;

-- [CHR-07][NFR-06] Re-folds every occurrence due in a range and lists any whose stored status differs
-- from its events. Report-only unless p_apply, which writes the corrections (a parent's explicit
-- action, never a job's).
create function private.rebuild_occurrence_status(
  p_household uuid, p_from date, p_to date, p_apply boolean default false)
returns table (occurrence_id uuid, was text, now_is text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with drift as (
    select o.id, o.status as was, f.status as now_is, f.event_id, f.done_by, f.rewarded
      from public.chore_occurrence o
     cross join lateral private.fold_occurrence_status(o.id) f
     where o.household_id = p_household
       and o.due_date between p_from and p_to
       and (o.status is distinct from f.status or o.status_event_id is distinct from f.event_id
            or o.done_by is distinct from f.done_by or o.rewarded is distinct from f.rewarded)
  ), applied as (
    update public.chore_occurrence o
       set status = d.now_is, status_event_id = d.event_id, done_by = d.done_by, rewarded = d.rewarded,
           status_changed_at = now()
      from drift d
     where p_apply and o.id = d.id
    returning o.id
  )
  select d.id, d.was, d.now_is from drift d;
end $$;

-- ---------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------

-- [CHR-04][NFR-06] Records a batch of events (at most 100) as the caller, under RLS, one at a time:
-- each is recorded, a duplicate of one already recorded (idempotent on id), gone (its occurrence was
-- removed, D-45), refused (not this caller's to record) or invalid, and one event's failure never
-- fails the rest. Each result carries the occurrence as the caller now sees it, so a board can rebase
-- its optimistic state on the server's.
create function public.record_completions(p_events jsonb) returns jsonb
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
      insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at, batch_id, note)
      values ((e ->> 'id')::uuid, v_occ, e ->> 'event_type',
              coalesce((select array_agg(d::uuid) from jsonb_array_elements_text(e -> 'done_by') d), '{}'),
              (e ->> 'occurred_at')::timestamptz, (e ->> 'batch_id')::uuid, e ->> 'note')
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

-- [CHR-07] The day_close job (hourly, 01 §5.6): finalizes the household's past routines.
create function public.close_household_day(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household_id);
begin
  if v_today is null then
    raise exception 'unknown household' using errcode = 'P0002';
  end if;
  return jsonb_build_object('closed', private.close_past_due(p_household_id), 'through', v_today - 1);
end $$;

-- [NFR-06] The status_check job (nightly): re-folds the last 14 days and the planned 14 ahead (a task
-- can be done early), report-only. Drift means a status
-- was written some other way than by its events; the job fails, so System Health shows it.
create function public.occurrence_status_drift(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household_id);
  v_drift jsonb;
begin
  if v_today is null then
    raise exception 'unknown household' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('occurrence_id', r.occurrence_id, 'was', r.was, 'now_is', r.now_is)), '[]')
    into v_drift
    from private.rebuild_occurrence_status(p_household_id, v_today - 14, v_today + 14) r;
  return jsonb_build_object('from', v_today - 14, 'through', v_today + 14, 'drift', jsonb_array_length(v_drift),
                            'sample', (select coalesce(jsonb_agg(x), '[]') from (
                                         select x from jsonb_array_elements(v_drift) x limit 5) s));
end $$;

revoke all on function private.normalize_completion_event(), private.prevent_event_change(),
                       private.fold_occurrence_status(uuid), private.apply_completion_event(),
                       private.close_past_due(uuid), private.rebuild_occurrence_status(uuid, date, date, boolean)
  from public, anon, authenticated;
revoke all on function public.record_completions(jsonb) from public, anon;
grant execute on function public.record_completions(jsonb) to authenticated, service_role;
revoke all on function public.close_household_day(uuid), public.occurrence_status_drift(uuid)
  from public, anon, authenticated;
grant execute on function public.close_household_day(uuid), public.occurrence_status_drift(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security: admins and the board read the events of items they can see (D-34). A board
-- records check-offs and undos; an admin records anything, as themselves. Nobody updates or deletes.
-- Events are their own audit trail (who, when, from which board), so they are not copied to audit_log.
-- ---------------------------------------------------------------------------

alter table public.chore_completion_event enable row level security;

create policy chore_completion_event_admin_select on public.chore_completion_event for select to authenticated
  using (household_id in (select private.admin_household_ids()) and private.can_see_occurrence(occurrence_id));
create policy chore_completion_event_device_select on public.chore_completion_event for select to authenticated
  using (household_id = (select private.device_household_id()) and private.can_see_occurrence(occurrence_id));
create policy chore_completion_event_admin_insert on public.chore_completion_event for insert to authenticated
  with check (household_id in (select private.admin_household_ids()) and actor_type = 'admin'
              and actor_id = (select auth.uid()) and private.can_see_occurrence(occurrence_id));
create policy chore_completion_event_device_insert on public.chore_completion_event for insert to authenticated
  with check (household_id = (select private.device_household_id()) and actor_type = 'device'
              and event_type in ('complete', 'undo') and private.can_see_occurrence(occurrence_id));

revoke all on public.chore_completion_event from anon;
revoke update, delete, truncate on public.chore_completion_event from authenticated;
