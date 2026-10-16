-- [RWD-19][RWD-20] Perfect periods, and a family goal every child meets (WP-82, D-103, D-126). On top of
-- WP-80's repeating goals and WP-81's steps (ENGINE_VERSION 4):
--   * a rule can count the periods another goal was won (PERIODS_WON): params.goal_id, a repeating goal
--     of the same person (or the family's), not this one and not one that counts periods itself, and
--     params.in_a_row, in total or in a row. Only periods that start on or after the counting goal's
--     start date count (D-126); a period with nothing due neither counts nor breaks a run, a lost one
--     breaks it. A period of the counted goal won or lost marks the goals counting it, and they are
--     worked out after it. Reached, the counting goal pays its own payout, apart from what each period
--     paid (D-123);
--   * a family goal can need every child to meet it (reward_goal.each_child): each child who earns
--     rewards is worked out on their own, and the goal (each period) is won when every child with
--     something due wins it. It pays only the children who had something due (D-126). It is fixed once
--     the goal starts, has no steps and counts no other goal's periods (D-126). Each child's progress is
--     kept (reward_goal_period.children, reward_goal_progress.children) and is on the board.

alter table public.reward_goal
  add column each_child boolean not null default false,
  add constraint reward_goal_each_child_family check (not each_child or member_id is null);
alter table public.reward_goal_period
  add column children jsonb check (children is null or jsonb_typeof(children) = 'array');
alter table public.reward_goal_progress
  add column children jsonb check (children is null or jsonb_typeof(children) = 'array');

alter table public.reward_rule drop constraint reward_rule_rule_type_check;
alter table public.reward_rule add constraint reward_rule_rule_type_check
  check (rule_type in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS', 'DAYS_DUE', 'PERIODS_WON'));

alter table public.reward_goal_event drop constraint reward_goal_event_type_check;
alter table public.reward_goal_event add constraint reward_goal_event_type_check
  check (type in ('created', 'edited', 'activated', 'rules_changed', 'recomputed', 'achieved', 'unachieved',
                  'payout_reversed', 'payout_restored', 'needs_review', 'redeemed', 'expired', 'cancelled',
                  'stopped', 'step_changed', 'payees_changed'));

-- ---------------------------------------------------------------------------------------------
-- What the engine reads: the children, and the periods of the goals a rule counts
-- ---------------------------------------------------------------------------------------------

-- [RWD-20] The children an every-child goal is for: each member who earns rewards and isn't archived,
-- as a family goal pays (D-75).
create function private.goal_children(p_household uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb)
    from public.member m
   where m.household_id = p_household and m.archived_at is null and m.earns_rewards
$$;

-- [RWD-19] The periods of each goal in p_ids, as last worked out: {goal_id: [{start, end, outcome}]}.
create function private.goal_sources(p_household uuid, p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.id, (
           select coalesce(jsonb_agg(jsonb_build_object('start', p.start_date, 'end', p.end_date,
                                                        'outcome', p.outcome) order by p.start_date), '[]'::jsonb)
             from public.reward_goal_period p where p.goal_id = s.id)), '{}'::jsonb)
    from public.reward_goal s
   where s.household_id = p_household and s.id = any(p_ids)
$$;

-- [RWD-20][D-126] Who an every-child period (or goal) pays: each child with something due in it.
create function private.goal_payees(p_children jsonb) returns uuid[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_children) = 'array' then (
    select coalesce(array_agg((c.value ->> 'member_id')::uuid order by (c.value ->> 'member_id')::uuid), '{}')
      from jsonb_array_elements(p_children) c
     where (c.value ->> 'contributes')::boolean) end
$$;

-- [RWD-20][D-126] Pays achievement n of an every-child goal to the children in p_members, and to no
-- one else: each child's entries for (goal, n) are brought to the goal's points (or to 0), the
-- difference posted as a `bonus` or a `reversal`, keyed by how many entries there already are, so it
-- can run again after a parent's fix. A goal paying only the celebration pays nothing. Returns
-- {type, amount, children, moved}.
create function private.pay_goal_children(g public.reward_goal, p_n integer, p_members uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_amount integer;
  v_diff   integer;
  v_moved  integer := 0;
  m        record;
begin
  if g.payout ->> 'type' is distinct from 'points' then
    return jsonb_build_object('type', coalesce(g.payout ->> 'type', 'custom'), 'children', 0, 'moved', 0);
  end if;
  v_amount := (g.payout ->> 'amount')::integer;
  for m in select mm.id,
                  coalesce((select sum(l.amount) from public.points_ledger l
                             where l.goal_id = g.id and l.goal_n = p_n and l.member_id = mm.id), 0)::integer as net,
                  (select count(*) from public.points_ledger l
                    where l.goal_id = g.id and l.goal_n = p_n and l.member_id = mm.id)::integer as k
             from public.member mm
            where mm.household_id = g.household_id
              and (mm.id = any(coalesce(p_members, '{}'))
                   or exists (select from public.points_ledger l
                               where l.goal_id = g.id and l.goal_n = p_n and l.member_id = mm.id))
            order by mm.id loop
    v_diff := case when m.id = any(coalesce(p_members, '{}')) then v_amount else 0 end - m.net;
    if v_diff <> 0 then
      perform private.post_ledger(g.household_id, m.id, case when v_diff > 0 then 'bonus' else 'reversal' end,
                                  v_diff, format('goal:%s:payout:%s:%s:%s', g.id, p_n, m.id, m.k),
                                  'Goal: ' || g.title, 'system', null, p_goal => g.id, p_goal_n => p_n);
      v_moved := v_moved + v_diff;
    end if;
  end loop;
  return jsonb_build_object('type', 'points', 'amount', v_amount,
                            'children', cardinality(coalesce(p_members, '{}')), 'moved', v_moved);
end $$;

-- [RWD-19] A period of a goal won, lost, added or gone: the goals counting its periods are marked to be
-- worked out again.
create function private.mark_counting_goals_dirty() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reward_goal_progress p
     set dirty = true, marked_at = clock_timestamp()
   where p.goal_id in (select r.goal_id from public.reward_rule r
                        where r.rule_type = 'PERIODS_WON'
                          and r.params ->> 'goal_id' in (select c.goal_id::text from changed c));
  return null;
end $$;

create trigger trg_goal_period_insert_counting_dirty after insert on public.reward_goal_period
  referencing new table as changed for each statement execute function private.mark_counting_goals_dirty();
create trigger trg_goal_period_update_counting_dirty after update on public.reward_goal_period
  referencing new table as changed for each statement execute function private.mark_counting_goals_dirty();
create trigger trg_goal_period_delete_counting_dirty after delete on public.reward_goal_period
  referencing old table as changed for each statement execute function private.mark_counting_goals_dirty();

revoke all on function private.goal_children(uuid), private.goal_sources(uuid, uuid[]),
  private.goal_payees(jsonb), private.pay_goal_children(public.reward_goal, integer, uuid[]),
  private.mark_counting_goals_dirty()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The rules and the goal
-- ---------------------------------------------------------------------------------------------

-- WP-81's rule check learns PERIODS_WON (hint rule_source): the goal it counts (an id, which save_goal
-- checks) and in_a_row (true or false, default false); its scope is everything and it has no time.
-- The rest is as before.
create or replace function private.clean_goal_rules(p_household uuid, p_rules jsonb, p_repeats text) returns jsonb
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
  v_weight integer;
begin
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) not between 1 and 5 then
    raise exception 'a goal has 1 to 5 rules' using errcode = '22023', hint = 'rules_count';
  end if;
  for r in select value from jsonb_array_elements(p_rules) loop
    v_type := r ->> 'type';
    if v_type is null or v_type not in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS', 'DAYS_DUE', 'PERIODS_WON') then
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

    -- [RWD-19] A rule counting another goal's periods counts no items of its own.
    v_scope := case when v_type = 'PERIODS_WON' then '{"all": true}'::jsonb
                    else coalesce(r -> 'scope', '{"all": true}'::jsonb) end;
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
    elsif v_type = 'PERIODS_WON' then
      -- [RWD-19] The goal it counts (save_goal checks which), in total or in a row (default in total).
      if coalesce(r -> 'params' ->> 'goal_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or (r -> 'params' ? 'in_a_row' and jsonb_typeof(r -> 'params' -> 'in_a_row') <> 'boolean') then
        raise exception 'choose the goal it counts, in total or in a row' using errcode = '22023', hint = 'rule_source';
      end if;
      v_params := jsonb_build_object('goal_id', lower(r -> 'params' ->> 'goal_id'),
                                     'in_a_row', coalesce((r -> 'params' ->> 'in_a_row')::boolean, false));
    end if;

    -- [RWD-17] When a tick counts: by each chore's due time, or by a time of day (absent: any time).
    if jsonb_typeof(r -> 'params' -> 'on_time') is not null and jsonb_typeof(r -> 'params' -> 'on_time') <> 'null' then
      if v_type = 'PERIODS_WON' or jsonb_typeof(r -> 'params' -> 'on_time') <> 'string'
         or not ((r -> 'params' ->> 'on_time') = 'due_time'
                 or (r -> 'params' ->> 'on_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
        raise exception 'counts by each chore''s due time, or by a time of day' using errcode = '22023',
          hint = 'rule_on_time';
      end if;
      v_params := v_params || jsonb_build_object('on_time', r -> 'params' ->> 'on_time');
    end if;
    -- [RWD-18] Its weight in a goal with two or more rules that pays in steps: 1 to 100.
    v_weight := null;
    if jsonb_typeof(r -> 'weight') is not null and jsonb_typeof(r -> 'weight') <> 'null' then
      if jsonb_typeof(r -> 'weight') <> 'number' or (r ->> 'weight')::numeric not between 1 and 100
         or (r ->> 'weight')::numeric <> trunc((r ->> 'weight')::numeric) then
        raise exception 'a weight is a whole number from 1 to 100' using errcode = '22023', hint = 'rule_weight';
      end if;
      v_weight := (r ->> 'weight')::integer;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', v_type, 'target', v_target, 'scope', v_scope, 'params', v_params, 'weight', v_weight));
  end loop;
  return v_out;
end $$;

-- [RWD-01][RWD-19][RWD-20] save_goal (WP-81's) learns `each_child` (a family goal's option, fixed once it
-- starts: each_child_family, each_child_steps, each_child_counted, each_child_fixed) and checks a rule
-- counting periods won (rule_source). The rest is as before.
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
  v_clean     jsonb;
  v_each      boolean;
  v_src       uuid;
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
  -- [RWD-20] Every child meets it: a family goal's option (absent, a goal keeps its own).
  v_each := case when jsonb_typeof(p_goal -> 'each_child') = 'boolean' then (p_goal ->> 'each_child')::boolean
                 when v_new then false else v_old.each_child end;
  v_rules := private.clean_goal_rules(v_household, p_goal -> 'rules', v_repeats);
  v_payout := private.clean_goal_payout(v_household, v_member,
                                        case when p_goal ? 'payout' or v_new then p_goal -> 'payout'
                                             else v_old.payout end,
                                        case when v_new then null else v_old.payout end);
  -- [RWD-18] Its steps, checked with its rules (and the misses allowed set by the lowest step).
  v_clean := private.clean_goal_steps(v_rules,
                                      case when p_goal ? 'payout' or v_new then p_goal -> 'payout' -> 'steps'
                                           else v_old.payout -> 'steps' end,
                                      v_payout, v_repeats, v_end);
  v_rules := v_clean -> 'rules';
  v_payout := v_clean -> 'payout';

  -- [RWD-20][D-126] Every child meets it: for the whole family, without steps or a rule counting
  -- another goal's periods.
  if v_each and v_member is not null then
    raise exception 'every child meets it is for a family goal' using errcode = '22023', hint = 'each_child_family';
  end if;
  if v_each and v_payout ? 'steps' then
    raise exception 'every child meets it doesn''t pay in steps' using errcode = '22023', hint = 'each_child_steps';
  end if;
  if v_each and exists (select from jsonb_array_elements(v_rules) r where r.value ->> 'type' = 'PERIODS_WON') then
    raise exception 'every child meets it doesn''t count another goal''s weeks' using errcode = '22023',
      hint = 'each_child_counted';
  end if;
  -- [RWD-19] A rule counting periods won counts a repeating goal of the same person (or the family's),
  -- not this one and not one that counts periods itself; and a goal another counts doesn't count any.
  for v_src in select (r.value -> 'params' ->> 'goal_id')::uuid from jsonb_array_elements(v_rules) r
                where r.value ->> 'type' = 'PERIODS_WON' loop
    if not exists (select from public.reward_goal s
                    where s.id = v_src and s.household_id = v_household and s.id <> v_id
                      and s.archived_at is null and s.repeats <> 'none'
                      and s.member_id is not distinct from v_member
                      and not exists (select from public.reward_rule x
                                       where x.goal_id = s.id and x.rule_type = 'PERIODS_WON')) then
      raise exception 'it counts a repeating goal of the same person' using errcode = '22023', hint = 'rule_source';
    end if;
  end loop;
  if v_src is not null and exists (select from public.reward_rule x
                                    where x.rule_type = 'PERIODS_WON' and x.goal_id <> v_id
                                      and x.params ->> 'goal_id' = v_id::text) then
    raise exception 'another goal counts this one''s weeks' using errcode = '22023', hint = 'rule_source';
  end if;
  if (v_repeats = 'none' or (not v_new and v_member is distinct from v_old.member_id))
     and exists (select from public.reward_rule x
                  where x.rule_type = 'PERIODS_WON' and x.goal_id <> v_id and x.params ->> 'goal_id' = v_id::text) then
    raise exception 'another goal counts this one''s weeks' using errcode = '22023', hint = 'rule_source';
  end if;

  if v_new then
    insert into public.reward_goal (id, household_id, member_id, title, description, icon, image_path,
                                    payout, start_date, end_date, rule_logic, repeats, each_child, created_by)
    values (v_id, v_household, v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
            coalesce(p_goal ->> 'icon', 'trophy'), p_goal ->> 'image_path', v_payout, v_start, v_end, v_logic,
            v_repeats, v_each, v_uid);
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, weight, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', (r.value ->> 'weight')::integer, r.ordinality::integer
      from jsonb_array_elements(v_rules) with ordinality r;
    insert into public.reward_goal_progress (goal_id, household_id) values (v_id, v_household);
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'created', 'admin', v_uid,
            jsonb_build_object('member_id', v_member, 'start_date', v_start, 'end_date', v_end,
                               'rule_logic', v_logic, 'rules', v_rules, 'payout', v_payout,
                               'repeat', v_repeats, 'each_child', v_each));
    return jsonb_build_object('id', v_id, 'created', true, 'rules_changed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', r.rule_type, 'target', r.target, 'scope', r.scope,
                                               'params', r.params, 'weight', r.weight)
                            order by r.sort_order, r.id), '[]')
    into v_old_rules from public.reward_rule r where r.goal_id = v_id;
  v_changed := (v_old.start_date, v_old.end_date, v_old.rule_logic, v_old_rules, v_old.repeats, v_old.each_child)
               is distinct from (v_start, v_end, v_logic, v_rules, v_repeats, v_each);

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
  if v_old.status not in ('draft', 'scheduled') and v_each <> v_old.each_child then
    raise exception 'a started goal keeps every child meets it' using errcode = '22023', hint = 'each_child_fixed';
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
         start_date = v_start, end_date = v_end, rule_logic = v_logic, repeats = v_repeats, each_child = v_each,
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
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, weight, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', (r.value ->> 'weight')::integer, r.ordinality::integer
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

-- goal_facts (WP-81's) learns the goal's `each_child`, the `members` it is for, and the `sources`: the
-- periods of each goal its rules count. The rest is as before.
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
                               'repeat', g.repeats, 'payout', g.payout, 'each_child', g.each_child),
    -- [RWD-20] The children an every-child goal is for; [RWD-19] the periods of each goal it counts.
    'members', case when g.each_child then private.goal_children(g.household_id) else '[]'::jsonb end,
    'sources', private.goal_sources(g.household_id,
                                    array(select (r.params ->> 'goal_id')::uuid from public.reward_rule r
                                           where r.goal_id = g.id and r.rule_type = 'PERIODS_WON')),
    'terms', case when g.repeats = 'term' then private.goal_terms(g.household_id, g.member_id)
                  else '[]'::jsonb end,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.rule_type, 'target', r.target,
                                          'scope', r.scope, 'params', r.params, 'weight', r.weight)
                         order by r.sort_order, r.id)
        from public.reward_rule r where r.goal_id = g.id), '[]'::jsonb),
    'facts', private.goal_facts_between(g.household_id, g.member_id, g.start_date, v_to));
end $$;

-- goal_preview_facts (WP-80's) learns `members` and the `sources` of the form's rules. The rest is as
-- before.
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
    -- [RWD-20] The children who earn rewards; [RWD-19] the periods of each goal its rules count.
    'members', private.goal_children(v_household),
    'sources', private.goal_sources(v_household, array(
                 select (r.value -> 'params' ->> 'goal_id')::uuid
                   from jsonb_array_elements(case when jsonb_typeof(p_goal -> 'rules') = 'array'
                                                  then p_goal -> 'rules' else '[]'::jsonb end) r
                  where r.value ->> 'type' = 'PERIODS_WON'
                    and coalesce(r.value -> 'params' ->> 'goal_id', '')
                        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')),
    'facts', private.goal_facts_between(v_household, v_member, v_start,
                                        case when v_repeats = 'none' then least(coalesce(v_end, v_today), v_today)
                                             else least(coalesce(v_end, v_today + 14), v_today + 14) end));
end $$;

-- [RWD-04] goals_to_evaluate (WP-19's) works out a goal counting another's periods after the goals it
-- counts. The rest is as before.
create or replace function public.goals_to_evaluate(p_household uuid, p_engine_version integer)
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household);
  v_tz    text := (select timezone from public.household where id = p_household);
begin
  perform private.goal_access(p_household);
  return query
  select g.id
    from public.reward_goal g
    left join public.reward_goal_progress p on p.goal_id = g.id
   where g.household_id = p_household
     and g.status in ('scheduled', 'active', 'achieved', 'expired', 'redeemed')
     and (p.goal_id is null
          or p.dirty
          or p.computed_at is null
          or p.engine_version <> p_engine_version
          or p.rules_version <> g.rules_version
          or (g.status = 'scheduled' and g.start_date <= v_today)
          or (g.status = 'active' and g.end_date < v_today)
          or (g.status in ('scheduled', 'active', 'achieved')
              and (p.computed_at at time zone v_tz)::date < v_today))
   -- [RWD-19] A goal counting another goal's periods after the goals it counts, so a run that
   -- works out a week also counts it.
   order by exists (select from public.reward_rule r where r.goal_id = g.id and r.rule_type = 'PERIODS_WON'),
            g.created_at, g.id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Saving an evaluation: each child's period, and who it pays
-- ---------------------------------------------------------------------------------------------

-- [RWD-15][RWD-20] save_goal_periods (WP-81's) learns each child's period on an every-child goal: kept
-- with the period (a day with nothing due named by the child's day type); a period newly won pays the
-- children with something due in it (pay_goal_children, D-126); a won period whose children with
-- something due changed pays or takes back the difference (`payees_changed`). The rest is as before.
create or replace function private.save_goal_periods(g public.reward_goal, p_periods jsonb, p_pct numeric) returns void
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
  v_step  integer;
  v_best  integer;
  v_moved integer;
  v_kids  jsonb;
  v_pays  uuid[];
  v_had   uuid[];
begin
  if jsonb_typeof(p_periods) is distinct from 'array' then
    raise exception 'a repeating goal''s evaluation has its periods' using errcode = '22023', hint = 'bad_request';
  end if;
  for per in select * from jsonb_to_recordset(p_periods)
               x (start date, "end" date, outcome text, next_start date, pct numeric, days_due integer,
                  days_done integer, days_missed integer, misses_allowed integer, days jsonb, step jsonb,
                  children jsonb)
             order by start loop
    select * into v_old from public.reward_goal_period p where p.goal_id = g.id and p.start_date = per.start;
    if v_old.goal_id is not null and g.periods_from is not null and per.start < g.periods_from then
      continue;
    end if;
    v_n := v_old.n;
    v_won := v_old.won_at;
    v_span := jsonb_build_object('period_start', per.start, 'period_end', per."end");
    v_step := case when jsonb_typeof(per.step -> 'reached') = 'number' then (per.step ->> 'reached')::integer end;
    v_best := case when jsonb_typeof(per.step -> 'best') = 'number' then (per.step ->> 'best')::integer end;
    -- [RWD-20][D-126] An every-child goal: each child's period (a day with nothing due named by their
    -- day type), and who it pays: each child with something due in it.
    v_kids := null;
    v_pays := null;
    if jsonb_typeof(per.children) = 'array' then
      select jsonb_agg(c.value || jsonb_build_object('days', (
               select jsonb_agg(d.value || case when d.value ->> 'mark' = 'none'
                                                then jsonb_build_object('day_type', private.goal_day_type(
                                                       g.household_id, (c.value ->> 'member_id')::uuid,
                                                       (d.value ->> 'date')::date))
                                                else '{}'::jsonb end order by d.ordinality)
                 from jsonb_array_elements(case when jsonb_typeof(c.value -> 'days') = 'array'
                                                then c.value -> 'days' else '[]'::jsonb end) with ordinality d))
                       order by c.ordinality)
        into v_kids from jsonb_array_elements(per.children) with ordinality c;
      v_pays := private.goal_payees(per.children);
    end if;
    v_had := private.goal_payees(v_old.children);
    if per.outcome = 'won' and v_old.outcome is distinct from 'won' then
      v_n := g.achievement_count + 1;
      v_won := now();
      update public.reward_goal set achievement_count = v_n, updated_at = now() where id = g.id;
      g.achievement_count := v_n;
      v_paid := case when g.each_child then private.pay_goal_children(g, v_n, v_pays)
                     else private.pay_goal_step(g, v_n, v_step) end;
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
    elsif v_old.outcome = 'won' and per.outcome = 'won' and g.payout ? 'steps'
          and v_step is distinct from v_old.step then
      -- [RWD-18] A parent's fix moved a won period to another step: the difference, paid or taken back.
      v_moved := private.settle_goal_to(g, v_n, private.goal_step_amount(g.payout, v_step));
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'step_changed', 'system',
              jsonb_build_object('n', v_n, 'from', v_old.step, 'to', v_step, 'points', v_moved,
                                 'amount', private.goal_step_amount(g.payout, v_step)) || v_span);
    elsif v_old.outcome = 'won' and per.outcome = 'won' and g.each_child and v_pays is distinct from v_had then
      -- [RWD-20] A parent's fix changed who had something due in a won period: each child's pay follows.
      v_paid := private.pay_goal_children(g, v_n, v_pays);
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'payees_changed', 'system',
              jsonb_build_object('n', v_n, 'from', to_jsonb(v_had), 'to', to_jsonb(v_pays),
                                 'points', v_paid -> 'moved') || v_span);
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
                                                won_at, celebrated_at, step, step_best, children)
    values (g.household_id, g.id, per.start, per."end", per.outcome, per.next_start,
            round(least(greatest(coalesce(per.pct, 0), 0), 100), 2), per.days_due, per.days_done, per.days_missed,
            per.misses_allowed, v_days, v_n, v_won, null, v_step, v_best, v_kids)
    on conflict (goal_id, start_date) do update
       set end_date = excluded.end_date, outcome = excluded.outcome, next_start = excluded.next_start,
           pct = excluded.pct, days_due = excluded.days_due, days_done = excluded.days_done,
           days_missed = excluded.days_missed, misses_allowed = excluded.misses_allowed, days = excluded.days,
           n = excluded.n, won_at = excluded.won_at, step = excluded.step, step_best = excluded.step_best,
           children = excluded.children,
           celebrated_at = case when p.n is distinct from excluded.n then null else p.celebrated_at end,
           computed_at = now()
     where (p.end_date, p.outcome, p.next_start, p.pct, p.days_due, p.days_done, p.days_missed,
            p.misses_allowed, p.days, p.n, p.won_at, p.step, p.step_best, p.children)
           is distinct from (excluded.end_date, excluded.outcome, excluded.next_start, excluded.pct,
                             excluded.days_due, excluded.days_done, excluded.days_missed, excluded.misses_allowed,
                             excluded.days, excluded.n, excluded.won_at, excluded.step, excluded.step_best,
                             excluded.children);
  end loop;
  delete from public.reward_goal_period p
   where p.goal_id = g.id and p.outcome <> 'won'
     and (g.periods_from is null or p.start_date >= g.periods_from)
     and p.start_date not in (select (x.value ->> 'start')::date from jsonb_array_elements(p_periods) x);
end $$;

-- [RWD-04][RWD-20] save_goal_evaluation (WP-81's) learns an every-child goal that doesn't repeat: its
-- progress keeps each child; reached, it pays the children with something due; a change in who had
-- something due pays or takes back the difference. The rest is as before.
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
  v_step  integer;
  v_best  integer;
  v_final boolean;
  v_pays  uuid[];
  v_kids  jsonb;
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
  -- [RWD-18] A one-off goal's steps: the one reached, the best in reach, and whether it is final.
  v_step := case when jsonb_typeof(p_evaluation -> 'step' -> 'reached') = 'number'
                 then (p_evaluation -> 'step' ->> 'reached')::integer end;
  v_best := case when jsonb_typeof(p_evaluation -> 'step' -> 'best') = 'number'
                 then (p_evaluation -> 'step' ->> 'best')::integer end;
  v_final := coalesce((p_evaluation -> 'step' ->> 'final')::boolean, false);
  -- [RWD-20] An every-child goal that doesn't repeat: each child, and who it pays (D-126).
  v_kids := case when g.each_child and jsonb_typeof(p_evaluation -> 'children') = 'array'
                 then p_evaluation -> 'children' end;
  v_pays := private.goal_payees(v_kids);

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
                                                engine_version, computed_at, step, step_best, children)
  values (g.id, g.household_id, v_pct, v_met, false, p_rules_version, p_engine_version, now(), v_step, v_best,
          v_kids)
  on conflict (goal_id) do update
     set pct = excluded.pct, is_achieved = excluded.is_achieved, rules_version = excluded.rules_version,
         step = excluded.step, step_best = excluded.step_best, children = excluded.children,
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
               paid_step = v_step, updated_at = now()
         where id = g.id;
        g.achievement_count := v_n;
        g.paid_step := v_step;
        v_paid := case when g.each_child then private.pay_goal_children(g, v_n, v_pays)
                       else private.pay_goal_step(g, v_n, v_step) end;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'achieved', 'system', jsonb_build_object('n', v_n, 'pct', v_pct, 'paid', v_paid));
      when 'unachieved' then
        update public.reward_goal
           set status = 'active', achieved_at = null, celebrated_at = null, paid_step = null, updated_at = now()
         where id = g.id;
        g.paid_step := null;
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
    v_moved := case when g.payout ? 'steps'
                    then private.settle_goal_to(g, g.achievement_count,
                                                private.goal_step_amount(g.payout, coalesce(v_step, g.paid_step)))
                    else private.settle_goal_points(g, g.achievement_count, true) end;
    if g.payout ? 'steps' and v_step is distinct from g.paid_step then
      update public.reward_goal set paid_step = v_step where id = g.id;
      g.paid_step := v_step;
    end if;
    if v_moved <> 0 then
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'payout_restored', 'system',
              jsonb_build_object('n', g.achievement_count, 'points', v_moved));
    end if;
  end if;

  -- [RWD-18] A reached one-off goal that a parent's fix moved to another step: the difference.
  if g.repeats = 'none' and g.payout ? 'steps' and g.status in ('achieved', 'redeemed') and v_met and v_final
     and v_step is not null and v_step is distinct from g.paid_step then
    v_moved := private.settle_goal_to(g, g.achievement_count, private.goal_step_amount(g.payout, v_step));
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
    values (g.household_id, g.id, 'step_changed', 'system',
            jsonb_build_object('n', g.achievement_count, 'from', g.paid_step, 'to', v_step, 'points', v_moved,
                               'amount', private.goal_step_amount(g.payout, v_step)));
    update public.reward_goal set paid_step = v_step, updated_at = now() where id = g.id;
    g.paid_step := v_step;
  end if;

  -- [RWD-20] A reached every-child goal whose children with something due changed (a parent's fix):
  -- each child's pay follows.
  if g.repeats = 'none' and g.each_child and g.status in ('achieved', 'redeemed') and v_met
     and v_pays is distinct from private.goal_payees(v_prev.children) then
    v_paid := private.pay_goal_children(g, g.achievement_count, v_pays);
    if (v_paid ->> 'moved')::integer <> 0 then
      insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
      values (g.household_id, g.id, 'payees_changed', 'system',
              jsonb_build_object('n', g.achievement_count, 'from', to_jsonb(private.goal_payees(v_prev.children)),
                                 'to', to_jsonb(v_pays), 'points', v_paid -> 'moved'));
    end if;
  end if;

  if g.repeats <> 'none' then
    perform private.save_goal_periods(g, p_evaluation -> 'periods', v_pct);
  end if;

  return jsonb_build_object('saved', true, 'status', g.status, 'pct', v_pct, 'is_achieved', v_met,
                            'transitions', v_done);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The board's snapshot (WP-81's)
-- ---------------------------------------------------------------------------------------------

-- [RWD-07][RWD-19][RWD-20] board_snapshot as WP-81 left it; each goal now has `each_child` and its
-- `children` (a goal that doesn't repeat), a period its `children`, and each rule `in_a_row` and, for
-- a rule counting another goal's periods, its `source` with that goal's last five periods since this
-- one started. The rest is as before.
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
               -- [RWD-20] Every child meets it, and each child's progress (a goal that doesn't repeat).
               'each_child', g.each_child,
               'children', p.children,
               'pays', case when g.payout ->> 'type' = 'points' then (g.payout ->> 'amount')::integer end,
               -- [RWD-18] Its lower steps, and where they stand for a goal that doesn't repeat.
               'steps', g.payout -> 'steps',
               'step', p.step,
               'step_best', p.step_best,
               'period', (select jsonb_build_object('start', c.start_date, 'end', c.end_date, 'outcome', c.outcome,
                                                    'next_start', c.next_start, 'days_due', c.days_due,
                                                    'days_done', c.days_done, 'days_missed', c.days_missed,
                                                    'misses_allowed', c.misses_allowed, 'days', c.days,
                                                    'step', c.step, 'step_best', c.step_best,
                                                    'children', c.children)
                            from public.reward_goal_period c
                           where c.goal_id = g.id and c.start_date <= v_today
                           order by c.start_date desc limit 1),
               'history', (select coalesce(jsonb_agg(jsonb_build_object('start', hp.start_date, 'end', hp.end_date,
                                                                        'outcome', hp.outcome, 'step', hp.step)
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
                                  'best', rp.best_streak, 'weight', r.weight, 'on_time', r.params ->> 'on_time',
                                  -- [RWD-19] A rule counting another goal's periods: in a row or in
                                  -- total, and that goal with its periods since this one started.
                                  'in_a_row', (r.params ->> 'in_a_row')::boolean,
                                  'source', case when r.rule_type = 'PERIODS_WON' then (
                                    select jsonb_build_object(
                                             'id', s.id, 'title', s.title, 'icon', s.icon, 'repeat', s.repeats,
                                             'history', (select coalesce(jsonb_agg(jsonb_build_object(
                                                                  'start', sp.start_date, 'end', sp.end_date,
                                                                  'outcome', sp.outcome) order by sp.start_date),
                                                                '[]'::jsonb)
                                                           from (select * from public.reward_goal_period sp0
                                                                  where sp0.goal_id = s.id
                                                                    and sp0.start_date >= g.start_date
                                                                    and sp0.start_date <= v_today
                                                                  order by sp0.start_date desc limit 5) sp))
                                      from public.reward_goal s where s.id = (r.params ->> 'goal_id')::uuid) end)
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
