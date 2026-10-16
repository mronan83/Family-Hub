-- [DEV-07][US-207] WP-34: sleep and wake per board, and when a board counts as missed
-- (D-116, D-117). Each board keeps its choices in its own settings, beside its theme and text size:
--   board_config.sleep = {
--     "missed": "always" | "awake" | "never",        -- Home's "hasn't been seen" heads-up
--     "schedule": { "school":  {"sleep": "21:30", "wake": "06:30"},
--                   "weekend": {"sleep": "22:30", "wake": "07:30"} },   -- absent: no set times
--     "idle_minutes": 5 | 10 | 15 | 30 | 60 | 120 }  -- absent: never sleeps when untouched
-- A board without the key is missed Always, has no set times and never sleeps when untouched, as
-- before. Which night is which comes from the school year (school_days()): a night takes its times
-- from the day after it, so the night before a school day is a school night (D-117). The board
-- works out when it is asleep from its snapshot; the admin app works out the same for Boards and
-- Home. Saving is a plain update of board_config (the column grant and RLS allow it), checked here.

create function private.valid_night_times(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and not exists (select from jsonb_object_keys(p) k where k not in ('sleep', 'wake'))
     and jsonb_typeof(p -> 'sleep') = 'string' and jsonb_typeof(p -> 'wake') = 'string'
     and (p ->> 'sleep') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (p ->> 'wake') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (p ->> 'sleep') <> (p ->> 'wake')
$$;

create function private.valid_board_sleep(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if exists (select from jsonb_object_keys(p) k where k not in ('missed', 'schedule', 'idle_minutes')) then
    return false;
  end if;
  if p ? 'missed' and (jsonb_typeof(p -> 'missed') <> 'string'
                       or p ->> 'missed' not in ('always', 'awake', 'never')) then
    return false;
  end if;
  if p ? 'idle_minutes' and jsonb_typeof(p -> 'idle_minutes') <> 'null'
     and (jsonb_typeof(p -> 'idle_minutes') <> 'number'
          or (p ->> 'idle_minutes') not in ('5', '10', '15', '30', '60', '120')) then
    return false;
  end if;
  if p ? 'schedule' and jsonb_typeof(p -> 'schedule') <> 'null' then
    if jsonb_typeof(p -> 'schedule') <> 'object'
       or exists (select from jsonb_object_keys(p -> 'schedule') k where k not in ('school', 'weekend'))
       or not private.valid_night_times(p -> 'schedule' -> 'school')
       or not private.valid_night_times(p -> 'schedule' -> 'weekend') then
      return false;
    end if;
  end if;
  return true;
end $$;

alter table public.device add constraint device_board_config_sleep_valid
  check (private.valid_board_sleep(board_config -> 'sleep'));

-- [DEV-07] The household's school days from p_from to p_to: a day when any of its members has
-- school (resolve_day_type, SCH-02), so a child on a day off from school makes it a weekend night
-- only when no other child has school. A household with no school year at all has school Monday to
-- Friday. At most 400 days at a time. As the caller may see them (RLS: an admin, or a board).
create function public.school_days(p_household_id uuid, p_from date, p_to date)
returns setof date
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'school days cover 1 to 401 days' using errcode = '22023', hint = 'bad_range';
  end if;
  -- Only the household's admins and boards; anyone else sees no days (as RLS would show them).
  if p_household_id is null
     or (p_household_id not in (select private.admin_household_ids())
         and p_household_id is distinct from (select private.device_household_id())) then
    return;
  end if;
  if not exists (select from public.school_year y
                  where y.household_id = p_household_id and y.archived_at is null) then
    return query
      select d::date from generate_series(p_from, p_to, interval '1 day') d
       where extract(isodow from d) < 6
       order by 1;
    return;
  end if;
  return query
    select d::date from generate_series(p_from, p_to, interval '1 day') d
     where exists (select from public.member m
                    where m.household_id = p_household_id and m.archived_at is null
                      and public.resolve_day_type(m.id, d::date) = 'school_day')
     order by 1;
end $$;

revoke all on function private.valid_night_times(jsonb), private.valid_board_sleep(jsonb)
  from public, anon;
-- The check runs as whoever saves a board's settings.
grant execute on function private.valid_night_times(jsonb), private.valid_board_sleep(jsonb)
  to authenticated, service_role;
revoke all on function public.school_days(uuid, date, date) from public, anon;
grant execute on function public.school_days(uuid, date, date) to authenticated;

-- [DEV-07][US-207] The board's snapshot (WP-49), with the board's sleep and wake (WP-34): the
-- device's `sleep` settings, and `school_days`, the household's school days from yesterday to a
-- week ahead, so the board knows which night is a school night.
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
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto'),
      -- [BRD-08] Its text size (WP-47): the board zooms by it, on top of fitting its screen.
      'text_size', coalesce(v_device.board_config ->> 'text_size', 'standard'),
      -- [DEV-07] When it sleeps and wakes (WP-34, D-116): null until set.
      'sleep', v_device.board_config -> 'sleep'),
    -- [DEV-07] The household's school days from yesterday to a week ahead (WP-34): a night takes
    -- its sleep and wake times from the day after it.
    'school_days', jsonb_build_object(
      'from', v_today - 1,
      'to', v_today + 7,
      'days', coalesce((select jsonb_agg(d order by d)
                          from public.school_days(v_household.id, v_today - 1, v_today + 7) d),
                       '[]'::jsonb)),
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
               'opens', c.opens,
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
                   and w.read_at > now() - interval '75 minutes'),
    -- [MEAL-06][US-705] The household week's meals (WP-28, D-80): each day's breakfast, snack, lunch
    -- and dinner as planned on Meals, in order, for everyone or any set of people (WP-62); and each
    -- child's school lunch, buy or bring, with the school's menu on a buy day (lunch_week, WP-26 and
    -- WP-27).
    'meals', jsonb_build_object(
      'week_from', v_week,
      'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id,
                 'date', e.plan_date,
                 'slot', e.slot,
                 -- [MEAL-10] Who it's for (WP-62): member_ids, none for everyone; member_id is the one
                 -- person when there is exactly one, for a board still on the app before WP-62.
                 'member_id', (select case when count(*) = 1 then min(p.member_id::text)::uuid end
                                 from public.meal_plan_entry_member p where p.entry_id = e.id),
                 'member_ids', (select coalesce(jsonb_agg(p.member_id order by p.member_id), '[]'::jsonb)
                                  from public.meal_plan_entry_member p where p.entry_id = e.id),
                 'name', coalesce(ml.name, e.free_text),
                 'icon', ml.icon,
                 'notes', e.notes)
               order by e.plan_date, array_position(array['breakfast', 'snack', 'lunch', 'dinner'], e.slot),
                        e.sort_order, e.id)
          from public.meal_plan_entry e
          left join public.meal ml on ml.id = e.meal_id
         where e.household_id = v_household.id and e.plan_date between v_week and v_week + 6), '[]'::jsonb),
      'lunch', public.lunch_week(v_household.id, v_week)));
end $$;
