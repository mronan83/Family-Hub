-- [RWD-04][RWD-10][RWD-13] Goal payouts and the rule-change preview (WP-39, D-75; 02 §5 "Payouts
-- follow achievement").
--   * A goal says what reaching it pays (save_goal takes `payout`): the celebration and the redeem
--     step only (custom); points (a `bonus` to the child, or to each child who earns rewards for a
--     family goal); or a reward from the shop (a child's goal: a request approved at once that costs
--     nothing, which a parent marks given as usual).
--   * save_goal_evaluation pays achievement n in the transaction that records it, so it is paid once
--     however often the job runs. A goal undone (`unachieved`) takes its points back once (a
--     `reversal` for each child paid) and calls off a shop reward not yet given; one already given
--     stays given and flags the goal for a parent's look. Reached again, it pays again as n + 1.
--   * A redeemed goal (the parent says the reward was given) that a reversed check-off un-meets keeps
--     its status, is flagged once, and its points are taken back; met again, they are put back. The
--     flag is raised when it stops being met, not at every evaluation, so a parent's clearing sticks.
--   * goal_preview_facts reads what goal_facts would for a goal with changed dates or person, so the
--     admin app shows what a change would do to its progress before it is saved (RWD-10).

-- ---------------------------------------------------------------------------------------------
-- What a payout leaves behind: the ledger entries and the request name the goal and achievement n
-- ---------------------------------------------------------------------------------------------

alter table public.points_ledger add column goal_id uuid, add column goal_n integer;
alter table public.points_ledger add constraint points_ledger_goal_fkey
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id);
alter table public.points_ledger add constraint points_ledger_goal_check
  check ((goal_id is null) = (goal_n is null) and (goal_id is null or entry_type in ('bonus', 'reversal')));
create index on public.points_ledger (goal_id, goal_n) where goal_id is not null;

-- The ledger's one writer (D-28) learns the goal. Same body, two more arguments, defaulted, so the
-- existing callers are unchanged.
drop function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid, uuid);
create function private.post_ledger(
  p_household uuid, p_member uuid, p_type text, p_amount integer, p_dedupe_key text, p_reason text,
  p_created_by_type text, p_created_by uuid, p_redemption uuid default null, p_points_rule uuid default null,
  p_goal uuid default null, p_goal_n integer default null)
returns uuid
language sql security definer set search_path = '' as $$
  insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                    created_by_type, created_by, redemption_id, points_rule_id, goal_id, goal_n)
  values (p_household, p_member, p_type, p_amount, p_reason, p_dedupe_key, p_created_by_type, p_created_by,
          p_redemption, p_points_rule, p_goal, p_goal_n)
  on conflict (dedupe_key) do nothing
  returning id
$$;

-- A shop reward a goal paid: approved by the system, costing nothing, one per achievement.
alter table public.redemption add column goal_id uuid, add column goal_n integer;
alter table public.redemption add constraint redemption_goal_fkey
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id);
alter table public.redemption add constraint redemption_goal_check check ((goal_id is null) = (goal_n is null));
create unique index redemption_goal_n_key on public.redemption (goal_id, goal_n) where goal_id is not null;
alter table public.redemption drop constraint redemption_cost_snapshot_check;
alter table public.redemption add constraint redemption_cost_snapshot_check
  check (case when goal_id is null then cost_snapshot > 0 else cost_snapshot = 0 end);
alter table public.redemption drop constraint redemption_requested_by_type_check;
alter table public.redemption add constraint redemption_requested_by_type_check
  check (requested_by_type in ('device', 'admin', 'system'));

-- The goal's log learns that points taken back were put back.
alter table public.reward_goal_event drop constraint reward_goal_event_type_check;
alter table public.reward_goal_event add constraint reward_goal_event_type_check
  check (type in ('created', 'edited', 'activated', 'rules_changed', 'recomputed', 'achieved', 'unachieved',
                  'payout_reversed', 'payout_restored', 'needs_review', 'redeemed', 'expired', 'cancelled'));

-- ---------------------------------------------------------------------------------------------
-- What a goal pays
-- ---------------------------------------------------------------------------------------------

-- [RWD-13] Checks a payout and returns it in the stored shape. Points: a whole number from 1 to 10000.
-- A shop reward: one of the household's, not removed (one taken out of the shop may still be a
-- goal's prize), or the one the goal already has (p_keep: removed since, it stays its prize); and
-- only for a child's goal. Raises with a hint naming what to fix.
create function private.clean_goal_payout(p_household uuid, p_member uuid, p_payout jsonb, p_keep jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type   text := coalesce(p_payout ->> 'type', 'custom');
  v_amount numeric;
  v_item   uuid;
begin
  if p_payout is null or jsonb_typeof(p_payout) = 'null' or v_type = 'custom' then
    return '{"type": "custom"}'::jsonb;
  end if;
  if v_type = 'points' then
    if coalesce(jsonb_typeof(p_payout -> 'amount'), '') <> 'number' then
      raise exception 'points: a whole number from 1 to 10000' using errcode = '22023', hint = 'payout_points';
    end if;
    v_amount := (p_payout ->> 'amount')::numeric;
    if v_amount not between 1 and 10000 or v_amount <> trunc(v_amount) then
      raise exception 'points: a whole number from 1 to 10000' using errcode = '22023', hint = 'payout_points';
    end if;
    return jsonb_build_object('type', 'points', 'amount', v_amount::integer);
  end if;
  if v_type = 'catalog_item' then
    if p_member is null then
      raise exception 'a family goal pays points, or the celebration' using errcode = '22023',
        hint = 'payout_family_item';
    end if;
    begin
      v_item := (p_payout ->> 'item_id')::uuid;
    exception when invalid_text_representation then
      v_item := null;
    end;
    if v_item is null or (v_item is distinct from (p_keep ->> 'item_id')::uuid
                          and not exists (select from public.reward_catalog_item i
                                           where i.id = v_item and i.household_id = p_household
                                             and i.archived_at is null)) then
      raise exception 'choose a reward from the shop' using errcode = '22023', hint = 'payout_item';
    end if;
    return jsonb_build_object('type', 'catalog_item', 'item_id', v_item);
  end if;
  raise exception 'unknown payout' using errcode = '22023', hint = 'payout_type';
end $$;

-- [RWD-01][RWD-02][RWD-03][RWD-13] save_goal (WP-19) learns the payout: p_goal's `payout` ({type:
-- 'custom'} | {type: 'points', amount} | {type: 'catalog_item', item_id}); left out, a goal keeps
-- its own (a new one: custom). A changed payout applies from the next achievement, is logged with
-- the edit, and stays as it is once the goal has finished. The rest is as before.
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
  v_changed   boolean;
  v_new       boolean;
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
  v_rules := private.clean_goal_rules(v_household, p_goal -> 'rules');

  select * into v_old from public.reward_goal where id = v_id for update;
  v_new := not found;
  if not v_new and v_old.household_id <> v_household then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_payout := private.clean_goal_payout(v_household, v_member,
                                        case when p_goal ? 'payout' or v_new then p_goal -> 'payout'
                                             else v_old.payout end,
                                        case when v_new then null else v_old.payout end);

  if v_new then
    insert into public.reward_goal (id, household_id, member_id, title, description, icon, image_path,
                                    payout, start_date, end_date, rule_logic, created_by)
    values (v_id, v_household, v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
            coalesce(p_goal ->> 'icon', 'trophy'), p_goal ->> 'image_path', v_payout, v_start, v_end, v_logic,
            v_uid);
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', r.ordinality::integer
      from jsonb_array_elements(v_rules) with ordinality r;
    insert into public.reward_goal_progress (goal_id, household_id) values (v_id, v_household);
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'created', 'admin', v_uid,
            jsonb_build_object('member_id', v_member, 'start_date', v_start, 'end_date', v_end,
                               'rule_logic', v_logic, 'rules', v_rules, 'payout', v_payout));
    return jsonb_build_object('id', v_id, 'created', true, 'rules_changed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', r.rule_type, 'target', r.target, 'scope', r.scope,
                                               'params', r.params) order by r.sort_order, r.id), '[]')
    into v_old_rules from public.reward_rule r where r.goal_id = v_id;
  v_changed := (v_old.start_date, v_old.end_date, v_old.rule_logic, v_old_rules)
               is distinct from (v_start, v_end, v_logic, v_rules);

  if v_old.status in ('redeemed', 'expired', 'cancelled')
     and (v_changed or v_member is distinct from v_old.member_id or v_payout is distinct from v_old.payout) then
    raise exception 'a finished goal keeps its rules' using errcode = '22023', hint = 'goal_closed';
  end if;
  if v_old.status not in ('draft', 'scheduled')
     and (v_member is distinct from v_old.member_id or v_start <> v_old.start_date) then
    raise exception 'a started goal keeps its person and start date' using errcode = '22023', hint = 'goal_started';
  end if;

  update public.reward_goal
     set member_id = v_member, title = btrim(p_goal ->> 'title'),
         description = nullif(btrim(p_goal ->> 'description'), ''),
         icon = coalesce(p_goal ->> 'icon', icon),
         image_path = case when p_goal ? 'image_path' then p_goal ->> 'image_path' else image_path end,
         payout = v_payout,
         start_date = v_start, end_date = v_end, rule_logic = v_logic,
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
                                                          'rule_logic', v_old.rule_logic, 'rules', v_old_rules),
                               'to', jsonb_build_object('start_date', v_start, 'end_date', v_end,
                                                        'rule_logic', v_logic, 'rules', v_rules))
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
-- Paying, taking back, putting back
-- ---------------------------------------------------------------------------------------------

-- [RWD-13][US-409] Pays achievement n of a goal as its payout says: points to the child (each child
-- who earns rewards, for a family goal), or the shop reward as an approved request that costs
-- nothing. Each is keyed by the goal and n, so paying twice pays once. Returns what was paid.
create function private.pay_goal(g public.reward_goal, p_n integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_type   text := g.payout ->> 'type';
  v_amount integer;
  v_paid   integer := 0;
  m        record;
begin
  if v_type = 'points' then
    v_amount := (g.payout ->> 'amount')::integer;
    for m in select mm.id from public.member mm
              where mm.household_id = g.household_id and mm.archived_at is null
                and (mm.id = g.member_id or (g.member_id is null and mm.earns_rewards))
              order by mm.id loop
      if private.post_ledger(g.household_id, m.id, 'bonus', v_amount,
                             format('goal:%s:payout:%s:%s', g.id, p_n, m.id), 'Goal: ' || g.title,
                             'system', null, p_goal => g.id, p_goal_n => p_n) is not null then
        v_paid := v_paid + 1;
      end if;
    end loop;
    return jsonb_build_object('type', 'points', 'amount', v_amount, 'children', v_paid);
  elsif v_type = 'catalog_item' and g.member_id is not null then
    insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot, status,
                                   requested_by_type, decided_at, goal_id, goal_n)
    values (gen_random_uuid(), g.household_id, g.member_id, (g.payout ->> 'item_id')::uuid, 0, 'approved',
            'system', now(), g.id, p_n)
    on conflict (goal_id, goal_n) where goal_id is not null do nothing;
    return jsonb_build_object('type', 'catalog_item', 'item_id', g.payout ->> 'item_id');
  end if;
  return jsonb_build_object('type', 'custom');
end $$;

-- [RWD-04][US-409] Brings the points achievement n of a goal paid to what they should be: all of
-- them (p_paid) or none. Each child's entries for it are summed and the difference posted, a
-- `reversal` to take back or a `bonus` to put back, keyed by how many entries there already are, so
-- a goal undone and redone any number of times nets out right. Returns the points moved (signed).
create function private.settle_goal_points(g public.reward_goal, p_n integer, p_paid boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e      record;
  v_diff integer;
  v_sum  integer := 0;
begin
  for e in select l.member_id,
                  sum(l.amount)::integer as net,
                  count(*)::integer as k,
                  (array_agg(l.amount order by l.created_at, l.id))[1] as first
             from public.points_ledger l
            where l.goal_id = g.id and l.goal_n = p_n
            group by l.member_id
            order by l.member_id loop
    v_diff := case when p_paid then e.first else 0 end - e.net;
    if v_diff <> 0 then
      perform private.post_ledger(g.household_id, e.member_id, case when v_diff > 0 then 'bonus' else 'reversal' end,
                                  v_diff, format('goal:%s:payout:%s:%s:%s', g.id, p_n, e.member_id, e.k),
                                  'Goal: ' || g.title, 'system', null, p_goal => g.id, p_goal_n => p_n);
      v_sum := v_sum + v_diff;
    end if;
  end loop;
  return v_sum;
end $$;

-- [RWD-04][US-409] An achieved goal undone: its points come back off, and its shop reward is called
-- off while it hasn't been given. Returns {points (taken back, 0 or more), item ('called_off' |
-- 'given' | null)}; 'given' means the reward stays and the goal needs a parent's look.
create function private.take_back_goal(g public.reward_goal, p_n integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_points integer;
  r        public.redemption;
  v_item   text;
begin
  v_points := -private.settle_goal_points(g, p_n, false);
  select * into r from public.redemption where goal_id = g.id and goal_n = p_n for update;
  if found and r.status = 'approved' then
    update public.redemption set status = 'cancelled', cancelled_at = now() where id = r.id;
    v_item := 'called_off';
  elsif found and r.status = 'fulfilled' then
    v_item := 'given';
  end if;
  return jsonb_build_object('points', v_points, 'item', v_item);
end $$;

-- Raises a goal's review flag, once, with why.
create function private.flag_goal(g public.reward_goal, p_why text, p_pct numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.reward_goal set needs_review = true, updated_at = now() where id = g.id and not needs_review;
  if found then
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
    values (g.household_id, g.id, 'needs_review', 'system',
            jsonb_build_object('n', g.achievement_count, 'pct', p_pct, 'why', p_why));
  end if;
end $$;

-- [RWD-04][RWD-06][RWD-13] save_goal_evaluation (WP-19) learns payouts. As before, it stores the
-- engine's result and applies the status changes once; now also:
--   achieved → achievement n is paid (the `achieved` event says what) · unachieved → its points are
--   taken back and an ungiven shop reward called off (`payout_reversed`); a given one stays and the
--   goal is flagged (`needs_review`, why: reward_given) · a redeemed goal that stops being met is
--   flagged (why: undone) and its points taken back; met again, they are put back (`payout_restored`).
-- A redeemed goal is flagged when it stops being met (it was met at the last evaluation), not at each
-- evaluation while it isn't, so a parent's clearing of the flag sticks.
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

  return jsonb_build_object('saved', true, 'status', g.status, 'pct', v_pct, 'is_achieved', v_met,
                            'transitions', v_done);
end $$;

-- [PTS-04] cancel_redemption (WP-18) refunds only what was spent: a reward a goal paid cost nothing,
-- so calling it off gives nothing back. The rest is as before.
create or replace function public.cancel_redemption(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.redemption;
  v_actor record;
  v_was   text;
begin
  select * into r from public.redemption where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002', hint = 'redemption_not_found';
  end if;
  select * into v_actor from private.redemption_actor(r.household_id);
  if r.status = 'cancelled' then
    return private.redemption_json(r, true);
  end if;
  if r.status not in ('requested', 'approved') then
    raise exception 'that request can no longer be cancelled' using errcode = '23514', hint = 'not_cancellable';
  end if;
  if r.status = 'approved' and v_actor.actor_type <> 'admin' then
    raise exception 'a parent cancels an approved reward' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_was := r.status;
  update public.redemption set status = 'cancelled', cancelled_at = now() where id = p_id returning * into r;
  if v_was = 'approved' and r.cost_snapshot > 0 then
    perform private.post_ledger(r.household_id, r.member_id, 'refund', r.cost_snapshot, 'red:' || r.id || ':refund',
                                (select title from public.reward_catalog_item where id = r.catalog_item_id),
                                'admin', v_actor.actor_id, r.id);
  end if;
  return private.redemption_json(r, false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The preview: a goal's facts for dates and a person not yet saved
-- ---------------------------------------------------------------------------------------------

-- The facts the engine reads for a member's goal (or the family's, p_member null) from p_start to
-- p_to: goal_facts' reading (WP-19), shared so the preview reads exactly what an evaluation would.
create function private.goal_facts_between(p_household uuid, p_member uuid, p_start date, p_to date)
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
             'points', v.points_snapshot)
           order by v.due_date, v.occurrence_id, v.member_id)
      from public.v_member_occurrence v
      join public.chore_occurrence o on o.id = v.occurrence_id
      left join public.chore_completion_event e on e.id = o.status_event_id
     where v.household_id = p_household
       and (p_member is null or v.member_id = p_member)
       and p_to >= p_start
       and ((v.due_date between p_start and p_to)
            or (e.credit_date between p_start and p_to))), '[]'::jsonb)
$$;

-- goal_facts (WP-19) reads through the shared helper; what it returns is unchanged.
create or replace function public.goal_facts(p_goal uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g       public.reward_goal;
  v_today date;
  v_week  integer;
begin
  select * into g from public.reward_goal where id = p_goal;
  if not found then
    raise exception 'no such goal' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.goal_access(g.household_id);
  v_today := private.household_today(g.household_id);
  select h.week_start into v_week from public.household h where h.id = g.household_id;
  return jsonb_build_object(
    'read_at', clock_timestamp(),
    'as_of', v_today,
    'week_start', v_week,
    'rules_version', g.rules_version,
    'goal', jsonb_build_object('id', g.id, 'member_id', g.member_id, 'start_date', g.start_date,
                               'end_date', g.end_date, 'rule_logic', g.rule_logic, 'status', g.status),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'type', r.rule_type, 'target', r.target,
                                          'scope', r.scope, 'params', r.params) order by r.sort_order, r.id)
        from public.reward_rule r where r.goal_id = g.id), '[]'::jsonb),
    'facts', private.goal_facts_between(g.household_id, g.member_id, g.start_date,
                                        least(coalesce(g.end_date, v_today), v_today)));
end $$;

-- [RWD-10][US-406] What an evaluation would read for a goal as a parent's form has it, before it is
-- saved: p_goal {household_id, id (a saved goal's status comes with it; a new one is `scheduled`),
-- member_id (null: the family), start_date, end_date}. For a parent of the household; reads only.
create function public.goal_preview_facts(p_goal jsonb) returns jsonb
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
  if v_start is null or (v_end is not null and v_end < v_start) then
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
    'facts', private.goal_facts_between(v_household, v_member, v_start,
                                        least(coalesce(v_end, v_today), v_today)));
end $$;

revoke all on function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid, uuid, uuid, integer),
  private.clean_goal_payout(uuid, uuid, jsonb, jsonb), private.pay_goal(public.reward_goal, integer),
  private.settle_goal_points(public.reward_goal, integer, boolean), private.take_back_goal(public.reward_goal, integer),
  private.flag_goal(public.reward_goal, text, numeric), private.goal_facts_between(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.goal_preview_facts(jsonb) from public, anon;
grant execute on function public.goal_preview_facts(jsonb) to authenticated;
