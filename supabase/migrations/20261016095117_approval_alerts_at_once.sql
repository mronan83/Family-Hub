-- [CHR-20] Approval alerts at once (WP-92, D-119). An approval alert went only with the reminders
-- job every 5 minutes, so a check-off a parent dealt with inside those minutes never brought one.
-- Now, when a check-off starts waiting for a parent, a reward request is made or a lunch change
-- waits, the database calls the reminders job for that household as the change is saved (pg_net
-- sends it once the transaction commits), and the alert goes within seconds. The 5-minute run stays,
-- as the safety net. Who is told, quiet hours and the Approvals switch are unchanged (D-88).
--   * One call per household per transaction, however many rows change (a board's batch of offline
--     check-offs is one call), and never an error for the change itself: a failed call is a warning,
--     and the 5-minute run sends the alert.
--   * plan_reminders() takes a lock per household, so a run called at once and the 5-minute run never
--     plan two alerts for the same thing.
--   * An alert still goes only when something new waits, but it counts everything that waits for the
--     parent now ("Maya: 3 check-offs waiting"), so the newest alert, which replaces the older on the
--     lock screen, is never short.

-- Calls the reminders job for this household, once per transaction. Never raises.
create function private.alert_now(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := 'familywise.alert_now_' || replace(p_household::text, '-', '');
begin
  if coalesce(current_setting(v_key, true), '') = '1' then
    return;
  end if;
  perform set_config(v_key, '1', true);
  begin
    perform private.call_job('reminders', jsonb_build_object('household', p_household));
  exception when others then
    raise warning 'approval alert not called at once (the 5-minute run sends it): %', sqlerrm;
  end;
end $$;

-- A check-off that starts waiting for a parent.
create function private.alert_now_checkoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending_approval' and old.status is distinct from 'pending_approval' then
    perform private.alert_now(new.household_id);
  end if;
  return null;
end $$;
create trigger trg_chore_occurrence_alert_now after update of status on public.chore_occurrence
  for each row execute function private.alert_now_checkoff();

-- A reward request, or a lunch change, that starts waiting for a parent.
create function private.alert_now_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_table_name = 'redemption' and new.status = 'requested'
        and (tg_op = 'INSERT' or old.status is distinct from 'requested'))
     or (tg_table_name = 'lunch_request' and new.status = 'waiting'
        and (tg_op = 'INSERT' or old.status is distinct from 'waiting'
             or old.requested_at is distinct from new.requested_at)) then
    perform private.alert_now(new.household_id);
  end if;
  return null;
end $$;
create trigger trg_redemption_alert_now after insert or update of status on public.redemption
  for each row execute function private.alert_now_request();
create trigger trg_lunch_request_alert_now after insert or update of status, requested_at on public.lunch_request
  for each row execute function private.alert_now_request();

revoke all on function private.alert_now(uuid), private.alert_now_checkoff(), private.alert_now_request()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The reminders job: one plan at a time per household; an approval alert counts all that waits
-- ---------------------------------------------------------------------------------------------

-- As before (WP-63), one plan at a time per household.
create or replace function public.plan_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz        text;
  v_today     date;
  v_due       integer;
  v_digests   integer;
  v_approvals integer;
  v_pruned    integer;
begin
  -- [CHR-20] One plan at a time per household (D-119): a run called at once and the 5-minute run
  -- can overlap, and each must see the other's held alert.
  perform pg_advisory_xact_lock(hashtextextended('plan_reminders:' || p_household::text, 0));
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select timezone into v_tz from public.household where id = p_household;
  if v_tz is null then
    raise exception 'no such household' using errcode = 'P0002', hint = 'not_found';
  end if;
  v_today := (p_now at time zone v_tz)::date;

  with person as (
    select p.*
      from public.reminder_preference p
      join public.member m on m.id = p.member_id and m.user_id is not null and m.archived_at is null
     where p.household_id = p_household and p.enabled
  ), due as (
    select o.id as occurrence_id, a.member_id, p.quiet_start, p.quiet_end,
           case when o.due_time is null
                then (o.due_date + p.morning_time) at time zone v_tz
                else ((o.due_date + o.due_time) at time zone v_tz)
                     - make_interval(mins => coalesce(c.remind_lead_minutes, p.default_lead_minutes))
           end as at
      from public.chore_occurrence o
      join public.chore c on c.id = o.chore_id and c.archived_at is null
      join public.chore_occurrence_assignee a on a.occurrence_id = o.id
      join person p on p.member_id = a.member_id
      left join public.chore_assignee ca on ca.chore_id = o.chore_id and ca.member_id = a.member_id
     where o.household_id = p_household
       and o.status in ('scheduled', 'rejected')
       and o.due_date between v_today - 1 and v_today + 2
       and coalesce(ca.remind, p.default_on)
  ), planned as (
    insert into public.reminder_delivery (household_id, occurrence_id, member_id, kind, scheduled_for, dedupe_key)
    select p_household, d.occurrence_id, d.member_id, 'due',
           private.after_quiet(d.at, d.quiet_start, d.quiet_end, v_tz),
           'due:' || d.occurrence_id || ':' || d.member_id
      from due d
     where d.at <= p_now and d.at > p_now - interval '2 hours'
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_due from planned;

  with person as (
    select p.*
      from public.reminder_preference p
      join public.member m on m.id = p.member_id and m.user_id is not null and m.archived_at is null
     where p.household_id = p_household and p.enabled and p.digest_time is not null
  ), digest as (
    select p.member_id, (v_today + p.digest_time) at time zone v_tz as at, p.quiet_start, p.quiet_end
      from person p
     where exists (
       select from public.chore_occurrence o
         join public.chore_occurrence_assignee a on a.occurrence_id = o.id and a.member_id = p.member_id
         join public.chore c on c.id = o.chore_id and c.archived_at is null
        where o.household_id = p_household and o.status in ('scheduled', 'rejected')
          and (o.due_date = v_today or (o.kind = 'task' and o.due_date < v_today)))
  ), planned as (
    insert into public.reminder_delivery (household_id, member_id, kind, scheduled_for, dedupe_key)
    select p_household, d.member_id, 'digest', private.after_quiet(d.at, d.quiet_start, d.quiet_end, v_tz),
           'digest:' || d.member_id || ':' || v_today
      from digest d
     where d.at <= p_now and d.at > p_now - interval '2 hours'
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_digests from planned;

  -- [CHR-20] Approval alerts: parents only (an admin of the household), one per parent per run.
  with parent as (
    select p.member_id, p.quiet_start, p.quiet_end,
           greatest(p_now - interval '2 hours', p.approvals_on_at,
                    (select max(r.waiting_to) from public.reminder_delivery r
                      where r.member_id = p.member_id and r.kind = 'approval')) as since
      from public.reminder_preference p
      join public.member m on m.id = p.member_id and m.user_id is not null and m.archived_at is null
      join public.household_user hu on hu.household_id = p_household and hu.user_id = m.user_id
     where p.household_id = p_household and p.enabled and p.approval_alerts
       and not exists (select from public.reminder_delivery r
                        where r.member_id = p.member_id and r.kind = 'approval' and r.status = 'held')
  ), planned as (
    insert into public.reminder_delivery (household_id, member_id, kind, scheduled_for, dedupe_key, waiting_from)
    select p_household, a.member_id, 'approval', private.after_quiet(p_now, a.quiet_start, a.quiet_end, v_tz),
           'approval:' || a.member_id || ':' || to_char(p_now at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
           a.since
      from parent a
     where a.since < p_now
       and exists (select from private.approvals_waiting(p_household, a.member_id, a.since, p_now))
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_approvals from planned;

  delete from public.reminder_delivery
   where household_id = p_household and created_at < p_now - interval '90 days';
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('planned', v_due, 'digests', v_digests, 'approvals', v_approvals,
                            'pruned', v_pruned);
end $$;

-- As before (WP-63, WP-49), and an approval alert counts everything that waits for the parent now.
create or replace function public.claim_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz      text;
  v_today   date;
  d         public.reminder_delivery;
  p         public.reminder_preference;
  v_devices jsonb;
  v_title   text;
  v_body    text;
  v_url     text;
  v_tag     text;
  v_skip    text;
  v_out     jsonb := '[]'::jsonb;
  o         record;
  v_open    integer;
  v_late    integer;
  v_names   text[];
  v_waiting jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select timezone into v_tz from public.household where id = p_household;
  v_today := (p_now at time zone v_tz)::date;

  for d in select * from public.reminder_delivery
            where household_id = p_household and status = 'held' and scheduled_for <= p_now
            order by scheduled_for, id
            for update skip locked loop
    v_skip := null;
    v_tag := d.dedupe_key;
    select * into p from public.reminder_preference where member_id = d.member_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
                                                 'auth', s.auth_secret) order by s.created_at), '[]'::jsonb)
      into v_devices
      from public.push_subscription s where s.member_id = d.member_id and s.enabled;

    if d.kind = 'approval' then
      update public.reminder_delivery set waiting_to = greatest(p_now, waiting_from) where id = d.id;
    end if;

    if p.member_id is null or not p.enabled then
      v_skip := 'reminders_off';
    elsif d.kind = 'approval' and not p.approval_alerts then
      v_skip := 'approvals_off';
    elsif d.scheduled_for < p_now - interval '2 hours' then
      v_skip := 'late';
    end if;

    if v_skip is null and d.kind = 'due' then
      select oc.status, oc.due_date, oc.due_time, oc.kind, c.title, c.visibility, c.archived_at,
             coalesce(ca.remind, p.default_on) as bell,
             exists (select from public.chore_occurrence_assignee a
                      where a.occurrence_id = oc.id and a.member_id = d.member_id) as assigned
        into o
        from public.chore_occurrence oc
        join public.chore c on c.id = oc.chore_id
        left join public.chore_assignee ca on ca.chore_id = oc.chore_id and ca.member_id = d.member_id
       where oc.id = d.occurrence_id;
      if o.status is null or o.status not in ('scheduled', 'rejected') then
        v_skip := 'done';
      elsif not o.assigned or not o.bell or o.archived_at is not null then
        v_skip := 'item_off';
      else
        v_title := case when o.visibility = 'private' and p.hide_private_titles
                        then case when o.kind = 'task' then 'Private task' else 'Private chore' end
                        else o.title end;
        v_body := case
          when o.due_time is null then 'Due today'
          when o.due_date = v_today then 'Due at ' || private.clock_words(o.due_time)
          when o.due_date = v_today + 1 then 'Due tomorrow at ' || private.clock_words(o.due_time)
          when o.due_date = v_today - 1 then 'Was due yesterday at ' || private.clock_words(o.due_time)
          else 'Due ' || to_char(o.due_date, 'Dy') || ' at ' || private.clock_words(o.due_time)
        end;
        v_url := '/admin/my#item-' || d.occurrence_id;
      end if;
    elsif v_skip is null and d.kind = 'approval' then
      -- [CHR-20] What still waits of what became waiting in this alert's window.
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_waiting
        from private.approvals_waiting(p_household, d.member_id, d.waiting_from, greatest(p_now, d.waiting_from)) w;
      if jsonb_array_length(v_waiting) = 0 then
        v_skip := 'nothing_waiting';
      else
        -- [CHR-20] Something new still waits: the alert counts everything that waits for them now
        -- (D-119), so the newest alert, which replaces the older, is never short.
        select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_waiting
          from private.approvals_waiting(p_household, d.member_id, '-infinity', greatest(p_now, d.waiting_from)) w;
        v_title := private.approvals_line(v_waiting);
        if exists (select from jsonb_array_elements(v_waiting) w where (w ->> 'checkoffs')::integer > 0
                                                                  or (w ->> 'lunches')::integer > 0) then
          v_body := 'Open Today to approve';
          v_url := '/admin/today';
        else
          v_body := 'Open Rewards to decide';
          v_url := '/admin/rewards';
        end if;
        v_tag := 'approval';
      end if;
    elsif v_skip is null then
      -- The digest: what is open for them today, and their overdue tasks.
      select count(*) filter (where oc.due_date = v_today),
             count(*) filter (where oc.due_date < v_today),
             (array_agg(case when c.visibility = 'private' and p.hide_private_titles then 'a private item'
                             else c.title end
                        order by oc.due_date, oc.due_time nulls last, c.title))[1:3]
        into v_open, v_late, v_names
        from public.chore_occurrence oc
        join public.chore_occurrence_assignee a on a.occurrence_id = oc.id and a.member_id = d.member_id
        join public.chore c on c.id = oc.chore_id and c.archived_at is null
       where oc.household_id = p_household and oc.status in ('scheduled', 'rejected')
         and (oc.due_date = v_today or (oc.kind = 'task' and oc.due_date < v_today));
      if v_open + v_late = 0 then
        v_skip := 'nothing_due';
      else
        v_title := 'Your day: ' || v_open || ' to do' || case when v_late > 0 then ', ' || v_late || ' overdue' else '' end;
        v_body := array_to_string(v_names, ', ')
                  || case when v_open + v_late > 3 then ' and ' || (v_open + v_late - 3) || ' more' else '' end;
        v_url := '/admin/my';
      end if;
    end if;

    if v_skip is null and jsonb_array_length(v_devices) = 0 then
      v_skip := 'no_device';
    end if;

    if v_skip is not null then
      update public.reminder_delivery set status = 'skipped', detail = v_skip where id = d.id;
    else
      update public.reminder_delivery set status = 'sent', sent_at = p_now where id = d.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'delivery_id', d.id, 'member_id', d.member_id, 'kind', d.kind,
        'payload', jsonb_build_object('title', v_title, 'body', v_body, 'url', v_url, 'tag', v_tag)
                   || case when d.kind = 'approval' then jsonb_build_object('renotify', true) else '{}'::jsonb end,
        'devices', v_devices));
    end if;
  end loop;
  return v_out;
end $$;
