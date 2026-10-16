-- [RWD-17][RWD-18] A goal done by a time, and goals that pay in steps (WP-81, D-102, D-124). On top of
-- WP-80's repeating goals (ENGINE_VERSION 3):
--   * a rule can count only ticks made by a time (reward_rule.params.on_time): by each chore's due time
--     ('due_time'; a chore without one counts any time that day) or by a time of day ('HH:MM'). The
--     tick's own time decides (the board's, kept offline; the child's tick, not a parent's approval);
--     a later tick, a parent's included, completes the chore and earns its points but doesn't count;
--   * a goal paying points can pay in steps (reward_goal.payout.steps, the top being the goal's own
--     amount): by days missed on one "every day it's due" rule (the lowest step sets the misses
--     allowed), by the number reached on one other rule, or by the goal's weighted % on two or more
--     rules (reward_rule.weight, totalling 100). The highest step reached pays, not the sum: the top
--     at once, a lower one when its period or the goal ends, or as soon as no higher one can be
--     reached. A goal that doesn't repeat and pays in steps has an end date;
--   * a won period (or a reached goal) that a parent's fix moves to another step pays or takes back
--     the difference, once (`step_changed`).

alter table public.reward_rule
  add column weight integer check (weight between 1 and 100);
alter table public.reward_goal
  -- [RWD-18] The step a reached one-off goal paid (0 the top); null without steps.
  add column paid_step integer check (paid_step >= 0);
alter table public.reward_goal_period
  add column step integer check (step >= 0),
  add column step_best integer check (step_best >= 0);
alter table public.reward_goal_progress
  add column step integer check (step >= 0),
  add column step_best integer check (step_best >= 0);

alter table public.reward_goal_event drop constraint reward_goal_event_type_check;
alter table public.reward_goal_event add constraint reward_goal_event_type_check
  check (type in ('created', 'edited', 'activated', 'rules_changed', 'recomputed', 'achieved', 'unachieved',
                  'payout_reversed', 'payout_restored', 'needs_review', 'redeemed', 'expired', 'cancelled',
                  'stopped', 'step_changed'));

-- ---------------------------------------------------------------------------------------------
-- The rules: a time, and a weight
-- ---------------------------------------------------------------------------------------------

-- WP-80's rule check learns `params.on_time` ('due_time' or 'HH:MM', hint rule_on_time) and `weight`
-- (1 to 100, hint rule_weight). The rest is as before.

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

    -- [RWD-17] When a tick counts: by each chore's due time, or by a time of day (absent: any time).
    if jsonb_typeof(r -> 'params' -> 'on_time') is not null and jsonb_typeof(r -> 'params' -> 'on_time') <> 'null' then
      if jsonb_typeof(r -> 'params' -> 'on_time') <> 'string'
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


-- [RWD-18] Checks a goal's lower steps against its rules and payout, and returns {rules, payout}
-- with the steps in the stored shape: points only (hint payout_steps_points); 1 to 3 steps
-- (payout_steps), each paying fewer points than the one above, from 1; on one "every day it's due"
-- rule each is days missed (`misses`, 1 to 3, rising), and the lowest sets the rule's misses allowed;
-- on one other rule the number reached (`at`, under the target, falling); on two or more rules the
-- goal's weighted % (`at`, under 100, falling), with every rule weighted and the weights totalling
-- 100 (rule_weights). A goal that doesn't repeat needs an end date (steps_end_date).
create function private.clean_goal_steps(p_rules jsonb, p_steps jsonb, p_payout jsonb, p_repeats text,
                                         p_end date) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_mode   text;
  v_key    text;
  v_prev_a integer;
  v_prev_k integer;
  v_a      numeric;
  v_k      numeric;
  v_out    jsonb := '[]'::jsonb;
  s        jsonb;
begin
  if p_steps is null or jsonb_typeof(p_steps) = 'null'
     or (jsonb_typeof(p_steps) = 'array' and jsonb_array_length(p_steps) = 0) then
    return jsonb_build_object('rules', p_rules, 'payout', p_payout - 'steps');
  end if;
  if p_payout ->> 'type' is distinct from 'points' then
    raise exception 'steps pay points' using errcode = '22023', hint = 'payout_steps_points';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 3 then
    raise exception 'up to 3 lower steps' using errcode = '22023', hint = 'payout_steps';
  end if;
  if coalesce(p_repeats, 'none') = 'none' and p_end is null then
    raise exception 'a goal that pays in steps and doesn''t repeat needs an end date' using errcode = '22023',
      hint = 'steps_end_date';
  end if;
  v_mode := case when jsonb_array_length(p_rules) > 1 then 'weighted'
                 when p_rules -> 0 ->> 'type' = 'DAYS_DUE' then 'misses' else 'number' end;
  v_key := case when v_mode = 'misses' then 'misses' else 'at' end;
  v_prev_a := (p_payout ->> 'amount')::integer;
  v_prev_k := case v_mode when 'misses' then 0 when 'weighted' then 100
                          else (p_rules -> 0 ->> 'target')::integer end;
  for s in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(s -> 'amount') is distinct from 'number' or jsonb_typeof(s -> v_key) is distinct from 'number' then
      raise exception 'each step has its points and where it is reached' using errcode = '22023', hint = 'payout_steps';
    end if;
    v_a := (s ->> 'amount')::numeric;
    v_k := (s ->> v_key)::numeric;
    if v_a <> trunc(v_a) or v_k <> trunc(v_k) or v_a < 1 or v_a >= v_prev_a
       or (v_mode = 'misses' and (v_k <= v_prev_k or v_k > 3))
       or (v_mode <> 'misses' and (v_k < 1 or v_k >= v_prev_k)) then
      raise exception 'each step pays fewer points than the one above, and is reached with less'
        using errcode = '22023', hint = 'payout_steps';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(v_key, v_k::integer, 'amount', v_a::integer));
    v_prev_a := v_a::integer;
    v_prev_k := v_k::integer;
  end loop;
  if v_mode = 'weighted' and (
       exists (select from jsonb_array_elements(p_rules) r where jsonb_typeof(r.value -> 'weight') is distinct from 'number')
       or (select sum((r.value ->> 'weight')::integer) from jsonb_array_elements(p_rules) r) <> 100) then
    raise exception 'the rules'' weights total 100%%' using errcode = '22023', hint = 'rule_weights';
  end if;
  if v_mode = 'misses' then
    p_rules := jsonb_set(p_rules, '{0,params,misses_allowed}', to_jsonb(v_prev_k));
  end if;
  return jsonb_build_object('rules', p_rules, 'payout', p_payout || jsonb_build_object('steps', v_out));
end $$;

-- [RWD-18] The points step p_step pays (0 or null: the goal's own amount).
create function private.goal_step_amount(p_payout jsonb, p_step integer) returns integer
language sql immutable set search_path = '' as $$
  select case when p_step is null or p_step = 0 or not (p_payout ? 'steps') then (p_payout ->> 'amount')::integer
              else (p_payout -> 'steps' -> (p_step - 1) ->> 'amount')::integer end
$$;

-- [RWD-18] Pays achievement n at step p_step: pay_goal's payout, as the step's points.
create function private.pay_goal_step(g public.reward_goal, p_n integer, p_step integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if g.payout ? 'steps' then
    g.payout := jsonb_build_object('type', 'points', 'amount', private.goal_step_amount(g.payout, p_step));
    return private.pay_goal(g, p_n) || jsonb_build_object('step', coalesce(p_step, 0));
  end if;
  return private.pay_goal(g, p_n);
end $$;

-- [RWD-18] Brings each child's points for achievement n of a goal to p_amount: the difference is
-- posted, a `bonus` or a `reversal`, keyed by how many entries there already are (as
-- settle_goal_points). Returns the points moved (signed).
create function private.settle_goal_to(g public.reward_goal, p_n integer, p_amount integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e      record;
  v_diff integer;
  v_sum  integer := 0;
begin
  for e in select l.member_id, sum(l.amount)::integer as net, count(*)::integer as k
             from public.points_ledger l
            where l.goal_id = g.id and l.goal_n = p_n
            group by l.member_id
            order by l.member_id loop
    v_diff := coalesce(p_amount, 0) - e.net;
    if v_diff <> 0 then
      perform private.post_ledger(g.household_id, e.member_id, case when v_diff > 0 then 'bonus' else 'reversal' end,
                                  v_diff, format('goal:%s:payout:%s:%s:%s', g.id, p_n, e.member_id, e.k),
                                  'Goal: ' || g.title, 'system', null, p_goal => g.id, p_goal_n => p_n);
      v_sum := v_sum + v_diff;
    end if;
  end loop;
  return v_sum;
end $$;

-- [RWD-01][RWD-02][RWD-13][RWD-15][RWD-18] save_goal (WP-80's) learns steps and weights: a rule's
-- weight is stored, and the payout's steps are checked with the rules (private.clean_goal_steps),
-- left out, a goal keeps its own. The rest is as before.

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
  -- [RWD-18] Its steps, checked with its rules (and the misses allowed set by the lowest step).
  v_clean := private.clean_goal_steps(v_rules,
                                      case when p_goal ? 'payout' or v_new then p_goal -> 'payout' -> 'steps'
                                           else v_old.payout -> 'steps' end,
                                      v_payout, v_repeats, v_end);
  v_rules := v_clean -> 'rules';
  v_payout := v_clean -> 'payout';

  if v_new then
    insert into public.reward_goal (id, household_id, member_id, title, description, icon, image_path,
                                    payout, start_date, end_date, rule_logic, repeats, created_by)
    values (v_id, v_household, v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
            coalesce(p_goal ->> 'icon', 'trophy'), p_goal ->> 'image_path', v_payout, v_start, v_end, v_logic,
            v_repeats, v_uid);
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, weight, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', (r.value ->> 'weight')::integer, r.ordinality::integer
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
                                               'params', r.params, 'weight', r.weight)
                            order by r.sort_order, r.id), '[]')
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


-- ---------------------------------------------------------------------------------------------
-- What the engine reads: each tick's time and each chore's due time; the payout and the weights
-- ---------------------------------------------------------------------------------------------

-- [RWD-17] goal_facts_between (WP-39's) learns `due_time` ('HH:MM') and `done_at`: when it was ticked
-- on the household's clock ('YYYY-MM-DDTHH:MM'), the latest check-off (a board's or a parent's) up to
-- the event that set its status, so an approved chore keeps the child's tick, not the approval.
create or replace function private.goal_facts_between(p_household uuid, p_member uuid, p_start date, p_to date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.occurrence_id,
             'chore_id', v.chore_id,
             'member_id', v.member_id,
             'kind', v.kind,
             'tag_ids', coalesce((select jsonb_agg(t.tag_id order by t.tag_id)
                                    from public.chore_tag t where t.chore_id = v.chore_id), '[]'::jsonb),
             'due_date', v.due_date,
             'credit_date', case when v.kind = 'chore' then v.due_date
                                 when o.status in ('completed', 'approved', 'pending_approval')
                                   then e.credit_date end,
             'status', v.member_status,
             'credited', v.credited,
             'points', v.points_snapshot,
             'due_time', to_char(o.due_time, 'HH24:MI'),
             'done_at', case when o.status in ('completed', 'approved', 'pending_approval') then (
                          select to_char(c.occurred_at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI')
                            from public.chore_completion_event c
                           where c.occurrence_id = o.id and c.event_type in ('complete', 'admin_complete')
                             and (c.occurred_at, c.recorded_at) <= (e.occurred_at, e.recorded_at)
                           order by c.occurred_at desc, c.recorded_at desc, c.id desc
                           limit 1) end)
           order by v.due_date, v.occurrence_id, v.member_id)
      from public.v_member_occurrence v
      join public.chore_occurrence o on o.id = v.occurrence_id
      join public.household h on h.id = v.household_id
      left join public.chore_completion_event e on e.id = o.status_event_id
     where v.household_id = p_household
       and (p_member is null or v.member_id = p_member)
       and p_to >= p_start
       and ((v.due_date between p_start and p_to)
            or (e.credit_date between p_start and p_to))), '[]'::jsonb)
$$;


-- goal_facts (WP-80's) learns the goal's `payout` (so the engine has its steps) and each rule's
-- `weight`. The rest is as before.
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
                               'repeat', g.repeats, 'payout', g.payout),
    'terms', case when g.repeats = 'term' then private.goal_terms(g.household_id, g.member_id)
                  else '[]'::jsonb end,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.rule_type, 'target', r.target,
                                          'scope', r.scope, 'params', r.params, 'weight', r.weight)
                         order by r.sort_order, r.id)
        from public.reward_rule r where r.goal_id = g.id), '[]'::jsonb),
    'facts', private.goal_facts_between(g.household_id, g.member_id, g.start_date, v_to));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Saving an evaluation: each step paid, once
-- ---------------------------------------------------------------------------------------------

-- [RWD-15][RWD-18] save_goal_periods (WP-80's) learns steps: each period keeps the step reached and the
-- best in reach; a period newly won pays its step's points (pay_goal_step); a won period that stays
-- won at another step pays or takes back the difference (`step_changed`). The rest is as before.
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
begin
  if jsonb_typeof(p_periods) is distinct from 'array' then
    raise exception 'a repeating goal''s evaluation has its periods' using errcode = '22023', hint = 'bad_request';
  end if;
  for per in select * from jsonb_to_recordset(p_periods)
               x (start date, "end" date, outcome text, next_start date, pct numeric, days_due integer,
                  days_done integer, days_missed integer, misses_allowed integer, days jsonb, step jsonb)
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
    if per.outcome = 'won' and v_old.outcome is distinct from 'won' then
      v_n := g.achievement_count + 1;
      v_won := now();
      update public.reward_goal set achievement_count = v_n, updated_at = now() where id = g.id;
      g.achievement_count := v_n;
      v_paid := private.pay_goal_step(g, v_n, v_step);
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
                                                won_at, celebrated_at, step, step_best)
    values (g.household_id, g.id, per.start, per."end", per.outcome, per.next_start,
            round(least(greatest(coalesce(per.pct, 0), 0), 100), 2), per.days_due, per.days_done, per.days_missed,
            per.misses_allowed, v_days, v_n, v_won, null, v_step, v_best)
    on conflict (goal_id, start_date) do update
       set end_date = excluded.end_date, outcome = excluded.outcome, next_start = excluded.next_start,
           pct = excluded.pct, days_due = excluded.days_due, days_done = excluded.days_done,
           days_missed = excluded.days_missed, misses_allowed = excluded.misses_allowed, days = excluded.days,
           n = excluded.n, won_at = excluded.won_at, step = excluded.step, step_best = excluded.step_best,
           celebrated_at = case when p.n is distinct from excluded.n then null else p.celebrated_at end,
           computed_at = now()
     where (p.end_date, p.outcome, p.next_start, p.pct, p.days_due, p.days_done, p.days_missed,
            p.misses_allowed, p.days, p.n, p.won_at, p.step, p.step_best)
           is distinct from (excluded.end_date, excluded.outcome, excluded.next_start, excluded.pct,
                             excluded.days_due, excluded.days_done, excluded.days_missed, excluded.misses_allowed,
                             excluded.days, excluded.n, excluded.won_at, excluded.step, excluded.step_best);
  end loop;
  delete from public.reward_goal_period p
   where p.goal_id = g.id and p.outcome <> 'won'
     and (g.periods_from is null or p.start_date >= g.periods_from)
     and p.start_date not in (select (x.value ->> 'start')::date from jsonb_array_elements(p_periods) x);
end $$;


-- [RWD-04][RWD-18] save_goal_evaluation (WP-80's) learns a one-off goal's steps: its progress keeps the
-- step reached and the best in reach; reached, it pays its step's points and records the step paid
-- (`paid_step`); a parent's fix that moves a reached goal to another step settles the difference;
-- a redeemed goal met again is put back at its step. The rest is as before.
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
                                                engine_version, computed_at, step, step_best)
  values (g.id, g.household_id, v_pct, v_met, false, p_rules_version, p_engine_version, now(), v_step, v_best)
  on conflict (goal_id) do update
     set pct = excluded.pct, is_achieved = excluded.is_achieved, rules_version = excluded.rules_version,
         step = excluded.step, step_best = excluded.step_best,
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
        v_paid := private.pay_goal_step(g, v_n, v_step);
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

  if g.repeats <> 'none' then
    perform private.save_goal_periods(g, p_evaluation -> 'periods', v_pct);
  end if;

  return jsonb_build_object('saved', true, 'status', g.status, 'pct', v_pct, 'is_achieved', v_met,
                            'transitions', v_done);
end $$;


revoke all on function private.clean_goal_steps(jsonb, jsonb, jsonb, text, date),
  private.goal_step_amount(jsonb, integer), private.pay_goal_step(public.reward_goal, integer, integer),
  private.settle_goal_to(public.reward_goal, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board's snapshot (WP-80's), whose goals learn steps, weights and times
-- ---------------------------------------------------------------------------------------------

-- [RWD-07][RWD-15][RWD-17][RWD-18] board_snapshot as WP-80 left it; each goal now has its lower
-- `steps` and, for a goal that doesn't repeat, the `step` reached and `step_best` in reach; a period
-- (and each of its history) its step; each rule its `weight` and `on_time`. The rest is as before.
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
               -- [RWD-18] Its lower steps, and where they stand for a goal that doesn't repeat.
               'steps', g.payout -> 'steps',
               'step', p.step,
               'step_best', p.step_best,
               'period', (select jsonb_build_object('start', c.start_date, 'end', c.end_date, 'outcome', c.outcome,
                                                    'next_start', c.next_start, 'days_due', c.days_due,
                                                    'days_done', c.days_done, 'days_missed', c.days_missed,
                                                    'misses_allowed', c.misses_allowed, 'days', c.days,
                                                    'step', c.step, 'step_best', c.step_best)
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
                                  'best', rp.best_streak, 'weight', r.weight, 'on_time', r.params ->> 'on_time')
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

