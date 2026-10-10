-- [CAL-04][CAL-05] Calendars on the boards (WP-23, 02 §3.4 and §4.6, D-65).
--   * Each board shows the calendars it is set to: once an admin saves a board's own choice, exactly
--     those (a calendar connected later stays off that board until ticked); until then, the calendars
--     whose "show on the boards" is on. Unticking a calendar takes its events off that board at once
--     (Realtime tells the board; it reads again).
--   * A board reads the calendars it shows and their events, never the others' events (RLS), over the
--     snapshot's window, and over any range its calendar screen opens (board_calendar(), 62 days at
--     most). The links stay in Vault: a board reads names, colors and whose calendar it is.

alter table public.device add constraint device_household_id_id_key unique (household_id, id);

create table public.device_calendar (
  device_id          uuid not null,
  calendar_source_id uuid not null,
  household_id       uuid not null,
  visible            boolean not null,
  updated_at         timestamptz not null default now(),
  primary key (device_id, calendar_source_id),
  foreign key (household_id, device_id) references public.device (household_id, id) on delete cascade,
  foreign key (household_id, calendar_source_id) references public.calendar_source (household_id, id)
    on delete cascade
);
create index on public.device_calendar (calendar_source_id);

-- ---------------------------------------------------------------------------------------------
-- Which calendars a board shows
-- ---------------------------------------------------------------------------------------------

-- The calling board's device while it is active (null for anyone else).
create function private.my_device_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.device where auth_user_id = (select auth.uid()) and status = 'active'
$$;

-- Whether a board shows a calendar: its own choice once one is saved, else the calendar's default.
create function private.calendar_on_board(p_device uuid, p_source uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select from public.device_calendar dc where dc.device_id = p_device)
      then coalesce((select dc.visible from public.device_calendar dc
                      where dc.device_id = p_device and dc.calendar_source_id = p_source), false)
    else coalesce((select s.show_on_board from public.calendar_source s where s.id = p_source), false)
  end
$$;

-- [CAL-05][US-507] An admin saves a board's own choice: the calendars ticked are shown, every other
-- calendar of the household is not (and one connected later stays off until ticked). Only what changes
-- is written, so an unchanged calendar sends the board nothing. Returns {shown, hidden}.
create function public.set_board_calendars(p_device uuid, p_calendars uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
  v_shown     integer;
  v_hidden    integer;
begin
  select household_id into v_household from public.device where id = p_device and status = 'active';
  if v_household is null or v_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  insert into public.device_calendar as dc (device_id, calendar_source_id, household_id, visible)
  select p_device, s.id, v_household, s.id = any(coalesce(p_calendars, '{}'::uuid[]))
    from public.calendar_source s
   where s.household_id = v_household
  on conflict (device_id, calendar_source_id) do update
     set visible = excluded.visible, updated_at = now()
   where dc.visible is distinct from excluded.visible;
  select count(*) filter (where dc.visible), count(*) filter (where not dc.visible)
    into v_shown, v_hidden
    from public.device_calendar dc where dc.device_id = p_device;
  return jsonb_build_object('shown', v_shown, 'hidden', v_hidden);
end $$;

-- [CAL-04] What a board's calendar shows over a range of household-local dates (1 to 62 days): the
-- calendars it shows (name, color, whose, how their sync is going) and their events that touch the
-- range, all-day first on each day, then by start. Null for anyone but an active board. Security
-- invoker: RLS hides the events of calendars this board doesn't show.
create function public.board_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device uuid := private.my_device_id();
begin
  if v_device is null then
    return null;
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception 'the calendar covers 1 to 62 days' using errcode = '22023', hint = 'bad_range';
  end if;
  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'calendars', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'color', s.color, 'member_id', s.member_id,
               'status', s.status, 'last_success_at', s.last_success_at)
             order by s.created_at, s.id)
        from public.calendar_source s
       where private.calendar_on_board(v_device, s.id)), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'calendar_id', i.source_id, 'title', i.title, 'all_day', i.all_day,
               'start', i.instance_start, 'end', i.instance_end,
               'start_date', i.local_start_date, 'end_date', i.local_end_date, 'changed', i.changed)
             order by i.local_start_date, i.all_day desc, i.instance_start, i.title, i.id)
        from public.calendar_event_instance i
       where i.local_start_date <= p_to and i.local_end_date >= p_from), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- [DEV-05] The snapshot gains its calendar slice (02 §4.6); everything else as before.
-- ---------------------------------------------------------------------------------------------

create or replace function public.board_snapshot(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device    public.device;
  v_household public.household;
  v_today     date;
  v_week      date;
  v_from      date;
  v_to        date;
begin
  -- Only an active board has a snapshot; RLS shows a board its own row while it is active.
  select * into v_device from public.device
   where auth_user_id = (select auth.uid()) and status = 'active';
  if not found then
    return null;
  end if;
  select * into v_household from public.household where id = v_device.household_id;
  if not found then
    return null;
  end if;

  -- Business dates are household-local (01 §7). The default window is the widest the board shows:
  -- yesterday through two weeks ahead (calendar).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 14);
  -- The household's week so far, for each reward's weekly limit (as request_redemption() counts it).
  v_week := v_today - ((extract(dow from v_today)::integer - v_household.week_start + 7) % 7);
  if v_to < v_from or v_to - v_from > 31 then
    raise exception 'the snapshot covers 1 to 32 days' using errcode = '22023', hint = 'bad_range';
  end if;

  return jsonb_build_object(
    'v', 1,
    'fetched_at', now(),
    'today', v_today,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'household', jsonb_build_object(
      'id', v_household.id,
      'name', v_household.name,
      'timezone', v_household.timezone,
      'week_start', v_household.week_start,
      -- How long a check-off can be undone on the board (US-305, D-46).
      'undo_window_seconds', coalesce((select s.undo_window_seconds from public.household_settings s
                                        where s.household_id = v_household.id), 120)),
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto')),
    -- Children first, then adults; each by name. Archived members are not on the board. Points and
    -- the streak only for those who earn rewards (D-32).
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'display_name', m.display_name,
               'role', m.role,
               'avatar_key', m.avatar_key,
               'color', m.color,
               'earns_rewards', m.earns_rewards,
               'points', case when m.earns_rewards then jsonb_build_object(
                 'balance', (select coalesce(sum(l.amount), 0)::integer
                               from public.points_ledger l where l.member_id = m.id),
                 'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'id', x.id, 'type', x.entry_type, 'amount', x.amount, 'at', x.created_at,
                                    'label', x.label) order by x.created_at desc, x.id desc), '[]'::jsonb)
                              from (select l.id, l.entry_type, l.amount, l.created_at,
                                           case when l.occurrence_id is null then l.reason else c.title end as label
                                      from public.points_ledger l
                                      left join public.chore_occurrence o on o.id = l.occurrence_id
                                      left join public.chore c on c.id = o.chore_id
                                     where l.member_id = m.id
                                     order by l.created_at desc, l.id desc
                                     limit 5) x)) end,
               -- [RWD-05] The run going as of the last closed day, and the best good run.
               'streak', case when m.earns_rewards then jsonb_build_object(
                 'kind', (select s.kind from public.streak_segment s where s.member_id = m.id and s.end_date is null),
                 'length', coalesce((select s.length_days from public.streak_segment s
                                      where s.member_id = m.id and s.end_date is null), 0),
                 'best', coalesce((select max(s.length_days) from public.streak_segment s
                                    where s.member_id = m.id and s.kind = 'good'), 0)) end,
               -- [PTS-06] The reward they are saving for, if they pinned one still in the shop.
               'wish', case when m.earns_rewards then (
                 select jsonb_build_object('item_id', i.id, 'title', i.title, 'icon', i.icon,
                                           'cost', i.cost_points)
                   from public.wishlist_pin w
                   join public.reward_catalog_item i on i.id = w.catalog_item_id
                  where w.member_id = m.id and i.active and i.archived_at is null) end,
               -- [PTS-04] What they can still ask for: the balance less the requests waiting for a
               -- parent, as request_redemption() reckons it.
               'available', case when m.earns_rewards then
                 (select coalesce(sum(l.amount), 0)::integer from public.points_ledger l where l.member_id = m.id)
                 - (select coalesce(sum(r.cost_snapshot), 0)::integer from public.redemption r
                     where r.member_id = m.id and r.status = 'requested') end,
               -- [PTS-04][US-1104][US-1105] Their requests: those still open, and those settled in the last
               -- two days (so "not this time" is seen), newest first.
               'requests', case when m.earns_rewards then (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', x.id, 'item_id', x.catalog_item_id, 'title', x.title, 'icon', x.icon,
                          'cost', x.cost_snapshot, 'status', x.status, 'at', x.at)
                          order by x.at desc, x.id), '[]'::jsonb)
                   from (select r.id, r.catalog_item_id, i.title, i.icon, r.cost_snapshot, r.status,
                                coalesce(r.cancelled_at, r.fulfilled_at, r.decided_at, r.requested_at) as at
                           from public.redemption r
                           join public.reward_catalog_item i on i.id = r.catalog_item_id
                          where r.member_id = m.id
                            and (r.status in ('requested', 'approved')
                                 or coalesce(r.cancelled_at, r.fulfilled_at, r.decided_at, r.requested_at)
                                    > now() - interval '2 days')
                          order by at desc, r.id
                          limit 6) x) end,
               -- [PTS-04] The rewards they have asked for as often as allowed this week.
               'limited', case when m.earns_rewards then (
                 select coalesce(jsonb_agg(i.id order by i.id), '[]'::jsonb)
                   from public.reward_catalog_item i
                  where i.household_id = v_household.id and i.weekly_limit is not null
                    and (select count(*) from public.redemption r
                          where r.catalog_item_id = i.id and r.member_id = m.id
                            and r.status in ('requested', 'approved', 'fulfilled')
                            and (r.requested_at at time zone v_household.timezone)::date >= v_week)
                        >= i.weekly_limit) end)
             order by (m.role = 'child') desc, m.display_name, m.id)
        from public.member m
       where m.household_id = v_household.id and m.archived_at is null), '[]'::jsonb),
    -- [BRD-01][CHR-12][D-21] Today's items and the open overdue tasks (a task carries over until it is
    -- done; a routine from another day is a parent's to catch up). RLS as the board means private
    -- items never arrive (D-34). Overdue first, then by due time (none last), then title.
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'chore_id', o.chore_id,
               'title', c.title,
               'icon', c.icon,
               'kind', o.kind,
               'due_date', o.due_date,
               'due_time', to_char(o.due_time, 'HH24:MI'),
               'member_id', o.member_id,
               'assignees', (select coalesce(jsonb_agg(a.member_id order by a.member_id), '[]'::jsonb)
                               from public.chore_occurrence_assignee a where a.occurrence_id = o.id),
               'status', o.status,
               'done_by', to_jsonb(o.done_by),
               'rewarded', to_jsonb(o.rewarded),
               'points', o.points_snapshot,
               'requires_approval', o.requires_approval_snapshot,
               -- When the check-off it shows was made, so the board knows whether it can still be undone.
               'checked_at', (select e.occurred_at from public.chore_completion_event e
                               where e.id = o.status_event_id and e.event_type = 'complete'))
             order by o.due_date, o.due_time nulls last, c.title, o.member_id nulls first, o.id)
        from public.chore_occurrence o
        join public.chore c on c.id = o.chore_id
       where o.household_id = v_household.id
         and (o.due_date = v_today
              or (o.kind = 'task' and o.due_date < v_today and c.archived_at is null
                  and o.status in ('scheduled', 'rejected', 'pending_approval')))), '[]'::jsonb),
    -- [PTS-03][PTS-04][PTS-06] The shop as a child chooses from it: to save for (WP-30) and to ask for
    -- (WP-20). `left` is how many are still to be had (null: as many as asked for); `photo` is the path
    -- in the private rewards bucket, which the board reads through a signed link.
    'shop', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'title', i.title, 'icon', i.icon, 'cost', i.cost_points, 'photo', i.image_path,
               'description', i.description,
               'left', case when i.stock is not null then greatest(0, i.stock - (
                         select count(*) from public.redemption r
                          where r.catalog_item_id = i.id and r.status in ('requested', 'approved', 'fulfilled')))
                       end)
             order by i.sort_order, i.title, i.id)
        from public.reward_catalog_item i
       where i.household_id = v_household.id and i.active and i.archived_at is null), '[]'::jsonb),
    -- [RWD-07][RWD-08] The goals in play (WP-19's progress): each child's and the family's, going or
    -- reached, with each rule's progress. `celebrate` is a reached goal no board has celebrated yet.
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'member_id', g.member_id,
               'title', g.title,
               'icon', g.icon,
               'photo', g.image_path,
               'status', g.status,
               'n', g.achievement_count,
               'achieved_at', g.achieved_at,
               'celebrate', g.status = 'achieved' and g.celebrated_at is null,
               'end_date', g.end_date,
               'logic', g.rule_logic,
               'pct', coalesce(p.pct, 0),
               'rules', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'id', r.id, 'type', r.rule_type, 'target', r.target,
                                  'current', coalesce(rp.current_value, 0), 'pct', coalesce(rp.pct, 0),
                                  'met', coalesce(rp.is_met, false), 'streak', rp.current_streak,
                                  'best', rp.best_streak)
                                  order by r.sort_order, r.id), '[]'::jsonb)
                           from public.reward_rule r
                           left join public.reward_rule_progress rp on rp.rule_id = r.id
                          where r.goal_id = g.id))
             order by g.member_id nulls last, g.status = 'achieved' desc, g.end_date nulls last, g.title, g.id)
        from public.reward_goal g
        left join public.reward_goal_progress p on p.goal_id = g.id
        left join public.member m on m.id = g.member_id
       where g.household_id = v_household.id and g.archived_at is null
         and g.status in ('active', 'achieved')
         and (g.member_id is null or (m.archived_at is null and m.earns_rewards))), '[]'::jsonb),
    -- [CAL-04][CAL-05] The calendars this board shows and their events over the window (WP-23).
    'calendar', public.board_calendar(v_from, v_to));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------

alter table public.device_calendar enable row level security;

create policy device_calendar_admin_select on public.device_calendar for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy device_calendar_device_select on public.device_calendar for select to authenticated
  using (device_id = (select private.my_device_id()));
-- A board reads its household's calendars (names and colors; the links stay in Vault) and the events
-- of the calendars it shows.
create policy calendar_source_device_select on public.calendar_source for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy calendar_event_instance_device_select on public.calendar_event_instance for select to authenticated
  using (household_id = (select private.device_household_id())
         and private.calendar_on_board((select private.my_device_id()), source_id));

revoke all on public.device_calendar from public, anon, authenticated;
grant select on public.device_calendar to authenticated;

create trigger trg_audit after insert or update of visible or delete on public.device_calendar
  for each row execute function private.audit_row();

-- A board hears when its choice or a calendar changes (a sync updates its calendar's row last).
alter publication supabase_realtime add table public.calendar_source, public.device_calendar;

revoke all on function private.my_device_id(), private.calendar_on_board(uuid, uuid) from public, anon;
grant execute on function private.my_device_id(), private.calendar_on_board(uuid, uuid) to authenticated;
revoke all on function public.set_board_calendars(uuid, uuid[]), public.board_calendar(date, date)
  from public, anon;
grant execute on function public.set_board_calendars(uuid, uuid[]), public.board_calendar(date, date)
  to authenticated;
