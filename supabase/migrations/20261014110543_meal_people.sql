-- [MEAL-10][US-708] A meal for any mix of people (WP-62, D-87). WP-25 let a planned meal be for
-- everyone or one person (`meal_plan_entry.member_id`); an entry is now for everyone or any set of
-- people:
--   * `meal_plan_entry_member`: an entry's people; no rows is everyone. Each entry's one person is
--     carried over. `meal_plan_entry.member_id` is emptied and held empty; the app deployed before
--     this one still reads it, so a later migration drops it (expand and contract, 01 §9).
--   * add_meal_entry() takes `member_ids` (a list; `member_id`, one, still works). The form sends
--     everyone ticked as everyone (lib/meals.ts).
--   * copy_meal_week() copies each entry's people with it.
--   * board_snapshot()'s `meals.entries[]` gains `member_ids`.

create table public.meal_plan_entry_member (
  household_id uuid not null references public.household (id) on delete cascade,
  entry_id     uuid not null,
  member_id    uuid not null,
  primary key (entry_id, member_id),
  foreign key (household_id, entry_id) references public.meal_plan_entry (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id)
);
create index on public.meal_plan_entry_member (member_id);
create index on public.meal_plan_entry_member (household_id);

-- Each entry's one person, carried over; the old column is then empty, and stays so. A function, so
-- pgTAP tests the carry-over itself (410_meal_people).
create function private.carry_meal_people() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
  select e.household_id, e.id, e.member_id from public.meal_plan_entry e where e.member_id is not null
  on conflict do nothing;
  get diagnostics v_n = row_count;
  update public.meal_plan_entry set member_id = null where member_id is not null;
  return v_n;
end $$;
revoke all on function private.carry_meal_people() from public, anon, authenticated;
select private.carry_meal_people();
alter table public.meal_plan_entry
  add constraint meal_plan_entry_member_id_moved check (member_id is null);
comment on column public.meal_plan_entry.member_id is
  'Unused since WP-62 (meal_plan_entry_member holds an entry''s people); dropped by a later migration.';

-- The household's parents and its boards read an entry's people; they are written only through the
-- functions below (and go with their entry).
alter table public.meal_plan_entry_member enable row level security;
create policy meal_plan_entry_member_admin_select on public.meal_plan_entry_member for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_plan_entry_member_device_select on public.meal_plan_entry_member for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.meal_plan_entry_member from public, anon, authenticated;
grant select on public.meal_plan_entry_member to authenticated;

create trigger trg_audit after insert or update or delete on public.meal_plan_entry_member
  for each row execute function private.audit_row();

-- Not in Realtime: an entry's people are written with it, in one transaction, and go with it, so
-- the entry's own change already tells the board.

-- [MEAL-01][MEAL-02][MEAL-08][MEAL-10] A parent adds one thing to a slot, last in it. p_entry: {id,
-- household_id, plan_date, slot, member_ids (none or empty: everyone), meal_id or free_text, notes};
-- a single `member_id` is read as a list of one. The same id again is the same entry (a form sent
-- twice adds one). A meal is the household's and not archived; so is each person.
create or replace function public.add_meal_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_household uuid;
  v_date      date;
  v_slot      text := p_entry ->> 'slot';
  v_members   uuid[];
  v_meal      uuid;
  v_text      text := nullif(btrim(p_entry ->> 'free_text'), '');
  v_notes     text := nullif(btrim(p_entry ->> 'notes'), '');
  e           public.meal_plan_entry;
begin
  begin
    v_id := (p_entry ->> 'id')::uuid;
    v_household := (p_entry ->> 'household_id')::uuid;
    v_date := (p_entry ->> 'plan_date')::date;
    v_meal := nullif(p_entry ->> 'meal_id', '')::uuid;
    if jsonb_typeof(p_entry -> 'member_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}') into v_members
        from jsonb_array_elements_text(p_entry -> 'member_ids') x;
    elsif p_entry -> 'member_ids' is not null and jsonb_typeof(p_entry -> 'member_ids') <> 'null' then
      raise exception 'bad entry' using errcode = '22023', hint = 'bad_request';
    else
      v_members := coalesce(array[nullif(p_entry ->> 'member_id', '')::uuid], '{}');
      v_members := array_remove(v_members, null);
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad entry' using errcode = '22023', hint = 'bad_request';
  end;
  perform private.meal_access(v_household);
  if v_id is null or v_date is null or v_slot is null or v_slot not in ('breakfast', 'snack', 'lunch', 'dinner') then
    raise exception 'a day and a meal' using errcode = '22023', hint = 'bad_request';
  end if;
  if (v_meal is null) = (v_text is null) then
    raise exception 'a meal from the library, or something written in' using errcode = '22023', hint = 'meal_or_text';
  end if;

  select * into e from public.meal_plan_entry where id = v_id;
  if found then
    if e.household_id <> v_household then
      raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
    end if;
    return jsonb_build_object('id', e.id, 'duplicate', true);
  end if;
  if v_meal is not null and not exists (select from public.meal m
                                         where m.id = v_meal and m.household_id = v_household
                                           and m.archived_at is null) then
    raise exception 'that meal isn''t in the library' using errcode = '22023', hint = 'meal_gone';
  end if;
  if exists (select from unnest(v_members) x (id)
              where not exists (select from public.member m
                                 where m.id = x.id and m.household_id = v_household and m.archived_at is null)) then
    raise exception 'not one of this family' using errcode = '22023', hint = 'member_gone';
  end if;

  insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, meal_id, free_text, notes,
                                      created_by)
  values (v_id, v_household, v_date, v_slot,
          coalesce((select max(sort_order) + 1 from public.meal_plan_entry
                     where household_id = v_household and plan_date = v_date and slot = v_slot), 1),
          v_meal, v_text, v_notes, auth.uid())
  on conflict (id) do nothing;
  if found then
    insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
    select v_household, v_id, x from unnest(v_members) x;
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- [MEAL-03][MEAL-10][US-702] As WP-25's, and each copy is for the same people as the entry it copies.
create or replace function public.copy_meal_week(p_household uuid, p_from date, p_to date, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_shift    integer := p_to - p_from;
  v_copied   integer := 0;
  v_skipped  integer := 0;
  v_replaced integer := 0;
  s          record;
  v_old      uuid[];
  v_new      uuid[];
begin
  perform private.meal_access(p_household);
  if p_from is null or p_to is null or p_mode is null or p_mode not in ('skip', 'overwrite') then
    raise exception 'two weeks, and skip or overwrite' using errcode = '22023', hint = 'bad_request';
  end if;
  if p_from = p_to then
    raise exception 'a week onto itself' using errcode = '22023', hint = 'same_week';
  end if;
  -- One copy at a time per household, so two at once don't both fill a slot.
  perform pg_advisory_xact_lock(hashtextextended('copy_meal_week:' || p_household, 0));

  for s in select distinct e.plan_date, e.slot
             from public.meal_plan_entry e
            where e.household_id = p_household and e.plan_date between p_from and p_from + 6
            order by e.plan_date, e.slot loop
    if exists (select from public.meal_plan_entry d
                where d.household_id = p_household and d.plan_date = s.plan_date + v_shift and d.slot = s.slot) then
      if p_mode = 'skip' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      delete from public.meal_plan_entry d
       where d.household_id = p_household and d.plan_date = s.plan_date + v_shift and d.slot = s.slot;
      v_replaced := v_replaced + 1;
    end if;
    -- The slot's entries in order, each with the id of its copy.
    select array_agg(e.id order by e.sort_order, e.created_at, e.id),
           array_agg(gen_random_uuid() order by e.sort_order, e.created_at, e.id)
      into v_old, v_new
      from public.meal_plan_entry e
     where e.household_id = p_household and e.plan_date = s.plan_date and e.slot = s.slot;
    insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, meal_id, free_text, notes,
                                        created_by)
    select x.new_id, p_household, e.plan_date + v_shift, e.slot, x.n, e.meal_id, e.free_text, e.notes, auth.uid()
      from unnest(v_old, v_new) with ordinality x (old_id, new_id, n)
      join public.meal_plan_entry e on e.id = x.old_id;
    insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
    select p_household, x.new_id, p.member_id
      from unnest(v_old, v_new) x (old_id, new_id)
      join public.meal_plan_entry_member p on p.entry_id = x.old_id;
    v_copied := v_copied + cardinality(v_old);
  end loop;
  return jsonb_build_object('copied', v_copied, 'skipped', v_skipped, 'replaced', v_replaced);
end $$;

-- The snapshot as of WP-28, with each meal's people.
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
      'text_size', coalesce(v_device.board_config ->> 'text_size', 'standard')),
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
