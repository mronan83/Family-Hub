-- [RWD-01][RWD-04][RWD-06][RWD-09][CHR-10] Goals (WP-19, 02 §3.3, D-56): a parent sets a child (or the
-- whole family) a goal with dates and rules; the rules engine (evaluateGoal, 02 §5) works out its
-- progress and status from the facts as they stand. As with streak history (D-55), the engine runs in
-- TypeScript, so the database keeps the goals, the facts and the results:
--   * a trigger marks a goal dirty when anything it counts may have changed (a check-off, an uncheck,
--     a late credit, day close, an item's tags), and so does saving its rules;
--   * the progress_reconcile job (every 5 minutes) evaluates each dirty goal, each goal whose dates
--     call for a change, and every open goal once a day; the admin Goals page does the same before it
--     reads, so a preview (no job secret) shows it too;
--   * save_goal_evaluation() stores the result and applies the status changes it calls for, once:
--     an evaluation read before the goal changed is refused, so two at once can't both achieve it.
-- Achievement follows the facts: a reversed check-off that leaves the rules unmet takes an achieved
-- goal back to active (`unachieved`), and meeting them again is a new achievement (n + 1).
-- Payouts (WP-39) and the board's goals (WP-20) build on this.

-- ---------------------------------------------------------------------------------------------
-- Goals and their rules
-- ---------------------------------------------------------------------------------------------

create table public.reward_goal (
  id                uuid primary key,            -- made by the form: saving twice is one goal
  household_id      uuid not null references public.household (id) on delete cascade,
  member_id         uuid,                        -- null: a family goal
  title             text not null check (title = btrim(title) and length(title) between 1 and 80),
  description       text check (description = btrim(description) and length(description) between 1 and 300),
  icon              text not null default 'trophy' check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- A photo in the private `rewards` bucket: '{household}/{goal}/{file}' (the shop's bucket, D-53).
  image_path        text check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  -- What achieving it pays out (RWD-13); executed from WP-39. Custom: the celebration and the redeem step.
  payout            jsonb not null default '{"type": "custom"}'
                      check (payout ->> 'type' in ('custom', 'points', 'catalog_item')),
  start_date        date not null,
  end_date          date check (end_date is null or end_date >= start_date),
  rule_logic        text not null default 'all' check (rule_logic in ('all', 'any')),
  status            text not null default 'scheduled'
                      check (status in ('draft', 'scheduled', 'active', 'achieved', 'redeemed', 'expired',
                                        'cancelled')),
  achievement_count integer not null default 0 check (achievement_count >= 0),  -- n of the latest
  achieved_at       timestamptz,
  redeemed_at       timestamptz,
  redeemed_by       uuid,
  celebrated_at     timestamptz,                 -- set by the board once it has celebrated (WP-20)
  needs_review      boolean not null default false,  -- redeemed, then a check-off it needed was reversed
  rules_version     integer not null default 1 check (rules_version > 0),
  archived_at       timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id)
);
create index on public.reward_goal (household_id, status);
create index on public.reward_goal (member_id) where member_id is not null;

create table public.reward_rule (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  goal_id      uuid not null,
  rule_type    text not null check (rule_type in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS')),
  target       integer not null check (target between 1 and 100000),
  -- {"all": true}, or {"tag_ids": [...]} and/or {"chore_ids": [...]} (tags by id, D-33).
  scope        jsonb not null default '{"all": true}',
  params       jsonb not null default '{}',
  sort_order   integer not null default 0,
  unique (household_id, id),
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id) on delete cascade
);
create index on public.reward_rule (goal_id, sort_order);

-- ---------------------------------------------------------------------------------------------
-- Derived: what the engine made of each goal and rule. Rebuildable from the facts at any time.
-- ---------------------------------------------------------------------------------------------

create table public.reward_goal_progress (
  goal_id        uuid primary key,
  household_id   uuid not null,
  pct            numeric(5, 2) not null default 0 check (pct between 0 and 100),
  is_achieved    boolean not null default false,
  dirty          boolean not null default true,
  marked_at      timestamptz not null default clock_timestamp(),  -- when it was last marked dirty
  rules_version  integer not null default 0,     -- the goal's rules_version this was computed for
  engine_version integer not null default 0,
  computed_at    timestamptz,
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id) on delete cascade
);

create table public.reward_rule_progress (
  rule_id              uuid primary key,
  household_id         uuid not null,
  goal_id              uuid not null,
  current_value        integer not null,
  target_value         integer not null,
  pct                  numeric(5, 2) not null check (pct between 0 and 100),
  current_streak       integer,
  best_streak          integer,
  last_qualifying_date date,
  is_met               boolean not null,
  engine_version       integer not null check (engine_version > 0),
  computed_at          timestamptz not null default now(),
  foreign key (household_id, rule_id) references public.reward_rule (household_id, id) on delete cascade
);
create index on public.reward_rule_progress (goal_id);

-- The goal's lifecycle log: what happened, who or what did it, and when. Drives the board's
-- celebration (WP-20), payouts (WP-39) and the parent's history.
create table public.reward_goal_event (
  id           bigint generated always as identity primary key,
  household_id uuid not null,
  goal_id      uuid not null,
  type         text not null check (type in ('created', 'edited', 'activated', 'rules_changed', 'recomputed',
                                             'achieved', 'unachieved', 'payout_reversed', 'needs_review',
                                             'redeemed', 'expired', 'cancelled')),
  actor_type   text not null check (actor_type in ('admin', 'system')),
  actor_id     uuid,
  payload      jsonb not null default '{}',
  at           timestamptz not null default clock_timestamp(),
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id) on delete cascade
);
create index on public.reward_goal_event (goal_id, at);

-- ---------------------------------------------------------------------------------------------
-- Dirty marks
-- ---------------------------------------------------------------------------------------------

-- An occurrence whose status, credit or points changed marks every goal it may count for: the family's
-- goals, and the goals of everyone it concerns (its assignees and whoever did it, before and after),
-- when its date is inside the goal's dates (a task counts on the day it was done, so any task).
create function private.mark_goals_dirty_for_occurrence() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reward_goal_progress p
     set dirty = true, marked_at = clock_timestamp()
    from public.reward_goal g
   where p.goal_id = g.id
     and g.household_id = new.household_id
     and g.status in ('scheduled', 'active', 'achieved', 'expired', 'redeemed')
     and (g.member_id is null
          or g.member_id = any (old.done_by)
          or g.member_id = any (new.done_by)
          or exists (select from public.chore_occurrence_assignee a
                      where a.occurrence_id = new.id and a.member_id = g.member_id))
     and (new.kind = 'task'
          or (new.due_date >= g.start_date and (g.end_date is null or new.due_date <= g.end_date)));
  return null;
end $$;
create trigger trg_occurrence_goals_dirty
  after update of status, done_by, points_snapshot on public.chore_occurrence
  for each row
  when ((old.status, old.done_by, old.points_snapshot) is distinct from (new.status, new.done_by, new.points_snapshot))
  execute function private.mark_goals_dirty_for_occurrence();

-- Occurrences planned or removed (an edit re-plans today, D-45), or an item's tags changed (a goal may
-- count a tag): every open goal of the household is marked. One update per statement.
create function private.mark_household_goals_dirty() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reward_goal_progress p
     set dirty = true, marked_at = clock_timestamp()
    from public.reward_goal g
   where p.goal_id = g.id
     and g.status in ('scheduled', 'active', 'achieved')
     and g.household_id in (select distinct c.household_id from changed c);
  return null;
end $$;
create trigger trg_occurrence_insert_goals_dirty after insert on public.chore_occurrence
  referencing new table as changed for each statement execute function private.mark_household_goals_dirty();
create trigger trg_occurrence_delete_goals_dirty after delete on public.chore_occurrence
  referencing old table as changed for each statement execute function private.mark_household_goals_dirty();
create trigger trg_chore_tag_insert_goals_dirty after insert on public.chore_tag
  referencing new table as changed for each statement execute function private.mark_household_goals_dirty();
create trigger trg_chore_tag_delete_goals_dirty after delete on public.chore_tag
  referencing old table as changed for each statement execute function private.mark_household_goals_dirty();

-- ---------------------------------------------------------------------------------------------
-- Who may: a parent of the household, or the job (service role). Raises otherwise.
-- ---------------------------------------------------------------------------------------------

create function private.goal_access(p_household uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null
     or not (coalesce((select auth.role()), '') = 'service_role'
             or p_household in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- A parent's goal: create or change one with its rules, redeem it, cancel it, clear a review flag
-- ---------------------------------------------------------------------------------------------

-- Checks a rule list and returns it in the stored shape (sorted keys; scope ids sorted and unique), so
-- an unchanged list compares equal. Raises with a hint naming what to fix.
create function private.clean_goal_rules(p_household uuid, p_rules jsonb) returns jsonb
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
    if v_type is null or v_type not in ('COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS') then
      raise exception 'unknown rule type' using errcode = '22023', hint = 'rule_type';
    end if;
    if coalesce(jsonb_typeof(r -> 'target'), '') <> 'number' or (r ->> 'target')::numeric not between 1 and 100000
       or (r ->> 'target')::numeric <> trunc((r ->> 'target')::numeric) then
      raise exception 'a target is a whole number from 1 to 100000' using errcode = '22023', hint = 'rule_target';
    end if;
    v_target := (r ->> 'target')::integer;

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
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', v_type, 'target', v_target, 'scope', v_scope, 'params', v_params));
  end loop;
  return v_out;
end $$;

-- [RWD-01][RWD-02][RWD-03] Adds a goal or changes one, with its rules, as a parent of the household.
-- p_goal: {id, household_id, member_id (null: the family), title, description, icon, start_date,
-- end_date, rule_logic, rules: [{type, target, scope, params}]} and, when given, image_path (null
-- removes the photo). Saving the same id again changes that goal, so a form sent twice is one goal.
-- A goal is only for a member who earns rewards, or the whole family. Once a goal has started, its
-- person and start date stay; once it is redeemed, expired or cancelled, only its name, description,
-- icon and photo change. Changing its dates, logic or rules starts a new rules version: a
-- `rules_changed` event, and the next evaluation recomputes it from all its facts (`recomputed`).
create function public.save_goal(p_goal jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_household uuid;
  v_member    uuid := nullif(p_goal ->> 'member_id', '')::uuid;
  v_old       public.reward_goal;
  v_rules     jsonb;
  v_old_rules jsonb;
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

  if v_new then
    insert into public.reward_goal (id, household_id, member_id, title, description, icon, image_path,
                                    start_date, end_date, rule_logic, created_by)
    values (v_id, v_household, v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
            coalesce(p_goal ->> 'icon', 'trophy'), p_goal ->> 'image_path', v_start, v_end, v_logic, v_uid);
    insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
    select v_household, v_id, r.value ->> 'type', (r.value ->> 'target')::integer, r.value -> 'scope',
           r.value -> 'params', r.ordinality::integer
      from jsonb_array_elements(v_rules) with ordinality r;
    insert into public.reward_goal_progress (goal_id, household_id) values (v_id, v_household);
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
    values (v_household, v_id, 'created', 'admin', v_uid,
            jsonb_build_object('member_id', v_member, 'start_date', v_start, 'end_date', v_end,
                               'rule_logic', v_logic, 'rules', v_rules));
    return jsonb_build_object('id', v_id, 'created', true, 'rules_changed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', r.rule_type, 'target', r.target, 'scope', r.scope,
                                               'params', r.params) order by r.sort_order, r.id), '[]')
    into v_old_rules from public.reward_rule r where r.goal_id = v_id;
  v_changed := (v_old.start_date, v_old.end_date, v_old.rule_logic, v_old_rules)
               is distinct from (v_start, v_end, v_logic, v_rules);

  if v_old.status in ('redeemed', 'expired', 'cancelled')
     and (v_changed or v_member is distinct from v_old.member_id) then
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
         start_date = v_start, end_date = v_end, rule_logic = v_logic,
         rules_version = rules_version + case when v_changed then 1 else 0 end,
         updated_at = now()
   where id = v_id
     and (v_changed
          or (member_id, title, description, icon, image_path, start_date, end_date, rule_logic)
             is distinct from (v_member, btrim(p_goal ->> 'title'), nullif(btrim(p_goal ->> 'description'), ''),
                               coalesce(p_goal ->> 'icon', icon),
                               case when p_goal ? 'image_path' then p_goal ->> 'image_path' else image_path end,
                               v_start, v_end, v_logic));
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
                                                        'rule_logic', v_logic, 'rules', v_rules)));
  else
    insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id)
    values (v_household, v_id, 'edited', 'admin', v_uid);
  end if;
  return jsonb_build_object('id', v_id, 'created', false, 'rules_changed', v_changed);
end $$;

-- [RWD-09][US-405] A parent marks an achieved goal redeemed: the reward was given. Safe to send twice.
create function public.redeem_goal(p_goal uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  g     public.reward_goal;
begin
  select * into g from public.reward_goal where id = p_goal for update;
  if v_uid is null or not found or g.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if g.status = 'redeemed' then
    return jsonb_build_object('id', g.id, 'status', g.status, 'duplicate', true);
  end if;
  if g.status <> 'achieved' then
    raise exception 'only an achieved goal can be redeemed' using errcode = '22023', hint = 'not_achieved';
  end if;
  update public.reward_goal
     set status = 'redeemed', redeemed_at = now(), redeemed_by = v_uid, updated_at = now()
   where id = g.id;
  insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
  values (g.household_id, g.id, 'redeemed', 'admin', v_uid, jsonb_build_object('n', g.achievement_count));
  return jsonb_build_object('id', g.id, 'status', 'redeemed', 'duplicate', false);
end $$;

-- [RWD-06] A parent cancels a goal that isn't redeemed: it stops, and moves to history. Safe to send twice.
create function public.cancel_goal(p_goal uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  g     public.reward_goal;
begin
  select * into g from public.reward_goal where id = p_goal for update;
  if v_uid is null or not found or g.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if g.status = 'cancelled' then
    return jsonb_build_object('id', g.id, 'status', g.status, 'duplicate', true);
  end if;
  if g.status = 'redeemed' then
    raise exception 'a redeemed goal stays redeemed' using errcode = '22023', hint = 'goal_redeemed';
  end if;
  update public.reward_goal
     set status = 'cancelled', archived_at = now(), updated_at = now()
   where id = g.id;
  insert into public.reward_goal_event (household_id, goal_id, type, actor_type, actor_id, payload)
  values (g.household_id, g.id, 'cancelled', 'admin', v_uid, jsonb_build_object('from', g.status));
  return jsonb_build_object('id', g.id, 'status', 'cancelled', 'duplicate', false);
end $$;

-- A parent has looked at a redeemed goal whose check-offs were reversed: the flag goes.
create function public.clear_goal_review(p_goal uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.reward_goal;
begin
  select * into g from public.reward_goal where id = p_goal;
  if auth.uid() is null or not found or g.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  update public.reward_goal set needs_review = false, updated_at = now() where id = g.id and needs_review;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The pipeline: list, read, save
-- ---------------------------------------------------------------------------------------------

-- [RWD-04] The goals of a household to evaluate now: marked dirty, never computed, computed by another
-- engine or for older rules, scheduled to start, past their end, or (open goals) not yet computed
-- today. For the job, or a parent of the household (the Goals page evaluates them before it reads).
create function public.goals_to_evaluate(p_household uuid, p_engine_version integer)
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
   order by g.created_at, g.id;
end $$;

-- [RWD-04] Everything the engine reads for one goal (02 §5 GoalInput): the goal as it stands, its rules
-- and its rules version, the household's today and first day of the week, and the facts inside its
-- dates up to today: the member's, or the whole family's for a family goal; every item whatever its
-- visibility (a private chore still counts). `read_at` lets the save keep a mark made after the read.
create function public.goal_facts(p_goal uuid) returns jsonb
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
  v_to := least(coalesce(g.end_date, v_today), v_today);
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
    'facts', coalesce((
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
       where v.household_id = g.household_id
         and (g.member_id is null or v.member_id = g.member_id)
         and v_to >= g.start_date
         and ((v.due_date between g.start_date and v_to)
              or (e.credit_date between g.start_date and v_to))), '[]'::jsonb));
end $$;

-- [RWD-04][RWD-06] Stores what the engine made of a goal and applies the status changes it calls for,
-- in order, once. p_evaluation is the engine's GoalEvaluation; p_status and p_rules_version are what
-- the goal_facts read saw. If the goal changed since (another evaluation, a parent's edit), nothing
-- is stored and the goal stays dirty: the next run reads it again. A rule's or the goal's row is
-- rewritten only when its values change. The dirty mark clears unless it was made after `p_read_at`.
--   started → activated · achieved → n + 1, achieved_at now, celebration due · unachieved → back to
--   active, achieved_at and celebrated_at cleared · expired · needs_review (a redeemed goal no longer
--   met; flagged once, the status stays). A new rules version is logged `recomputed` with the old and
--   new progress.
create function public.save_goal_evaluation(
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
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'achieved', 'system', jsonb_build_object('n', v_n, 'pct', v_pct));
      when 'unachieved' then
        update public.reward_goal
           set status = 'active', achieved_at = null, celebrated_at = null, updated_at = now()
         where id = g.id;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'unachieved', 'system',
                jsonb_build_object('n', g.achievement_count, 'pct', v_pct));
      when 'expired' then
        update public.reward_goal set status = 'expired', updated_at = now() where id = g.id;
        insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
        values (g.household_id, g.id, 'expired', 'system', jsonb_build_object('pct', v_pct));
      when 'needs_review' then
        if not g.needs_review then
          update public.reward_goal set needs_review = true, updated_at = now() where id = g.id;
          g.needs_review := true;
          insert into public.reward_goal_event (household_id, goal_id, type, actor_type, payload)
          values (g.household_id, g.id, 'needs_review', 'system',
                  jsonb_build_object('n', g.achievement_count, 'pct', v_pct));
        end if;
      else
        raise exception 'unknown transition' using errcode = '22023', hint = 'bad_request';
    end case;
    v_done := v_done || jsonb_build_array(t ->> 'type');
    g.status := t ->> 'to';
  end loop;

  return jsonb_build_object('saved', true, 'status', g.status, 'pct', v_pct, 'is_achieved', v_met,
                            'transitions', v_done);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents read everything; its boards read the goals, their
-- rules and progress (WP-20). Only the functions above write.
-- ---------------------------------------------------------------------------------------------

alter table public.reward_goal enable row level security;
alter table public.reward_rule enable row level security;
alter table public.reward_goal_progress enable row level security;
alter table public.reward_rule_progress enable row level security;
alter table public.reward_goal_event enable row level security;

create policy reward_goal_admin_select on public.reward_goal for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_goal_device_select on public.reward_goal for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy reward_rule_admin_select on public.reward_rule for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_rule_device_select on public.reward_rule for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy reward_goal_progress_admin_select on public.reward_goal_progress for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_goal_progress_device_select on public.reward_goal_progress for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy reward_rule_progress_admin_select on public.reward_rule_progress for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_rule_progress_device_select on public.reward_rule_progress for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy reward_goal_event_admin_select on public.reward_goal_event for select to authenticated
  using (household_id in (select private.admin_household_ids()));

revoke all on public.reward_goal, public.reward_rule, public.reward_goal_progress, public.reward_rule_progress,
  public.reward_goal_event from public, anon;
revoke insert, update, delete, truncate on public.reward_goal, public.reward_rule, public.reward_goal_progress,
  public.reward_rule_progress, public.reward_goal_event from authenticated;
grant select on public.reward_goal, public.reward_rule, public.reward_goal_progress, public.reward_rule_progress,
  public.reward_goal_event to authenticated;

-- A parent's edits to goals and rules are audited like any other setting (the derived rows aren't).
create trigger trg_audit after insert or update or delete on public.reward_goal
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.reward_rule
  for each row execute function private.audit_row();

revoke all on function private.mark_goals_dirty_for_occurrence(), private.mark_household_goals_dirty(),
  private.goal_access(uuid), private.clean_goal_rules(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_goal(jsonb), public.redeem_goal(uuid), public.cancel_goal(uuid),
  public.clear_goal_review(uuid), public.goals_to_evaluate(uuid, integer), public.goal_facts(uuid),
  public.save_goal_evaluation(uuid, text, integer, jsonb, integer, timestamptz) from public, anon;
grant execute on function public.save_goal(jsonb), public.redeem_goal(uuid), public.cancel_goal(uuid),
  public.clear_goal_review(uuid) to authenticated;
grant execute on function public.goals_to_evaluate(uuid, integer), public.goal_facts(uuid),
  public.save_goal_evaluation(uuid, text, integer, jsonb, integer, timestamptz) to authenticated, service_role;
