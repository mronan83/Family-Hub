-- [BRD-04][US-1003] Weather on the board (WP-45, D-69). The household sets its place once (a town or
-- a postal code, found through Open-Meteo's geocoding and kept to about a kilometre: two decimals of
-- latitude and longitude) and whether temperatures are in °F or °C. The weather job reads the
-- temperature now and today's high and low every 30 minutes into weather_reading, and saving a place
-- reads it at once; the board only ever reads the snapshot, so it never calls the weather service and
-- keeps its last reading while offline. A read that fails keeps the last good values but marks them,
-- and the snapshot then carries no weather: the board hides it and nothing else changes. A layout can
-- turn the weather off for a board.

-- The household's place. All three or none; no place, no weather.
alter table public.household_settings
  add column weather_place text
    check (weather_place is null or length(btrim(weather_place)) between 1 and 120),
  add column weather_latitude numeric(5, 2) check (weather_latitude between -90 and 90),
  add column weather_longitude numeric(5, 2) check (weather_longitude between -180 and 180),
  add column temperature_unit text not null default 'fahrenheit'
    check (temperature_unit in ('fahrenheit', 'celsius'));
alter table public.household_settings add constraint household_settings_weather_place_whole
  check ((weather_place is null) = (weather_latitude is null)
         and (weather_latitude is null) = (weather_longitude is null));

-- The last reading, one per household. Kept apart from household_settings so a read every half hour
-- is not a settings change (no audit entry, no updated_at).
create table public.weather_reading (
  household_id uuid primary key references public.household (id) on delete cascade,
  temperature  numeric(4, 1) not null,
  high         numeric(4, 1) not null,
  low          numeric(4, 1) not null,
  weather_code smallint not null check (weather_code between 0 and 99),
  is_day       boolean not null,
  unit         text not null check (unit in ('fahrenheit', 'celsius')),
  -- The place's own date the high and low are for, and when the service's reading is from.
  for_date     date not null,
  observed_at  timestamptz not null,
  -- When FamilyWise last read it; a later read that failed, and why (null: the last read worked).
  read_at      timestamptz not null,
  failed_at    timestamptz,
  error        text check (error is null or length(error) <= 300),
  check ((failed_at is null) = (error is null))
);

alter table public.weather_reading enable row level security;
-- Admins read it (Home shows how the last read went); the board reads it (its snapshot).
create policy weather_reading_admin_select on public.weather_reading for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy weather_reading_device_select on public.weather_reading for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.weather_reading from public, anon, authenticated;
grant select on public.weather_reading to authenticated;

-- Who may store a reading: the weather job (service role), or an admin of the household (saving a
-- place reads the weather at once).
create function private.weather_writer(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.role()), '') = 'service_role'
      or p_household in (select private.admin_household_ids())
$$;

-- [BRD-04] An admin sets the household's place (null clears it), kept to two decimals. A new place
-- drops the old place's reading, so a board never shows one place's weather under another's name.
-- Definer's rights, after the admin check: admins only read weather_reading.
create function public.set_weather_place(p_household uuid, p_place text, p_latitude numeric,
                                         p_longitude numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_place text := nullif(btrim(p_place), '');
  v_lat   numeric := round(p_latitude, 2);
  v_lon   numeric := round(p_longitude, 2);
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_place is null then
    v_lat := null;
    v_lon := null;
  elsif v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180
        or length(v_place) > 120 then
    raise exception 'not a place' using errcode = '22023', hint = 'bad_place';
  end if;
  update public.household_settings
     set weather_place = v_place, weather_latitude = v_lat, weather_longitude = v_lon
   where household_id = p_household
     and (weather_place, weather_latitude, weather_longitude)
         is distinct from (v_place, v_lat, v_lon);
  if found then
    delete from public.weather_reading where household_id = p_household;
  end if;
end $$;

-- [BRD-04] An admin chooses °F or °C. The reading in the other unit goes; the next read brings one in
-- this unit (saving reads it at once).
create function public.set_temperature_unit(p_household uuid, p_unit text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_household is null or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_unit is null or p_unit not in ('fahrenheit', 'celsius') then
    raise exception 'not a temperature unit' using errcode = '22023', hint = 'bad_unit';
  end if;
  update public.household_settings set temperature_unit = p_unit
   where household_id = p_household and temperature_unit <> p_unit;
  if found then
    delete from public.weather_reading where household_id = p_household;
  end if;
end $$;

-- [BRD-04] Stores a read: {"ok": true, "latitude", "longitude", "unit", "temperature", "high", "low",
-- "weather_code", "is_day", "for_date", "observed_at"}, or {"ok": false, "error"}. A good read for a
-- place or unit the household no longer has (one that was in flight when an admin changed them) is
-- dropped. A failed read keeps the last good values and marks them, so the board stops showing them.
create function public.save_weather(p_household uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_set public.household_settings;
  v_now timestamptz := now();
begin
  if p_household is null or not private.weather_writer(p_household) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'a weather read is an object' using errcode = '22023', hint = 'bad_weather';
  end if;
  select * into v_set from public.household_settings where household_id = p_household;
  if not found or v_set.weather_place is null then
    return jsonb_build_object('status', 'no_place');
  end if;

  if (p_result ->> 'ok') is distinct from 'true' then
    update public.weather_reading
       set failed_at = v_now,
           error = left(coalesce(nullif(btrim(p_result ->> 'error'), ''), 'The weather couldn’t be read.'), 300)
     where household_id = p_household;
    return jsonb_build_object('status', 'error');
  end if;

  if round((p_result ->> 'latitude')::numeric, 2) is distinct from v_set.weather_latitude
     or round((p_result ->> 'longitude')::numeric, 2) is distinct from v_set.weather_longitude
     or (p_result ->> 'unit') is distinct from v_set.temperature_unit then
    return jsonb_build_object('status', 'stale');
  end if;

  begin
    insert into public.weather_reading (household_id, temperature, high, low, weather_code, is_day,
                                        unit, for_date, observed_at, read_at, failed_at, error)
    values (p_household,
            round((p_result ->> 'temperature')::numeric, 1),
            round((p_result ->> 'high')::numeric, 1),
            round((p_result ->> 'low')::numeric, 1),
            (p_result ->> 'weather_code')::smallint,
            (p_result ->> 'is_day')::boolean,
            p_result ->> 'unit',
            (p_result ->> 'for_date')::date,
            (p_result ->> 'observed_at')::timestamptz,
            v_now, null, null)
    on conflict (household_id) do update
       set temperature = excluded.temperature, high = excluded.high, low = excluded.low,
           weather_code = excluded.weather_code, is_day = excluded.is_day, unit = excluded.unit,
           for_date = excluded.for_date, observed_at = excluded.observed_at,
           read_at = excluded.read_at, failed_at = null, error = null;
  exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation
                 or check_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'not a weather read' using errcode = '22023', hint = 'bad_weather';
  end;
  return jsonb_build_object('status', 'ok');
end $$;

-- [BRD-05] A layout may say whether the weather shows ("weather": true | false; missing: it shows).
create or replace function private.valid_board_layout(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c    jsonb;
  seen text[] := '{}';
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if exists (select from jsonb_object_keys(p) k where k not in ('calendar', 'cards', 'weather')) then
    return false;
  end if;
  if p ? 'calendar' and (jsonb_typeof(p -> 'calendar') <> 'string'
                         or p ->> 'calendar' not in ('3', '5', '7', 'month')) then
    return false;
  end if;
  if p ? 'weather' and jsonb_typeof(p -> 'weather') <> 'boolean' then
    return false;
  end if;
  if p ? 'cards' then
    if jsonb_typeof(p -> 'cards') <> 'array' or jsonb_array_length(p -> 'cards') > 8 then
      return false;
    end if;
    for c in select e.value from jsonb_array_elements(p -> 'cards') e loop
      if jsonb_typeof(c) <> 'object' then
        return false;
      end if;
      if exists (select from jsonb_object_keys(c) k where k not in ('id', 'show')) then
        return false;
      end if;
      if jsonb_typeof(c -> 'id') is distinct from 'string'
         or jsonb_typeof(c -> 'show') is distinct from 'boolean' then
        return false;
      end if;
      if c ->> 'id' not in ('meals', 'goals', 'waiting', 'coming') or c ->> 'id' = any (seen) then
        return false;
      end if;
      seen := seen || (c ->> 'id');
    end loop;
  end if;
  return true;
end $$;

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
  -- yesterday through three weeks ahead (the dashboard's "Coming up", D-66).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 21);
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
    -- [BRD-05] The home screen's layout (D-67): the household's, and this board's own if it has one
    -- (a board without its own follows the household's). '{}' is the defaults. Since WP-45 a layout
    -- may also say whether the weather shows.
    'layout', jsonb_build_object(
      'household', coalesce((select s.board_layout from public.household_settings s
                              where s.household_id = v_household.id), '{}'::jsonb),
      'board', v_device.board_config -> 'layout'),
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
               -- [D-66] What "More info" opens on the board.
               'description', c.description,
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
    'calendar', public.board_calendar(v_from, v_to),
    -- [BRD-04] The weather at the household's place (WP-45, D-69): the last good reading while the
    -- last read worked and is under 75 minutes old (two reads every hour), else none: the board then
    -- shows no weather and nothing else changes.
    'weather', (select jsonb_build_object(
                         'temperature', w.temperature,
                         'high', w.high,
                         'low', w.low,
                         'code', w.weather_code,
                         'day', w.is_day,
                         'unit', w.unit,
                         'for_date', w.for_date,
                         'read_at', w.read_at)
                  from public.weather_reading w
                 where w.household_id = v_household.id
                   and w.failed_at is null
                   and w.read_at > now() - interval '75 minutes'));
end $$;

-- A new reading reaches the boards at once (notify-then-refetch, like the rest of the snapshot).
alter publication supabase_realtime add table public.weather_reading;

revoke all on function private.weather_writer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_weather_place(uuid, text, numeric, numeric),
  public.set_temperature_unit(uuid, text) from public, anon;
grant execute on function public.set_weather_place(uuid, text, numeric, numeric),
  public.set_temperature_unit(uuid, text) to authenticated;
revoke all on function public.save_weather(uuid, jsonb) from public, anon;
grant execute on function public.save_weather(uuid, jsonb) to authenticated, service_role;
