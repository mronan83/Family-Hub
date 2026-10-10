-- [CHR-15][CHR-16][CHR-17] Reminders by web push (WP-40, 02 §3.7, D-35, D-58).
--   * Each adult with a sign-in keeps their own reminder settings (off until they turn them on), their
--     own devices (one push subscription per browser) and their own deliveries; nobody else sees them.
--   * Every 5 minutes the reminders job plans, for each household, the reminders whose time has come:
--     an open item's due time less its lead time, or the person's morning time when it has no due
--     time, and the daily digest at its time. Each is one `reminder_delivery` row with a dedupe key,
--     held until any quiet hours end. Then it claims the held rows now due, marking each sent before
--     anything goes out, so a retry never sends twice; one done, switched off or with no device by
--     then is skipped. The app sends the claimed ones and records how each device answered.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.reminder_preference (
  member_id            uuid primary key,
  household_id         uuid not null,
  enabled              boolean not null default false,          -- off until the person turns them on
  default_on           boolean not null default true,           -- the bell on items that don't say
  default_lead_minutes integer not null default 15 check (default_lead_minutes in (0, 15, 60, 1440)),
  morning_time         time not null default '08:00',           -- items with no due time
  digest_time          time,                                    -- null: no digest
  quiet_start          time,
  quiet_end            time,
  hide_private_titles  boolean not null default true,
  updated_at           timestamptz not null default now(),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade,
  check ((quiet_start is null) = (quiet_end is null)),
  check (quiet_start is distinct from quiet_end or quiet_start is null),
  check (extract(second from morning_time) = 0 and coalesce(extract(second from digest_time), 0) = 0
         and coalesce(extract(second from quiet_start), 0) = 0 and coalesce(extract(second from quiet_end), 0) = 0)
);

create table public.push_subscription (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null,
  member_id       uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  endpoint        text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  p256dh          text not null check (length(p256dh) between 40 and 200),
  auth_secret     text not null check (length(auth_secret) between 8 and 100),
  device_label    text not null check (length(btrim(device_label)) between 1 and 60),
  enabled         boolean not null default true,                -- the device's own switch
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count   integer not null default 0,
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.push_subscription (member_id);

create table public.reminder_delivery (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  occurrence_id uuid,
  member_id     uuid not null,
  kind          text not null check (kind in ('due', 'digest')),
  scheduled_for timestamptz not null,                           -- when it goes (after quiet hours)
  sent_at       timestamptz,
  status        text not null default 'held' check (status in ('held', 'sent', 'skipped', 'failed')),
  detail        text,                                           -- why skipped or failed
  dedupe_key    text not null unique,                           -- due:{occurrence}:{member} or digest:{member}:{date}
  created_at    timestamptz not null default now(),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade,
  foreign key (household_id, occurrence_id) references public.chore_occurrence (household_id, id) on delete cascade,
  check ((kind = 'due') = (occurrence_id is not null))
);
create index on public.reminder_delivery (household_id, status, scheduled_for);
create index on public.reminder_delivery (member_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- Whose rows are whose
-- ---------------------------------------------------------------------------------------------

-- The caller's own member rows (an adult with a sign-in has one per household).
create function private.my_member_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.member where user_id = (select auth.uid()) and archived_at is null
$$;

-- The caller's member in a household they administer; raises otherwise.
create function private.my_member(p_household uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select id into v_id from public.member
   where household_id = p_household and user_id = (select auth.uid()) and archived_at is null;
  if v_id is null then
    raise exception 'reminders are for a family member with a sign-in' using errcode = '22023', hint = 'no_member';
  end if;
  return v_id;
end $$;

-- When a reminder goes: its time, or the end of the person's quiet hours if it falls inside them
-- (quiet hours may run past midnight, 21:00 to 07:00).
create function private.after_quiet(p_at timestamptz, p_start time, p_end time, p_tz text)
returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when p_start is null or p_end is null then p_at
    when p_start < p_end and (p_at at time zone p_tz)::time >= p_start and (p_at at time zone p_tz)::time < p_end
      then ((p_at at time zone p_tz)::date + p_end) at time zone p_tz
    when p_start > p_end and (p_at at time zone p_tz)::time >= p_start
      then ((p_at at time zone p_tz)::date + 1 + p_end) at time zone p_tz
    when p_start > p_end and (p_at at time zone p_tz)::time < p_end
      then ((p_at at time zone p_tz)::date + p_end) at time zone p_tz
    else p_at
  end
$$;

-- "3:00 pm", as the brand writes times (06 §2).
create function private.clock_words(p_time time) returns text
language sql immutable set search_path = '' as $$
  select to_char(p_time, 'FMHH12:MI') || ' ' || lower(to_char(p_time, 'am'))
$$;

-- ---------------------------------------------------------------------------------------------
-- [CHR-16][CHR-17] The reminders job: plan, claim, finish (service role only)
-- ---------------------------------------------------------------------------------------------

-- Plans the household's reminders whose time has come in the last two hours (a reminder older than
-- that is never sent: a late nudge is noise), each once by its dedupe key, held until quiet hours
-- end; and the digest of anyone whose digest time has come and who has something open today or
-- overdue. Prunes deliveries after 90 days. p_now is the job's clock (tests pass their own).
create function public.plan_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz      text;
  v_today   date;
  v_due     integer;
  v_digests integer;
  v_pruned  integer;
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

  delete from public.reminder_delivery
   where household_id = p_household and created_at < p_now - interval '90 days';
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('planned', v_due, 'digests', v_digests, 'pruned', v_pruned);
end $$;

-- Claims the household's held reminders now due. Each still wanted (the person's reminders on, the
-- item open and its bell on, a device switched on) is marked sent before it goes and returned with
-- what to send and where; any other is skipped with why; one held more than two hours past its time
-- (the job was down) is skipped as late. A private item's title stays out of the payload while the
-- person hides private titles.
create function public.claim_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
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
  v_skip    text;
  v_out     jsonb := '[]'::jsonb;
  o         record;
  v_open    integer;
  v_late    integer;
  v_names   text[];
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
    select * into p from public.reminder_preference where member_id = d.member_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
                                                 'auth', s.auth_secret) order by s.created_at), '[]'::jsonb)
      into v_devices
      from public.push_subscription s where s.member_id = d.member_id and s.enabled;

    if p.member_id is null or not p.enabled then
      v_skip := 'reminders_off';
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
        'payload', jsonb_build_object('title', v_title, 'body', v_body, 'url', v_url, 'tag', d.dedupe_key),
        'devices', v_devices));
    end if;
  end loop;
  return v_out;
end $$;

-- Records how each device answered a claimed reminder: a success resets its failures; 404 or 410
-- (the subscription is gone) deletes it; anything else counts a failure. With no success, the
-- delivery is failed (it is not sent again).
create function public.finish_reminder(p_delivery uuid, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_ok    integer := 0;
  v_gone  integer := 0;
  v_fail  integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  for r in select (x ->> 'id')::uuid as id, (x ->> 'status')::integer as status
             from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x loop
    if r.status between 200 and 299 then
      update public.push_subscription set last_success_at = now(), failure_count = 0 where id = r.id;
      v_ok := v_ok + 1;
    elsif r.status in (404, 410) then
      delete from public.push_subscription where id = r.id;
      v_gone := v_gone + 1;
    else
      update public.push_subscription set failure_count = failure_count + 1 where id = r.id;
      v_fail := v_fail + 1;
    end if;
  end loop;
  if v_ok = 0 then
    update public.reminder_delivery
       set status = 'failed', detail = case when v_gone > 0 and v_fail = 0 then 'gone' else 'push_failed' end
     where id = p_delivery and status = 'sent';
  end if;
  return jsonb_build_object('delivered', v_ok, 'gone', v_gone, 'failed', v_fail);
end $$;

-- ---------------------------------------------------------------------------------------------
-- [CHR-15][CHR-16] What a person sets for themselves
-- ---------------------------------------------------------------------------------------------

-- Saves this browser's push subscription for the caller in a household they administer (a browser
-- that subscribed for someone else before moves to the caller), switched on.
create function public.save_push_subscription(p_household uuid, p_endpoint text, p_p256dh text,
                                              p_auth text, p_label text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := private.my_member(p_household);
  v_id     uuid;
begin
  insert into public.push_subscription as s (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label)
  values (p_household, v_member, (select auth.uid()), p_endpoint, p_p256dh, p_auth, btrim(p_label))
  on conflict (endpoint) do update
     set household_id = excluded.household_id, member_id = excluded.member_id, user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, device_label = excluded.device_label,
         enabled = true, failure_count = 0
  returning s.id into v_id;
  return v_id;
end $$;

-- The bell on an item, for the caller: true or false, or null to follow their default.
create function public.set_my_reminder(p_chore uuid, p_remind boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_member    uuid;
begin
  select household_id into v_household from public.chore where id = p_chore;
  v_member := private.my_member(v_household);
  update public.chore_assignee set remind = p_remind where chore_id = p_chore and member_id = v_member;
  if not found then
    raise exception 'only an item''s people are reminded about it' using errcode = '22023', hint = 'not_assignee';
  end if;
  return jsonb_build_object('chore_id', p_chore, 'remind', p_remind);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: each person sees and changes only their own
-- ---------------------------------------------------------------------------------------------

alter table public.reminder_preference enable row level security;
alter table public.push_subscription enable row level security;
alter table public.reminder_delivery enable row level security;

create policy reminder_preference_own on public.reminder_preference for all to authenticated
  using (member_id in (select private.my_member_ids()))
  with check (member_id in (select private.my_member_ids())
              and household_id = (select m.household_id from public.member m where m.id = member_id));
create policy push_subscription_own_select on public.push_subscription for select to authenticated
  using (member_id in (select private.my_member_ids()) and user_id = (select auth.uid()));
create policy push_subscription_own_update on public.push_subscription for update to authenticated
  using (member_id in (select private.my_member_ids()) and user_id = (select auth.uid()))
  with check (member_id in (select private.my_member_ids()) and user_id = (select auth.uid()));
create policy push_subscription_own_delete on public.push_subscription for delete to authenticated
  using (member_id in (select private.my_member_ids()) and user_id = (select auth.uid()));
create policy reminder_delivery_own_select on public.reminder_delivery for select to authenticated
  using (member_id in (select private.my_member_ids()));

revoke all on public.reminder_preference, public.push_subscription, public.reminder_delivery
  from public, anon, authenticated;
grant select, insert, update, delete on public.reminder_preference to authenticated;
grant select, delete on public.push_subscription to authenticated;
grant update (enabled, device_label, last_success_at) on public.push_subscription to authenticated;
grant select on public.reminder_delivery to authenticated;

create trigger trg_reminder_preference_updated before update on public.reminder_preference
  for each row execute function private.set_updated_at();
create trigger trg_audit after insert or update or delete on public.reminder_preference
  for each row execute function private.audit_row();

revoke all on function private.my_member_ids(), private.my_member(uuid), private.after_quiet(timestamptz, time, time, text),
  private.clock_words(time) from public, anon;
grant execute on function private.my_member_ids(), private.my_member(uuid) to authenticated;
revoke all on function public.plan_reminders(uuid, timestamptz), public.claim_reminders(uuid, timestamptz),
  public.finish_reminder(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.plan_reminders(uuid, timestamptz), public.claim_reminders(uuid, timestamptz),
  public.finish_reminder(uuid, jsonb) to service_role;
revoke all on function public.save_push_subscription(uuid, text, text, text, text),
  public.set_my_reminder(uuid, boolean) from public, anon;
grant execute on function public.save_push_subscription(uuid, text, text, text, text),
  public.set_my_reminder(uuid, boolean) to authenticated;
