-- [RWD-15][RWD-16] Goals that repeat each week, month or school term (WP-80, D-101, D-123). A goal
-- can repeat (`repeats`): each household week, each calendar month, or each school term (the child's
-- school year, the family's default year for a family goal), from its start date to its end date or,
-- with no end date, until a parent stops it. The rules engine (ENGINE_VERSION 2) works out each
-- period on its own; the database keeps each period's outcome in `reward_goal_period`:
--   * a period won is achievement n + 1 of the goal and pays the goal's payout once (D-75's points,
--     or its shop reward to To give); undone by a reversed check-off, it takes back what it paid
--     once, and won again it pays again as the next n. The goal itself stays `active` until it ends;
--   * a new rule, DAYS_DUE ("every day it's due"), counts the days in the period when something in
--     scope is due, with 0 to 3 misses allowed (params.misses_allowed). Only on a repeating goal;
--   * how a goal repeats is fixed once it starts (D-123). A change to its rules counts from the
--     period going now, or from the next one when that one is already won (`periods_from`): a period
--     before it keeps its outcome and what it paid (D-115, read per period);
--   * stop_goal_after_period() ends a repeating goal on the last day of the period going now, so
--     that period still counts (D-123);
--   * each won period is celebrated once on a board (mark_goal_celebrated, per period).

alter table public.reward_goal
  add column repeats text not null default 'none' check (repeats in ('none', 'week', 'month', 'term')),
  -- Periods starting before this day keep the outcome they had when the rules last changed.
  add column periods_from date;

alter table public.reward_rule drop constraint reward_rule_rule_type_check;
alter table public.reward_rule add constraint reward_rule_rule_type_check
  check (rule_type in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS', 'DAYS_DUE'));

alter table public.reward_goal_event drop constraint reward_goal_event_type_check;
alter table public.reward_goal_event add constraint reward_goal_event_type_check
  check (type in ('created', 'edited', 'activated', 'rules_changed', 'recomputed', 'achieved', 'unachieved',
                  'payout_reversed', 'payout_restored', 'needs_review', 'redeemed', 'expired', 'cancelled',
                  'stopped'));

-- ---------------------------------------------------------------------------------------------
-- Each period of a repeating goal, as the engine last worked it out
-- ---------------------------------------------------------------------------------------------

create table public.reward_goal_period (
  household_id   uuid not null,
  goal_id        uuid not null,
  start_date     date not null,
  end_date       date not null check (end_date >= start_date),
  outcome        text not null check (outcome in ('open', 'won', 'missed', 'neutral')),
  next_start     date,                       -- the next period's first day, inside the goal's dates
  pct            numeric(5, 2) not null default 0 check (pct between 0 and 100),
  -- The first "every day it's due" rule's days: due, done, missed, and the misses allowed.
  days_due       integer check (days_due >= 0),
  days_done      integer check (days_done >= 0),
  days_missed    integer check (days_missed >= 0),
  misses_allowed integer check (misses_allowed between 0 and 3),
  -- A week's days: [{date, mark, day_type}] (day_type for a day with nothing due: weekend, no_school…).
  days           jsonb check (days is null or jsonb_typeof(days) = 'array'),
  n              integer check (n > 0),     -- the goal's achievement this period was (last) won as
  won_at         timestamptz,
  celebrated_at  timestamptz,
  computed_at    timestamptz not null default now(),
  primary key (goal_id, start_date),
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id) on delete cascade
);
create index on public.reward_goal_period (household_id);

alter table public.reward_goal_period enable row level security;
create policy reward_goal_period_admin_select on public.reward_goal_period for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_goal_period_device_select on public.reward_goal_period for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.reward_goal_period from public, anon;
revoke insert, update, delete, truncate on public.reward_goal_period from authenticated;
grant select on public.reward_goal_period to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The rules and the goal
-- ---------------------------------------------------------------------------------------------

-- WP-19's rule check, learning DAYS_DUE: only on a goal that repeats (hint rule_repeat), with its
-- misses allowed, 0 to 3 (default 0, hint rule_misses); its target is each period's days due, so it
-- is stored as 1. The rest is as before.
create function private.clean_goal_rules(p_household uuid, p_rules jsonb, p_repeats text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r        jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_type   text;
  v_target integer;
  v_scope  jsonb;
  v_tags   uuid[];
  v_items  uuid[];
  v_params jsonb;
  v_grace  integer;
begin
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) not between 1 and 5 then
    raise exception 'a goal has 1 to 5 rules' using errcode = '22023', hint = 'rules_count';
  end if;
  for r in select value from jsonb_array_elements(p_rules) loop
    v_type := r ->> 'type';
    if v_type is null or v_type not in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS', 'DAYS_DUE') then
      raise exception 'unknown rule type' using errcode = '22023', hint = 'rule_type';
    end if;
    if v_type = 'DAYS_DUE' then
      if coalesce(p_repeats, 'none') = 'none' then
        raise exception 'every day it''s due is for a goal that repeats' using errcode = '22023',
          hint = 'rule_repeat';
      end if;
      v_target := 1;
    else
      if coalesce(jsonb_typeof(r -> 'target'), '') <> 'number' or (r ->> 'target')::numeric not between 1 and 100000
         or (r ->> 'target')::numeric <> trunc((r ->> 'target')::numeric) then
        raise exception 'a target is a whole number from 1 to 100000' using errcode = '22023', hint = 'rule_target';
      end if;
      v_target := (r ->> 'target')::integer;
    end if;

    v_scope := coalesce(r -> 'scope', '{"all": true}'::jsonb);
    if (v_scope ->> 'all')::boolean is true then
      v_scope := '{"all": true}'::jsonb;
    else
      select coalesce(array_agg(distinct t.value::uuid order by t.value::uuid), '{}')
        into v_tags from jsonb_array_elements_text(coalesce(v_scope -> 'tag_ids', '[]')) t;
      select coalesce(array_agg(distinct c.value::uuid order by c.value::uuid), '{}')
        into v_items from jsonb_array_elements_text(coalesce(v_scope -> 'chore_ids', '[]')) c;
      if cardinality(v_tags) + cardinality(v_items) = 0 then
        raise exception 'choose what the rule counts' using errcode = '22023', hint = 'rule_scope';
      end if;
      if exists (select from unnest(v_tags) x where not exists (
                   select from public.tag t where t.id = x and t.household_id = p_household))
         or exists (select from unnest(v_items) x where not exists (
                   select from public.chore c where c.id = x and c.household_id = p_household)) then
        raise exception 'a tag or item is not this family''s' using errcode = '22023', hint = 'rule_scope';
      end if;
      v_scope := jsonb_strip_nulls(jsonb_build_object(
        'tag_ids', case when cardinality(v_tags) > 0 then to_jsonb(v_tags) end,
        'chore_ids', case when cardinality(v_items) > 0 then to_jsonb(v_items) end));
    end if;

    v_params := '{}'::jsonb;
    if v_type = 'STREAK' then
      if r -> 'params' ? 'grace_per_week' then
        if jsonb_typeof(r -> 'params' -> 'grace_per_week') <> 'number'
           or (r -> 'params' ->> 'grace_per_week')::numeric not in (0, 1, 2, 3) then
          raise exception 'misses forgiven a week: 0 to 3' using errcode = '22023', hint = 'rule_grace';
        end if;
        v_grace := (r -> 'params' ->> 'grace_per_week')::integer;
      else
        v_grace := 1;
      end if;
      v_params := jsonb_build_object('grace_per_week', v_grace);
    elsif v_type = 'DAYS_DUE' then
      if r -> 'params' ? 'misses_allowed' then
        if jsonb_typeof(r -> 'params' -> 'misses_allowed') <> 'number'
           or (r -> 'params' ->> 'misses_allowed')::numeric not in (0, 1, 2, 3) then
          raise exception 'misses allowed: 0 to 3' using errcode = '22023', hint = 'rule_misses';
        end if;
        v_grace := (r -> 'params' ->> 'misses_allowed')::integer;
      else
        v_grace := 0;
      end if;
      v_params := jsonb_build_object('misses_allowed', v_grace);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', v_type, 'target', v_target, 'scope', v_scope, 'params', v_params));
  end loop;
  return v_out;
end $$;

-- [RWD-01][RWD-02][RWD-03][RWD-13][RWD-15] save_goal (WP-79's) learns `repeats` ('none', 'week',
-- 'month', 'term'; left out, a goal keeps its own, a new one 'none'). It is fixed once the goal has
-- started (hint repeat_fixed). A repeating goal is never `achieved` as a whole, so the reached lock
-- doesn't apply to it; instead, a change to its rules or logic counts from the period going now, or
-- from the next one when that one is already won (`periods_from`). The rest is as before.
create or replace function public.save_goal(p_goal jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_household uuid;
  v_member    uuid := nullif(p_goal ->> 'member_id', '')::uuid;
  v_old       public.reward_goal;
  v_rules     jsonb;
  v_old_rules jsonb;
  v_payout    jsonb;
  v_start     date := (p_goal ->> 'start_date')::date;
  v_end       date := nullif(p_goal ->> 'end_date', '')::date;
  v_logic     text := coalesce(p_goal ->> 'rule_logic', 'all');
  v_repeats   text;
  v_changed   boolean;
  v_new       boolean;
  v_today     date;
  v_from      date;
  v_now       public.reward_goal_period;
begin
  begin
    v_id := (p_goal ->> 'id')::uuid;
    v_household := (p_goal ->> 'household_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'bad goal' using errcode = '22023', hint = 'bad_request';
  end;
  if v_uid is null or v_household is null or v_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_id is null or v_start is null then
    raise exception 'a goal needs an id and a start date' using errcode = '22023', hint = 'bad_request';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'it ends before it starts' using errcode = '22023', hint = 'end_before_start';
  end if;
  if v_logic not in ('all', 'any') then
    raise exception 'all or any' using errcode = '22023', hint = 'bad_request';
  end if;
  if v_member is not null and not exists (
       select from public.member m where m.id = v_member and m.household_id = v_household
          and m.archived_at is null and m.earns_rewards) then
    raise exception 'goals are for someone who earns rewards, or the whole family'
      using errcode = '22023', hint = 'not_earning';
  end if;

  select * into v_old from public.reward_goal where id = v_id for update;
  v_new := not found;
  if not v_new and v_old.household_id <> v_household then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_repeats := coalesce(p_goal ->> 'repeat', case when v_new then 'none' else v_old.repeats end);
  if v_repeats not in ('none', 'week', 'month', 'term') then
    raise exception 'repeats each week, month or term, or not at all' using errcode = '22023', hint = 'repeat';
  end if;
  v_rules := private.clean_goal_rules(v_household, p_goal -> 'rules', v_repeats);
  v_payout := private.clean_goal_payout(v_household, v_member,
                                        case when p_goal ? 'payout' or v_new then p_goal -> 'payout'
                                             else v_old.payout end,
                                        case when v_new then null else v_old.payout end);

  if v_new then
    insert into public.reward_goal (id, household_id, member_id, title, description, icon, image_path,
                                    payout, start_date, end_date, rule_logic, repeats, created_by)
    values (v_id, v_household, v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
            coalesce(p_goal ->> 'icon', 'trophy'), p_goal ->> 'image_path', v_payout, v_start, v_end, v_logic,
            v_repeats, v_uid);
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', r.ordinality::integer
      from jsonb_array_elements(v_rules) with ordinality r;
    insert into public.reward_goal_progress (goal_id, household_id) values (v_id, v_household);
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'created', 'admin', v_uid,
            jsonb_build_object('member_id', v_member, 'start_date', v_start, 'end_date', v_end,
                               'rule_logic', v_logic, 'rules', v_rules, 'payout', v_payout,
                               'repeat', v_repeats));
    return jsonb_build_object('id', v_id, 'created', true, 'rules_changed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', r.rule_type, 'target', r.target, 'scope', r.scope,
                                               'params', r.params) order by r.sort_order, r.id), '[]')
    into v_old_rules from public.reward_rule r where r.goal_id = v_id;
  v_changed := (v_old.start_date, v_old.end_date, v_old.rule_logic, v_old_rules, v_old.repeats)
               is distinct from (v_start, v_end, v_logic, v_rules, v_repeats);

  if v_old.status in ('redeemed', 'expired', 'cancelled')
     and (v_changed or v_member is distinct from v_old.member_id or v_payout is distinct from v_old.payout) then
    raise exception 'a finished goal keeps its rules' using errcode = '22023', hint = 'goal_closed';
  end if;
  if v_old.status = 'achieved'
     and (v_changed or v_member is distinct from v_old.member_id or v_payout is distinct from v_old.payout) then
    raise exception 'a reached goal keeps its rules' using errcode = '22023', hint = 'goal_achieved';
  end if;
  if v_old.status not in ('draft', 'scheduled')
     and (v_member is distinct from v_old.member_id or v_start <> v_old.start_date) then
    raise exception 'a started goal keeps its person and start date' using errcode = '22023', hint = 'goal_started';
  end if;
  if v_old.status not in ('draft', 'scheduled') and v_repeats <> v_old.repeats then
    raise exception 'a started goal keeps how it repeats' using errcode = '22023', hint = 'repeat_fixed';
  end if;
  v_today := private.household_today(v_household);
  if v_old.status not in ('draft', 'scheduled') and v_end is distinct from v_old.end_date and v_end < v_today then
    raise exception 'a started goal ends today or later' using errcode = '22023', hint = 'end_in_past';
  end if;

  -- [RWD-15][D-115] A started repeating goal's new rules count from the period going now, or the next
  -- one when that is already won; the periods before keep what they were.
  v_from := v_old.periods_from;
  if v_repeats <> 'none' and v_old.status not in ('draft', 'scheduled')
     and (v_old.rule_logic, v_old_rules) is distinct from (v_logic, v_rules) then
    select * into v_now from public.reward_goal_period p
     where p.goal_id = v_id and p.start_date <= v_today and p.end_date >= v_today;
    v_from := case when v_now.goal_id is null then v_today
                   when v_now.outcome = 'won' then v_now.end_date + 1
                   else v_now.start_date end;
  end if;

  update public.reward_goal
     set member_id = v_member, title = btrim(p_goal ->> 'title'),
         description = nullif(btrim(p_goal ->> 'description'), ''),
         icon = coalesce(p_goal ->> 'icon', icon),
         image_path = case when p_goal ? 'image_path' then p_goal ->> 'image_path' else image_path end,
         payout = v_payout,
         start_date = v_start, end_date = v_end, rule_logic = v_logic, repeats = v_repeats,
         periods_from = v_from,
         rules_version = rules_version + case when v_changed then 1 else 0 end,
         updated_at = now()
   where id = v_id
     and (v_changed
          or (member_id, title, description, icon, image_path, payout, start_date, end_date, rule_logic)
             is distinct from (v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
                               coalesce(p_goal ->> 'icon', icon),
                               case when p_goal ? 'image_path' then p_goal ->> 'image_path' else image_path end,
                               v_payout, v_start, v_end, v_logic));
  if not found then
    return jsonb_build_object('id', v_id, 'created', false, 'rules_changed', false);
  end if;

  if v_changed then
    delete from public.reward_rule where goal_id = v_id;
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', r.ordinality::integer
      from jsonb_array_elements(v_rules) with ordinality r;
    update public.reward_goal_progress set dirty = true, marked_at = clock_timestamp() where goal_id = v_id;
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'rules_changed', 'admin', v_uid,
            jsonb_build_object('from', jsonb_build_object('start_date', v_old.start_date, 'end_date', v_old.end_date,
                                                          'rule_logic', v_old.rule_logic, 'rules', v_old_rules,
                                                          'repeat', v_old.repeats),
                               'to', jsonb_build_object('start_date', v_start, 'end_date', v_end,
                                                        'rule_logic', v_logic, 'rules', v_rules,
                                                        'repeat', v_repeats))
            || case when v_from is distinct from v_old.periods_from
                    then jsonb_build_object('counts_from', v_from) else '{}'::jsonb end
            || case when v_payout is distinct from v_old.payout
                    then jsonb_build_object('payout', jsonb_build_object('from', v_old.payout, 'to', v_payout))
                    else '{}'::jsonb end);
  else
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'edited', 'admin', v_uid,
            case when v_payout is distinct from v_old.payout
                 then jsonb_build_object('payout', jsonb_build_object('from', v_old.payout, 'to', v_payout))
                 else '{}'::jsonb end);
  end if;
  return jsonb_build_object('id', v_id, 'created', false, 'rules_changed', v_changed);
end $$;

drop function private.clean_goal_rules(uuid, jsonb);

-- [RWD-15][D-123] A parent stops a repeating goal after the period going now: its end date becomes
-- that period's last day (today, between terms), so the period still counts and pays. Safe to send
-- twice. Only a started repeating goal that is still going (hint not_repeating, not_started).
create function public.stop_goal_after_period(p_goal uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  g       public.reward_goal;
  v_today date;
  v_end   date;
begin
  select * into g from public.reward_goal where id = p_goal for update;
  if v_uid is null or not found or g.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if g.repeats = 'none' then
    raise exception 'only a repeating goal stops after a period' using errcode = '22023', hint = 'not_repeating';
  end if;
  if g.status <> 'active' then
    raise exception 'only a goal that is going stops after this period' using errcode = '22023',
      hint = 'not_started';
  end if;
  v_today := private.household_today(g.household_id);
  select p.end_date into v_end from public.reward_goal_period p
   where p.goal_id = g.id and p.start_date <= v_today and p.end_date >= v_today;
  v_end := coalesce(v_end, v_today);
  if g.end_date is not null and g.end_date <= v_end then
    return jsonb_build_object('id', g.id, 'end_date', g.end_date, 'duplicate', true);
  end if;
  update public.reward_goal set end_date = v_end, updated_at = now() where id = g.id;
  update public.reward_goal_progress set dirty = true, marked_at = clock_timestamp() where goal_id = g.id;
  insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
  values (g.household_id, g.id, 'stopped', 'admin', v_uid,
          jsonb_build_object('from', g.end_date, 'end_date', v_end));
  return jsonb_build_object('id', g.id, 'end_date', v_end, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- What the engine reads
-- ---------------------------------------------------------------------------------------------

-- [RWD-15] The school terms a goal's periods follow: for a child, the terms of the school year they
-- follow when each term starts; for the family, the household's default year's.
create function private.goal_terms(p_household uuid, p_member uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('start_date', t.start_date, 'end_date', t.end_date)
                            order by t.start_date, t.end_date), '[]'::jsonb)
    from public.school_term t
    join public.school_year y on y.id = t.school_year_id
   where t.household_id = p_household and y.archived_at is null
     and case when p_member is null then y.is_default
              else public.member_school_year(p_member, t.start_date) = y.id end
$$;

-- goal_facts (WP-39's) learns repeating goals: the goal's `repeat`, the `terms` a term goal follows,
-- and for a repeating goal the facts up to 14 days ahead (as far as chores are planned), so a period
-- going now knows its days due. The rest is as before.
create or replace function public.goal_facts(p_goal uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g       public.reward_goal;
  v_today date;
  v_week  integer;
  v_to    date;
begin
  select * into g from public.reward_goal where id = p_goal;
  if not found then
    raise exception 'no such goal' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.goal_access(g.household_id);
  v_today := private.household_today(g.household_id);
  select h.week_start into v_week from public.household h where h.id = g.household_id;
  v_to := case when g.repeats = 'none' then least(coalesce(g.end_date, v_today), v_today)
               else least(coalesce(g.end_date, v_today + 14), v_today + 14) end;
  return jsonb_build_object(
    'read_at', clock_timestamp(),
    'as_of', v_today,
    'week_start', v_week,
    'rules_version', g.rules_version,
    'goal', jsonb_build_object('id', g.id, 'member_id', g.member_id, 'start_date', g.start_date,
                               'end_date', g.end_date, 'rule_logic', g.rule_logic, 'status', g.status,
                               'repeat', g.repeats),
    'terms', case when g.repeats = 'term' then private.goal_terms(g.household_id, g.member_id)
                  else '[]'::jsonb end,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.rule_type, 'target', r.target,
                                          'scope', r.scope, 'params', r.params) order by r.sort_order, r.id)
        from public.reward_rule r where r.goal_id = g.id), '[]'::jsonb),
    'facts', private.goal_facts_between(g.household_id, g.member_id, g.start_date, v_to));
end $$;

-- goal_preview_facts (WP-39's) learns p_goal's `repeat`: a repeating goal's facts reach 14 days
-- ahead and a term goal's terms come with them, as goal_facts reads them.
create or replace function public.goal_preview_facts(p_goal jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household uuid;
  v_id        uuid;
  v_member    uuid;
  v_start     date;
  v_end       date;
  v_status    text;
  v_today     date;
  v_week      integer;
  v_repeats   text := coalesce(p_goal ->> 'repeat', 'none');
begin
  begin
    v_household := (p_goal ->> 'household_id')::uuid;
    v_id := nullif(p_goal ->> 'id', '')::uuid;
    v_member := nullif(p_goal ->> 'member_id', '')::uuid;
    v_start := (p_goal ->> 'start_date')::date;
    v_end := nullif(p_goal ->> 'end_date', '')::date;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad goal' using errcode = '22023', hint = 'bad_request';
  end;
  if auth.uid() is null or v_household is null or v_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_start is null or (v_end is not null and v_end < v_start)
     or v_repeats not in ('none', 'week', 'month', 'term') then
    raise exception 'a start, and an end not before it' using errcode = '22023', hint = 'bad_request';
  end if;
  if v_member is not null and not exists (select from public.member m
                                           where m.id = v_member and m.household_id = v_household) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select g.status into v_status from public.reward_goal g where g.id = v_id and g.household_id = v_household;
  v_today := private.household_today(v_household);
  select h.week_start into v_week from public.household h where h.id = v_household;
  return jsonb_build_object(
    'as_of', v_today,
    'week_start', v_week,
    'status', coalesce(v_status, 'scheduled'),
    'saved', v_status is not null,
    'terms', case when v_repeats = 'term' then private.goal_terms(v_household, v_member) else '[]'::jsonb end,
    'facts', private.goal_facts_between(v_household, v_member, v_start,
                                        case when v_repeats = 'none' then least(coalesce(v_end, v_today), v_today)
                                             else least(coalesce(v_end, v_today + 14), v_today + 14) end));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Saving an evaluation: each period's outcome, paid and taken back once
-- ---------------------------------------------------------------------------------------------

-- A day of a week with nothing due, named by its day type (weekend, no_school, break, summer…), so
-- the board can say "no school Friday". A family goal reads the household's default school year.
create function private.goal_day_type(p_household uuid, p_member uuid, p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_member is not null then public.resolve_day_type(p_member, p_date)
              else public.school_day_type((select y.id from public.school_year y
                                             where y.household_id = p_household and y.is_default
                                               and y.archived_at is null
                                               and p_date between y.start_date and y.end_date
                                             limit 1), p_date) end
$$;

-- [RWD-15][RWD-16][RWD-04][RWD-13] A repeating goal's periods as the engine worked them out
-- (p_evaluation.periods): each stored with its outcome. A period newly won is the goal's next
-- achievement (n + 1) and pays its payout (`achieved`, with the period); a won period no longer won
-- takes back what it paid (`unachieved`, `payout_reversed`, or the review flag for a shop reward
-- already given). A period starting before `periods_from` that is stored already keeps what it is
-- (its rules changed after it). A stored period the engine no longer has (the goal's dates moved)
-- goes, unless it was won.
create function private.save_goal_periods(g public.reward_goal, p_periods jsonb, p_pct numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  per     record;
  v_old   public.reward_goal_period;
  v_n     integer;
  v_won   timestamptz;
  v_paid  jsonb;
  v_back  jsonb;
  v_days  jsonb;
  v_span  jsonb;
begin
  if jsonb_typeof(p_periods) is distinct from 'array' then
    raise exception 'a repeating goal''s evaluation has its periods' using errcode = '22023', hint = 'bad_request';
  end if;
  for per in select * from jsonb_to_recordset(p_periods)
               x (start date, "end" date, outcome text, next_start date, pct numeric, days_due integer,
                  days_done integer, days_missed integer, misses_allowed integer, days jsonb)
             order by start loop
    select * into v_old from public.reward_goal_period p where p.goal_id = g.id and p.start_date = per.start;
    if v_old.goal_id is not null and g.periods_from is not null and per.start < g.periods_from then
      continue;
    end if;
    v_n := v_old.n;
    v_won := v_old.won_at;
    v_span := jsonb_build_object('period_start', per.start, 'period_end', per."end");
    if per.outcome = 'won' and v_old.outcome is distinct from 'won' then
      v_n := g.achievement_count + 1;
      v_won := now();
      update public.reward_goal set achievement_count = v_n, updated_at = now() where id = g.id;
      g.achievement_count := v_n;
      v_paid := private.pay_goal(g, v_n);
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'achieved', 'system',
              jsonb_build_object('n', v_n, 'pct', per.pct, 'paid', v_paid) || v_span);
    elsif v_old.outcome = 'won' and per.outcome <> 'won' then
      v_won := null;
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'unachieved', 'system', jsonb_build_object('n', v_n, 'pct', per.pct) || v_span);
      v_back := private.take_back_goal(g, v_n);
      if (v_back ->> 'points')::integer > 0 or v_back ->> 'item' = 'called_off' then
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'payout_reversed', 'system', jsonb_build_object('n', v_n) || v_back || v_span);
      end if;
      if v_back ->> 'item' = 'given' then
        perform private.flag_goal(g, 'reward_given', p_pct);
      end if;
    end if;
    select jsonb_agg(d.value || case when d.value ->> 'mark' = 'none'
                                     then jsonb_build_object('day_type', private.goal_day_type(
                                            g.household_id, g.member_id, (d.value ->> 'date')::date))
                                     else '{}'::jsonb end
                     order by d.ordinality)
      into v_days from jsonb_array_elements(case when jsonb_typeof(per.days) = 'array' then per.days
                                                 else '[]'::jsonb end) with ordinality d;
    insert into public.reward_goal_period as p (household_id, goal_id, start_date, end_date, outcome, next_start,
                                                pct, days_due, days_done, days_missed, misses_allowed, days, n,
                                                won_at, celebrated_at)
    values (g.household_id, g.id, per.start, per."end", per.outcome, per.next_start,
            round(least(greatest(coalesce(per.pct, 0), 0), 100), 2), per.days_due, per.days_done, per.days_missed,
            per.misses_allowed, v_days, v_n, v_won, null)
    on conflict (goal_id, start_date) do update
       set end_date = excluded.end_date, outcome = excluded.outcome, next_start = excluded.next_start,
           pct = excluded.pct, days_due = excluded.days_due, days_done = excluded.days_done,
           days_missed = excluded.days_missed, misses_allowed = excluded.misses_allowed, days = excluded.days,
           n = excluded.n, won_at = excluded.won_at,
           celebrated_at = case when p.n is distinct from excluded.n then null else p.celebrated_at end,
           computed_at = now()
     where (p.end_date, p.outcome, p.next_start, p.pct, p.days_due, p.days_done, p.days_missed,
            p.misses_allowed, p.days, p.n, p.won_at)
           is distinct from (excluded.end_date, excluded.outcome, excluded.next_start, excluded.pct,
                             excluded.days_due, excluded.days_done, excluded.days_missed, excluded.misses_allowed,
                             excluded.days, excluded.n, excluded.won_at);
  end loop;
  delete from public.reward_goal_period p
   where p.goal_id = g.id and p.outcome <> 'won'
     and (g.periods_from is null or p.start_date >= g.periods_from)
     and p.start_date not in (select (x.value ->> 'start')::date from jsonb_array_elements(p_periods) x);
end $$;

-- [RWD-04][RWD-06][RWD-13][RWD-15] save_goal_evaluation (WP-39's) learns repeating goals: their
-- periods are saved (save_goal_periods) in the same transaction as the progress, after the status
-- changes (a repeating goal only starts and ends). The rest is as before.
create or replace function public.save_goal_evaluation(
  p_goal uuid, p_status text, p_rules_version integer, p_evaluation jsonb, p_engine_version integer,
  p_read_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g       public.reward_goal;
  v_prev  public.reward_goal_progress;
  v_pct   numeric(5, 2);
  v_met   boolean;
  t       jsonb;
  v_n     integer;
  v_done  jsonb := '[]'::jsonb;
  v_paid  jsonb;
  v_back  jsonb;
  v_moved integer;
begin
  select * into g from public.reward_goal where id = p_goal for update;
  if not found then
    raise exception 'no such goal' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.goal_access(g.household_id);
  if jsonb_typeof(p_evaluation -> 'rules') <> 'array' or jsonb_typeof(p_evaluation -> 'transitions') <> 'array'
     or jsonb_typeof(p_evaluation -> 'pct') <> 'number' or jsonb_typeof(p_evaluation -> 'is_achieved') <> 'boolean'
     or p_engine_version is null or p_engine_version < 1 then
    raise exception 'an evaluation has rules, transitions, pct and is_achieved'
      using errcode = '22023', hint = 'bad_request';
  end if;
  if g.status <> p_status or g.rules_version <> p_rules_version then
    return jsonb_build_object('saved', false, 'reason', 'changed', 'status', g.status);
  end if;
  v_pct := round((p_evaluation ->> 'pct')::numeric, 2);
  v_met := (p_evaluation ->> 'is_achieved')::boolean;

  insert into public.reward_rule_progress as rp (rule_id, household_id, goal_id, current_value, target_value,
         pct, current_streak, best_streak, last_qualifying_date, is_met, engine_version)
  select r.rule_id, g.household_id, g.id, r.current_value, r.target_value, round(r.pct, 2), r.current_streak,
         r.best_streak, r.last_qualifying_date, r.is_met, p_engine_version
    from jsonb_to_recordset(p_evaluation -> 'rules')
           r (rule_id uuid, current_value integer, target_value integer, pct numeric, current_streak integer,
              best_streak integer, last_qualifying_date date, is_met boolean)
    join public.reward_rule rr on rr.id = r.rule_id and rr.goal_id = g.id
  on conflict (rule_id) do update
     set current_value = excluded.current_value, target_value = excluded.target_value, pct = excluded.pct,
         current_streak = excluded.current_streak, best_streak = excluded.best_streak,
         last_qualifying_date = excluded.last_qualifying_date, is_met = excluded.is_met,
         engine_version = excluded.engine_version, computed_at = now()
   where (rp.current_value, rp.target_value, rp.pct, rp.current_streak, rp.best_streak,
          rp.last_qualifying_date, rp.is_met, rp.engine_version)
         is distinct from (excluded.current_value, excluded.target_value, excluded.pct, excluded.current_streak,
          excluded.best_streak, excluded.last_qualifying_date, excluded.is_met, excluded.engine_version);

  select * into v_prev from public.reward_goal_progress where goal_id = g.id;
  if v_prev.goal_id is not null and v_prev.computed_at is not null and v_prev.rules_version <> p_rules_version then
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
    values (g.household_id, g.id, 'recomputed', 'system',
            jsonb_build_object('rules_version', p_rules_version, 'from_pct', v_prev.pct, 'to_pct', v_pct,
                               'from_achieved', v_prev.is_achieved, 'to_achieved', v_met));
  end if;
  insert into public.reward_goal_progress as p (goal_id, household_id, pct, is_achieved, dirty, rules_version,
                                                engine_version, computed_at)
  values (g.id, g.household_id, v_pct, v_met, false, p_rules_version, p_engine_version, now())
  on conflict (goal_id) do update
     set pct = excluded.pct, is_achieved = excluded.is_achieved, rules_version = excluded.rules_version,
         engine_version = excluded.engine_version, computed_at = now(),
         dirty = p.marked_at > p_read_at;

  for t in select value from jsonb_array_elements(p_evaluation -> 'transitions') loop
    exit when t ->> 'from' is distinct from g.status;
    case t ->> 'type'
      when 'started' then
        update public.reward_goal set status = 'active', updated_at = now() where id = g.id;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type)
        values (g.household_id, g.id, 'activated', 'system');
      when 'achieved' then
        v_n := g.achievement_count + 1;
        update public.reward_goal
           set status = 'achieved', achievement_count = v_n, achieved_at = now(), celebrated_at = null,
               updated_at = now()
         where id = g.id;
        g.achievement_count := v_n;
        v_paid := private.pay_goal(g, v_n);
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'achieved', 'system', jsonb_build_object('n', v_n, 'pct', v_pct, 'paid', v_paid));
      when 'unachieved' then
        update public.reward_goal
           set status = 'active', achieved_at = null, celebrated_at = null, updated_at = now()
         where id = g.id;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'unachieved', 'system',
                jsonb_build_object('n', g.achievement_count, 'pct', v_pct));
        v_back := private.take_back_goal(g, g.achievement_count);
        if (v_back ->> 'points')::integer > 0 or v_back ->> 'item' = 'called_off' then
          insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
          values (g.household_id, g.id, 'payout_reversed', 'system',
                  jsonb_build_object('n', g.achievement_count) || v_back);
        end if;
        if v_back ->> 'item' = 'given' then
          perform private.flag_goal(g, 'reward_given', v_pct);
          g.needs_review := true;
        end if;
      when 'expired' then
        update public.reward_goal set status = 'expired', updated_at = now() where id = g.id;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'expired', 'system', jsonb_build_object('pct', v_pct));
      when 'needs_review' then
        -- A redeemed goal no longer met: once, when it stops being met.
        if v_prev.is_achieved is distinct from false then
          perform private.flag_goal(g, 'undone', v_pct);
          g.needs_review := true;
          v_moved := private.settle_goal_points(g, g.achievement_count, false);
          if v_moved <> 0 then
            insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
            values (g.household_id, g.id, 'payout_reversed', 'system',
                    jsonb_build_object('n', g.achievement_count, 'points', -v_moved));
          end if;
        end if;
      else
        raise exception 'unknown transition' using errcode = '22023', hint = 'bad_request';
    end case;
    v_done := v_done || jsonb_build_array(t ->> 'type');
    g.status := t ->> 'to';
  end loop;

  -- A redeemed goal met again: the points taken back go back.
  if g.status = 'redeemed' and v_met and v_prev.is_achieved is false then
    v_moved := private.settle_goal_points(g, g.achievement_count, true);
    if v_moved <> 0 then
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'payout_restored', 'system',
              jsonb_build_object('n', g.achievement_count, 'points', v_moved));
    end if;
  end if;

  if g.repeats <> 'none' then
    perform private.save_goal_periods(g, p_evaluation -> 'periods', v_pct);
  end if;

  return jsonb_build_object('saved', true, 'status', g.status, 'pct', v_pct, 'is_achieved', v_met,
                            'transitions', v_done);
end $$;

-- [RWD-08][US-404][RWD-15] mark_goal_celebrated (WP-20's) learns repeating goals: achievement `p_n`
-- is a won period, celebrated once. The rest is as before.
create or replace function public.mark_goal_celebrated(p_goal uuid, p_n integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  g public.reward_goal;
begin
  if p_goal is null or p_n is null then
    raise exception 'say which goal and which time it was reached' using errcode = '22023', hint = 'bad_request';
  end if;
  select * into g from public.reward_goal where id = p_goal for update;
  if not found
     or not (g.household_id = (select private.device_household_id())
             or g.household_id in (select private.admin_household_ids())) then
    raise exception 'goal not found' using errcode = 'P0002', hint = 'goal_not_found';
  end if;
  if g.repeats <> 'none' then
    update public.reward_goal_period p set celebrated_at = now()
     where p.goal_id = g.id and p.n = p_n and p.outcome = 'won' and p.celebrated_at is null;
    return found;
  end if;
  if g.status <> 'achieved' or g.achievement_count <> p_n or g.celebrated_at is not null then
    return false;
  end if;
  update public.reward_goal set celebrated_at = now() where id = g.id;
  return true;
end $$;

-- A won period's celebration tells the board to read again.
alter publication supabase_realtime add table public.reward_goal_period;

revoke all on function private.clean_goal_rules(uuid, jsonb, text), private.goal_terms(uuid, uuid),
  private.goal_day_type(uuid, uuid, date), private.save_goal_periods(public.reward_goal, jsonb, numeric)
  from public, anon, authenticated;
revoke all on function public.stop_goal_after_period(uuid) from public, anon;
grant execute on function public.stop_goal_after_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board's snapshot (WP-34's), whose goals learn repeating goals
-- ---------------------------------------------------------------------------------------------

-- [RWD-07][RWD-08][RWD-15][RWD-16] board_snapshot as WP-34 left it; each goal now says how it repeats,
-- its period going now (or its last: outcome, next start, the days due, done and missed, and a week's
-- day marks), its last five periods and the points a period pays; a repeating goal is celebrated for
-- each won period, as n.
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
               'n', coalesce(w.n, g.achievement_count),
               'achieved_at', coalesce(w.won_at, g.achieved_at),
               'celebrate', case when g.repeats = 'none' then g.status = 'achieved' and g.celebrated_at is null
                                 else w.n is not null end,
               'end_date', g.end_date,
               -- [RWD-15][RWD-16] A repeating goal's period going now (or its last) and its last five.
               'repeat', g.repeats,
               'pays', case when g.payout ->> 'type' = 'points' then (g.payout ->> 'amount')::integer end,
               'period', (select jsonb_build_object('start', c.start_date, 'end', c.end_date, 'outcome', c.outcome,
                                                    'next_start', c.next_start, 'days_due', c.days_due,
                                                    'days_done', c.days_done, 'days_missed', c.days_missed,
                                                    'misses_allowed', c.misses_allowed, 'days', c.days)
                            from public.reward_goal_period c
                           where c.goal_id = g.id and c.start_date <= v_today
                           order by c.start_date desc limit 1),
               'history', (select coalesce(jsonb_agg(jsonb_build_object('start', hp.start_date, 'end', hp.end_date,
                                                                        'outcome', hp.outcome)
                                                     order by hp.start_date), '[]'::jsonb)
                             from (select * from public.reward_goal_period hp0
                                    where hp0.goal_id = g.id and hp0.start_date <= v_today
                                    order by hp0.start_date desc limit 5) hp),
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
        -- A repeating goal's won period that no board has celebrated yet, the latest first.
        left join lateral (select wp.n, wp.won_at from public.reward_goal_period wp
                            where wp.goal_id = g.id and wp.outcome = 'won' and wp.celebrated_at is null
                            order by wp.won_at desc limit 1) w on true
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
