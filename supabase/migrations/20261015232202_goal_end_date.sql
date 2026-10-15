-- [RWD-14] WP-79: a goal's end date that can be cleared (D-115). The form's part is in the app; the
-- database's is save_goal (WP-39's, from 20261011050000_goal_payouts), as before but for two rules
-- the owner set with the mockup:
--   * a reached goal (achieved, waiting to be redeemed) keeps its rules, dates, person and payout,
--     as a finished one does, so a change can't take back what reaching it unlocked (hint
--     goal_achieved); its name, description and picture still change. Undone by a check-off, it is
--     going again and can change;
--   * a started goal's end date, added or moved, is today or later in the household's own day, so a
--     goal never ends backwards in time (hint end_in_past). Taking it off is always allowed.

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
  if v_old.status = 'achieved'
     and (v_changed or v_member is distinct from v_old.member_id or v_payout is distinct from v_old.payout) then
    raise exception 'a reached goal keeps its rules' using errcode = '22023', hint = 'goal_achieved';
  end if;
  if v_old.status not in ('draft', 'scheduled')
     and (v_member is distinct from v_old.member_id or v_start <> v_old.start_date) then
    raise exception 'a started goal keeps its person and start date' using errcode = '22023', hint = 'goal_started';
  end if;
  if v_old.status not in ('draft', 'scheduled') and v_end is distinct from v_old.end_date
     and v_end < private.household_today(v_household) then
    raise exception 'a started goal ends today or later' using errcode = '22023', hint = 'end_in_past';
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
