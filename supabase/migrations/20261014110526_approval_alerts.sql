-- [CHR-20] An alert when something waits for a parent (WP-63, 02 §3.7, D-88).
--   * Each parent with reminders on and Approvals on (`reminder_preference.approval_alerts`, on by
--     default) gets at most one alert a reminders run for the check-offs waiting for a parent's OK
--     (`pending_approval`) and the reward requests (`redemption` `requested`) that became waiting
--     since their last alert, grouped by child ("Maya: 3 check-offs and 1 reward request waiting").
--   * Each alert is a `reminder_delivery` of kind `approval` covering a window of time
--     (`waiting_from`, `waiting_to`]: planned when something in the window is waiting, held through
--     quiet hours, and worked out when it is claimed. While one is held no other is planned, and the
--     claim closes its window at that moment, so each thing is in one alert only. A held alert with
--     nothing still waiting when it is claimed is skipped.
--   * A parent is told only of what they may see (a private item: its creator or its assignees) and
--     never of a reward request they made themselves; and only of what became waiting since they
--     turned Approvals on (`approvals_on_at`, kept by a trigger), so turning it on never brings old news.

alter table public.reminder_preference
  add column approval_alerts boolean not null default true,
  add column approvals_on_at timestamptz;
-- Everyone with reminders on has Approvals on from now.
update public.reminder_preference set approvals_on_at = now() where enabled;

-- [CHR-20] When reminders and Approvals are both on again after either was off (or a new row has
-- both on), alerts count from now.
create function private.approvals_switched_on() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.enabled and new.approval_alerts
     and (tg_op = 'INSERT' or not (old.enabled and old.approval_alerts)) then
    new.approvals_on_at := now();
  end if;
  return new;
end $$;
create trigger trg_reminder_preference_approvals_on before insert or update on public.reminder_preference
  for each row execute function private.approvals_switched_on();

alter table public.reminder_delivery
  add column waiting_from timestamptz,
  add column waiting_to   timestamptz,
  drop constraint reminder_delivery_kind_check,
  add constraint reminder_delivery_kind_check check (kind in ('due', 'digest', 'approval')),
  add constraint reminder_delivery_approval_window check ((kind = 'approval') = (waiting_from is not null)),
  add constraint reminder_delivery_window_order check (waiting_to is null or waiting_to >= waiting_from);
create index on public.reminder_delivery (member_id, kind, waiting_to);

-- What waits for this parent that became waiting in (p_from, p_to] and still waits: one row per
-- child, with their check-offs and reward requests, in the household's member order.
create function private.approvals_waiting(p_household uuid, p_member uuid, p_from timestamptz, p_to timestamptz)
returns table (child uuid, name text, checkoffs integer, requests integer)
language sql stable security definer set search_path = '' as $$
  with parent as (
    select m.id, m.user_id from public.member m where m.id = p_member
  ), checkoff as (
    select coalesce(o.done_by[1], (select a.member_id from public.chore_occurrence_assignee a
                                    where a.occurrence_id = o.id order by a.member_id limit 1)) as child
      from public.chore_occurrence o
      join public.chore c on c.id = o.chore_id
      cross join parent p
     where o.household_id = p_household
       and o.status = 'pending_approval'
       and o.status_changed_at > p_from and o.status_changed_at <= p_to
       and (c.visibility = 'family' or c.created_by = p.user_id
            or exists (select from public.chore_assignee ca where ca.chore_id = c.id and ca.member_id = p.id))
       and not (p.id = any (o.done_by))
  ), request as (
    select r.member_id as child
      from public.redemption r
      cross join parent p
     where r.household_id = p_household
       and r.status = 'requested'
       and r.requested_at > p_from and r.requested_at <= p_to
       and not (r.requested_by_type = 'admin' and r.requested_by is not distinct from p.user_id)
  ), counted as (
    select child, count(*)::integer as checkoffs, 0 as requests from checkoff group by child
    union all
    select child, 0, count(*)::integer from request group by child
  )
  select m.id, m.display_name, sum(k.checkoffs)::integer, sum(k.requests)::integer
    from counted k
    join public.member m on m.id = k.child
   group by m.id, m.display_name, m.created_at
   order by m.created_at, m.display_name
$$;

-- "Maya: 3 check-offs and 1 reward request · Leo: 1 check-off waiting".
create function private.approvals_line(p_waiting jsonb) returns text
language sql immutable set search_path = '' as $$
  select string_agg(
           (w ->> 'name') || ': ' || concat_ws(' and ',
             case (w ->> 'checkoffs')::integer when 0 then null when 1 then '1 check-off'
                  else (w ->> 'checkoffs') || ' check-offs' end,
             case (w ->> 'requests')::integer when 0 then null when 1 then '1 reward request'
                  else (w ->> 'requests') || ' reward requests' end),
           ' · ' order by ord) || ' waiting'
    from jsonb_array_elements(p_waiting) with ordinality as x (w, ord)
$$;

-- ---------------------------------------------------------------------------------------------
-- The reminders job, with approval alerts (replaces WP-40's plan and claim)
-- ---------------------------------------------------------------------------------------------

-- As before (WP-40), and: for each parent with reminders and Approvals on and no approval alert
-- held, one alert when something they may see became waiting since their last, or since they turned
-- Approvals on (and at most in the last two hours, as for any reminder), held until quiet hours end.
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

-- As before (WP-40), and: an approval alert closes its window at the claim, so what became waiting
-- while it was held is in it, and says what still waits in that window; with nothing still waiting
-- (another parent cleared it) it is skipped. It opens Today, or Rewards when only requests wait, and
-- every approval alert has the same tag, so a newer one replaces the older on the lock screen.
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
        v_title := private.approvals_line(v_waiting);
        if exists (select from jsonb_array_elements(v_waiting) w where (w ->> 'checkoffs')::integer > 0) then
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

revoke all on function private.approvals_switched_on() from public, anon, authenticated;
revoke all on function private.approvals_waiting(uuid, uuid, timestamptz, timestamptz),
  private.approvals_line(jsonb) from public, anon, authenticated;
