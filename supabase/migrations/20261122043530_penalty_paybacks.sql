-- [PTS-11] Penalties paid back through a goal (WP-122, D-154, D-158; 02 §4.2e).
--   * `penalty_rule.payback_goal_id`, `payback_amount`: a rule's "Paid back by": a goal of the
--     household (for one of the rule's people, or the family's) and what each win pays back, in the
--     rule's unit.
--   * `penalty_payback`: one win's payback on a rule and person: the goal, which achievement (n), the
--     amount actually paid back (never more than was owed). Changes once, when the win is undone.
--   * In money a payback is payments (`penalty_payment.payback_id`, by nobody), spread over the misses
--     oldest first as Record paid is; undone, the same payments are posted again negative, so every
--     sum of payments (what is owed, everywhere) stays right and nothing is edited.
--   * In points a payback is a `penalty_payback` ledger entry (+amount); undone, one of −amount (D-49).
--   * What a rule has on a person (`private.penalty_rule_held()`) now counts points paid back too, so a
--     points rule's max counts what is still to earn back (D-158).
--   * A goal's `achieved` event (a won period, or a one-off goal reached) pays back each of the rule's
--     people it is for; its `unachieved` event takes those paybacks back. Nothing is paid back while
--     penalties are off, or while nothing is owed (paused).
-- Every write goes through definer functions. Parents and boards of the household read paybacks;
-- boards read what each rule pays back through `private.board_paybacks()` in board_snapshot(), never
-- the rule itself.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

alter table public.penalty_rule
  add column payback_goal_id uuid,
  add column payback_amount  integer check (payback_amount between 1 and 100000),  -- points, or cents
  add constraint penalty_rule_payback_goal_fk foreign key (household_id, payback_goal_id)
    references public.reward_goal (household_id, id),
  add constraint penalty_rule_payback_pair check ((payback_goal_id is null) = (payback_amount is null)),
  add constraint penalty_rule_payback_points check (unit <> 'points' or payback_amount <= 10000);
create index on public.penalty_rule (payback_goal_id) where payback_goal_id is not null;

create table public.penalty_payback (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  rule_id       uuid not null,
  member_id     uuid not null,
  goal_id       uuid not null,
  goal_n        integer not null check (goal_n >= 1),
  period_start  date,
  period_end    date,
  unit          text not null check (unit in ('points', 'money')),
  amount        integer not null check (amount between 1 and 100000),  -- points, or cents
  paid_at       timestamptz not null default clock_timestamp(),
  taken_back_at timestamptz,
  unique (household_id, id),
  unique (rule_id, member_id, goal_id, goal_n),
  foreign key (household_id, rule_id) references public.penalty_rule (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, goal_id) references public.reward_goal (household_id, id)
);
create index on public.penalty_payback (household_id, member_id, paid_at desc);
create index on public.penalty_payback (goal_id, goal_n);

-- A payback's money: payments by nobody (the system), and, undone, the same again negative.
alter table public.penalty_payment
  add column payback_id uuid,
  alter column recorded_by drop not null,
  add constraint penalty_payment_payback_fk foreign key (household_id, payback_id)
    references public.penalty_payback (household_id, id),
  add constraint penalty_payment_by check (recorded_by is not null or payback_id is not null),
  drop constraint penalty_payment_amount_check,
  add constraint penalty_payment_amount_check
    check (amount between 1 and 100000 or (payback_id is not null and amount between -100000 and -1));
create index on public.penalty_payment (payback_id) where payback_id is not null;

-- The ledger's new type: points paid back by a win (positive) or taken back with it (negative).
alter table public.points_ledger
  add column penalty_payback_id uuid,
  add constraint points_ledger_penalty_payback_fk foreign key (household_id, penalty_payback_id)
    references public.penalty_payback (household_id, id),
  drop constraint points_ledger_entry_type_check,
  add constraint points_ledger_entry_type_check check (entry_type in
    ('earn', 'reversal', 'bonus', 'spend', 'refund', 'adjustment', 'penalty', 'penalty_payback')),
  add constraint points_ledger_penalty_payback_pair
    check ((entry_type = 'penalty_payback') = (penalty_payback_id is not null));
create index on public.points_ledger (penalty_payback_id) where penalty_payback_id is not null;

-- Append-only: a payback changes once, when its win is undone; it goes only with its household.
create function private.prevent_payback_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.taken_back_at is null and new.taken_back_at is not null
     and (to_jsonb(new) - 'taken_back_at') = (to_jsonb(old) - 'taken_back_at') then
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select from public.household where id = old.household_id) then
    return old;
  end if;
  raise exception 'paybacks are append-only' using errcode = '42501', hint = 'append_only';
end $$;
create trigger trg_penalty_payback_immutable before update or delete on public.penalty_payback
  for each row execute function private.prevent_payback_change();

-- ---------------------------------------------------------------------------------------------
-- What a rule has on a person, and paying back
-- ---------------------------------------------------------------------------------------------

-- [PTS-10][PTS-11] What a rule has on a person: in money, what is owed on its misses (less what was
-- paid, paybacks included); in points, the points its misses took less the points paid back (D-158).
-- Misses taken back count for nothing (D-157).
create or replace function private.penalty_rule_held(p_rule uuid, p_member uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(0,
    coalesce((select sum(p.amount - case when p.unit = 'money'
                                         then coalesce((select sum(x.amount) from public.penalty_payment x
                                                         where x.penalty_id = p.id), 0) else 0 end)
                from public.penalty p
               where p.rule_id = p_rule and p.member_id = p_member and p.taken_back_at is null), 0)
    - coalesce((select sum(b.amount) from public.penalty_payback b
                 where b.rule_id = p_rule and b.member_id = p_member and b.unit = 'points'
                   and b.taken_back_at is null), 0))::integer
$$;

-- "Week won: Folder home every school day"; a one-off goal, "Goal reached: …".
create function private.payback_words(g public.reward_goal) returns text
language sql immutable set search_path = '' as $$
  select case g.repeats when 'week' then 'Week won: ' when 'month' then 'Month won: '
                        when 'term' then 'Term won: ' else 'Goal reached: ' end || g.title
$$;

-- [PTS-11][US-1113] Win n of goal g pays back what rule r has on a person: the rule's payback amount,
-- never more than is owed, once. In money, payments over the misses oldest first; in points, a
-- `penalty_payback` ledger entry. Returns what it paid back (0: paused, or already paid back).
create function private.pay_back_rule(r public.penalty_rule, p_member uuid, g public.reward_goal, p_n integer,
                                      p_start date, p_end date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_amount integer := least(r.payback_amount, private.penalty_rule_held(r.id, p_member));
  v_left   integer;
  v_take   integer;
  v_id     uuid;
  p        record;
begin
  if v_amount is null or v_amount < 1 then
    return 0;
  end if;
  insert into public.penalty_payback (household_id, rule_id, member_id, goal_id, goal_n, period_start, period_end,
                                      unit, amount)
  values (r.household_id, r.id, p_member, g.id, p_n, p_start, p_end, r.unit, v_amount)
  on conflict (rule_id, member_id, goal_id, goal_n) do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;
  if r.unit = 'points' then
    insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                      created_by_type, created_by, penalty_payback_id)
    values (r.household_id, p_member, 'penalty_payback', v_amount, private.payback_words(g),
            'payback:' || v_id, 'system', null, v_id);
  else
    v_left := v_amount;
    for p in select q.id, private.penalty_owed(q.id) as owed
               from public.penalty q
              where q.rule_id = r.id and q.member_id = p_member and q.taken_back_at is null
              order by q.missed_on, q.given_at, q.id
                for update loop
      exit when v_left = 0;
      v_take := least(v_left, p.owed);
      if v_take > 0 then
        insert into public.penalty_payment (household_id, penalty_id, amount, recorded_by, dedupe_key, payback_id)
        values (r.household_id, p.id, v_take, null, 'payback:' || v_id || ':' || p.id, v_id);
        v_left := v_left - v_take;
      end if;
    end loop;
  end if;
  return v_amount;
end $$;

-- [PTS-11][US-1113] A payback whose win was undone: taken back once. In money its payments are posted
-- again negative (owed again); in points a `penalty_payback` entry of −amount.
create function private.take_back_payback(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  b public.penalty_payback;
  x public.penalty_payment;
begin
  update public.penalty_payback set taken_back_at = clock_timestamp()
   where id = p_id and taken_back_at is null
  returning * into b;
  if not found then
    return false;
  end if;
  if b.unit = 'points' then
    insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                      created_by_type, created_by, penalty_payback_id)
    select b.household_id, b.member_id, 'penalty_payback', -b.amount,
           private.payback_words(g) || ', undone', 'payback-back:' || b.id, 'system', null, b.id
      from public.reward_goal g where g.id = b.goal_id;
  else
    for x in select * from public.penalty_payment where payback_id = b.id and amount > 0 order by recorded_at, id loop
      insert into public.penalty_payment (household_id, penalty_id, amount, recorded_by, dedupe_key, payback_id)
      values (x.household_id, x.penalty_id, -x.amount, null, 'payback-back:' || x.id, b.id);
    end loop;
  end if;
  return true;
end $$;

-- [PTS-11][US-1113][D-154] After each goal event: `achieved` (a won period, or a one-off goal reached)
-- pays back each rule linked to the goal, for each of the rule's people the goal is for (its person;
-- a family goal, each of them), while penalties are on; `unachieved` takes back that win's paybacks.
create function private.penalty_paybacks_on_goal_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g    public.reward_goal;
  r    public.penalty_rule;
  m    record;
  b    record;
  v_n  integer := (new.payload ->> 'n')::integer;
begin
  if v_n is null then
    return null;
  end if;
  select * into g from public.reward_goal where id = new.goal_id;
  if new.type = 'achieved' then
    if not coalesce((select s.penalties_on from public.household_settings s
                      where s.household_id = g.household_id), false) then
      return null;
    end if;
    for r in select * from public.penalty_rule where payback_goal_id = g.id order by created_at, id loop
      for m in select rm.member_id
                 from public.penalty_rule_member rm
                 join public.member mm on mm.id = rm.member_id
                where rm.rule_id = r.id and mm.archived_at is null
                  and (g.member_id is null or rm.member_id = g.member_id)
                order by rm.member_id loop
        perform private.pay_back_rule(r, m.member_id, g, v_n, (new.payload ->> 'period_start')::date,
                                      (new.payload ->> 'period_end')::date);
      end loop;
    end loop;
  elsif new.type = 'unachieved' then
    for b in select id from public.penalty_payback
              where goal_id = g.id and goal_n = v_n and taken_back_at is null
              order by paid_at, id loop
      perform private.take_back_payback(b.id);
    end loop;
  end if;
  return null;
end $$;
create trigger trg_goal_event_penalty_paybacks after insert on public.reward_goal_event
  for each row when (new.type in ('achieved', 'unachieved'))
  execute function private.penalty_paybacks_on_goal_event();

-- [PTS-11] What each rule with a goal pays back, per person, for the household's boards and parents:
-- the rule's name, the goal (its title and period), what a win pays back and what is owed (0: paused),
-- while penalties are on. A rule stopped or past its end shows only while something is owed on it.
create function private.board_paybacks(p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
begin
  if p_household is null or (p_household is distinct from private.device_household_id()
                             and p_household not in (select private.admin_household_ids())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if not coalesce((select s.penalties_on from public.household_settings s where s.household_id = p_household), false) then
    return '[]'::jsonb;
  end if;
  v_today := private.household_today(p_household);
  return coalesce((
    select jsonb_agg(jsonb_build_object('rule_id', x.rule_id, 'rule', x.rule, 'member_id', x.member_id,
                                        'unit', x.unit, 'amount', x.amount, 'owed', x.owed,
                                        'goal_id', x.goal_id, 'goal', x.goal, 'repeat', x.repeats)
                     order by x.created_at, x.rule_id, x.member_id)
      from (select r.id as rule_id, r.name as rule, rm.member_id, r.unit, r.payback_amount as amount,
                   private.penalty_rule_held(r.id, rm.member_id) as owed, g.id as goal_id, g.title as goal,
                   g.repeats, r.created_at, r.stopped_at, r.end_date
              from public.penalty_rule r
              join public.penalty_rule_member rm on rm.rule_id = r.id
              join public.member mm on mm.id = rm.member_id
              join public.reward_goal g on g.id = r.payback_goal_id
             where r.household_id = p_household and mm.archived_at is null and g.archived_at is null
               and (g.member_id is null or g.member_id = rm.member_id)) x
     where (x.stopped_at is null and x.end_date >= v_today) or x.owed > 0), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The rule form's Paid back by
-- ---------------------------------------------------------------------------------------------

-- [PTS-10][PTS-11] save_penalty_rule as WP-121 left it, with the rule's "Paid back by" (WP-122):
-- payback_goal_id and payback_amount (in the rule's unit), or neither.
create or replace function public.save_penalty_rule(p_household uuid, p_rule jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id      uuid;
  v_old     public.penalty_rule;
  v_name    text := nullif(btrim(p_rule ->> 'name'), '');
  v_reason  public.penalty_reason;
  v_scope   text := p_rule ->> 'scope';
  v_tag     uuid;
  v_start   date;
  v_end     date;
  v_amount  integer;
  v_max     integer;
  v_cap     integer;
  v_members uuid[];
  v_chores  uuid[];
  v_today   date := private.household_today(p_household);
  v_pb_goal uuid;
  v_pb_amt  integer;
  v_goal    public.reward_goal;
begin
  perform private.penalty_admin(p_household);
  begin
    v_id := (p_rule ->> 'id')::uuid;
    v_reason.id := (p_rule ->> 'reason_id')::uuid;
    v_tag := (p_rule ->> 'tag_id')::uuid;
    v_start := (p_rule ->> 'start_date')::date;
    v_end := (p_rule ->> 'end_date')::date;
    v_amount := (p_rule ->> 'amount')::integer;
    v_max := (p_rule ->> 'max_amount')::integer;
    v_members := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_rule -> 'member_ids', '[]')) x);
    v_chores := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_rule -> 'chore_ids', '[]')) x);
    v_pb_goal := (p_rule ->> 'payback_goal_id')::uuid;
    v_pb_amt := (p_rule ->> 'payback_amount')::integer;
  exception when others then
    raise exception 'the rule could not be read' using errcode = '22023', hint = 'bad_request';
  end;
  if v_id is not null then
    select * into v_old from public.penalty_rule where id = v_id and household_id = p_household for update;
    if not found then
      raise exception 'no such rule' using errcode = '22023', hint = 'bad_rule';
    end if;
  end if;
  if not coalesce((select s.penalties_on from public.household_settings s where s.household_id = p_household), false) then
    raise exception 'penalties are off' using errcode = '22023', hint = 'penalties_off';
  end if;
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'name the rule, in up to 80 characters' using errcode = '22023', hint = 'bad_name';
  end if;
  select * into v_reason from public.penalty_reason
   where id = v_reason.id and household_id = p_household
     and (removed_at is null or id = v_old.reason_id);
  if not found then
    raise exception 'choose a reason from the list' using errcode = '22023', hint = 'bad_reason';
  end if;
  if cardinality(v_members) = 0 or exists (
       select from unnest(v_members) x (id)
        where not exists (select from public.member m where m.id = x.id and m.household_id = p_household
                            and m.earns_rewards and m.archived_at is null)) then
    raise exception 'choose people who earn rewards' using errcode = '22023', hint = 'bad_people';
  end if;
  if v_scope is null or v_scope not in ('items', 'tag', 'all') then
    raise exception 'say what counts' using errcode = '22023', hint = 'bad_scope';
  elsif v_scope = 'items' and (cardinality(v_chores) = 0 or exists (
          select from unnest(v_chores) x (id)
           where not exists (select from public.chore c where c.id = x.id and c.household_id = p_household
                               and c.kind = 'chore' and c.archived_at is null))) then
    raise exception 'choose chores of this household' using errcode = '22023', hint = 'bad_items';
  elsif v_scope = 'tag' and not exists (select from public.tag t where t.id = v_tag and t.household_id = p_household
                                          and t.archived_at is null) then
    raise exception 'choose a tag of this household' using errcode = '22023', hint = 'bad_tag';
  end if;
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'an end on or after the start' using errcode = '22023', hint = 'bad_dates';
  elsif v_start < v_today and v_start is distinct from v_old.start_date then
    raise exception 'a rule starts today or later' using errcode = '22023', hint = 'start_past';
  end if;
  v_cap := case when v_reason.unit = 'points' then 10000 else 100000 end;
  if v_amount is null or v_amount < 1 or v_amount > v_cap then
    raise exception 'an amount from 1' using errcode = '22023', hint = 'bad_amount';
  elsif v_max is null or v_max < v_amount or v_max > v_cap then
    raise exception 'a max no less than the amount' using errcode = '22023', hint = 'bad_max';
  end if;
  -- [PTS-11] Paid back by: a goal of the household, still to be won (not archived, reached, expired or
  -- cancelled), for one of the rule's people or the family; and what each win pays back.
  if v_pb_goal is not null then
    select * into v_goal from public.reward_goal
     where id = v_pb_goal and household_id = p_household and archived_at is null
       and status in ('draft', 'scheduled', 'active')
       and (member_id is null or member_id = any(v_members));
    if not found then
      raise exception 'choose a goal of this rule''s people or the family' using errcode = '22023', hint = 'bad_payback_goal';
    elsif v_pb_amt is null or v_pb_amt < 1 or v_pb_amt > v_cap then
      raise exception 'what a win pays back, from 1' using errcode = '22023', hint = 'bad_payback_amount';
    end if;
  else
    v_pb_amt := null;
  end if;

  if v_id is null then
    insert into public.penalty_rule (household_id, name, reason_id, unit, amount, max_amount, scope, tag_id,
                                     start_date, end_date, accrued_through, created_by, payback_goal_id,
                                     payback_amount)
    values (p_household, v_name, v_reason.id, v_reason.unit, v_amount, v_max, v_scope,
            case when v_scope = 'tag' then v_tag end, v_start, v_end, v_start - 1, auth.uid(), v_pb_goal,
            v_pb_amt)
    returning id into v_id;
  else
    if v_reason.unit <> v_old.unit then
      raise exception 'a rule keeps its unit' using errcode = '22023', hint = 'unit_changed';
    end if;
    update public.penalty_rule
       set name = v_name, reason_id = v_reason.id, amount = v_amount, max_amount = v_max, scope = v_scope,
           tag_id = case when v_scope = 'tag' then v_tag end, start_date = v_start, end_date = v_end,
           payback_goal_id = v_pb_goal, payback_amount = v_pb_amt,
           -- A start moved later than the days already worked out begins there.
           accrued_through = greatest(coalesce(accrued_through, v_start - 1), v_start - 1)
     where id = v_id;
    delete from public.penalty_rule_member where rule_id = v_id;
    delete from public.penalty_rule_chore where rule_id = v_id;
  end if;
  insert into public.penalty_rule_member (household_id, rule_id, member_id)
  select p_household, v_id, unnest(v_members);
  if v_scope = 'items' then
    insert into public.penalty_rule_chore (household_id, rule_id, chore_id)
    select p_household, v_id, unnest(v_chores);
  end if;
  return v_id;
end $$;

-- [PTS-08][PTS-10][PTS-11] points_register as WP-121 left it; a payback is its own kind, `penalty_payback`,
-- with its goal (goal_id, goal_title) and its rule (penalty_rule).
create or replace function public.points_register(
  p_household uuid,
  p_members   uuid[]  default null,  -- null or empty: every member
  p_kinds     text[]  default null,  -- earn, bonus, goal, adjustment, spend, refund, reversal, penalty, penalty_payback
  p_rule      uuid    default null,  -- one bonus rule's payouts
  p_from      date    default null,  -- the household's own days, both ends included
  p_to        date    default null,
  p_limit     integer default 50,
  p_offset    integer default 0)
returns table (
  id              uuid,
  member_id       uuid,
  kind            text,
  amount          integer,
  created_at      timestamptz,
  reason          text,
  occurrence_id   uuid,
  item_title      text,
  goal_id         uuid,
  goal_title      text,
  points_rule_id  uuid,
  created_by_type text,
  created_by      uuid,
  penalty_rule    text)
language sql stable security invoker set search_path = '' as $$
  with h as (select timezone from public.household where id = p_household)
  select l.id, l.member_id,
         case when l.entry_type = 'bonus' and l.goal_id is not null then 'goal' else l.entry_type end,
         l.amount, l.created_at, l.reason, l.occurrence_id, c.title, coalesce(l.goal_id, pb.goal_id),
         coalesce(g.title, pbg.title), l.points_rule_id, l.created_by_type, l.created_by, coalesce(pr.name, pbr.name)
    from public.points_ledger l
    cross join h
    left join public.chore_occurrence o on o.id = l.occurrence_id
    left join public.chore c on c.id = o.chore_id
    left join public.reward_goal g on g.id = l.goal_id
    left join public.penalty pe on pe.id = l.penalty_id
    left join public.penalty_rule pr on pr.id = pe.rule_id
    left join public.penalty_payback pb on pb.id = l.penalty_payback_id
    left join public.penalty_rule pbr on pbr.id = pb.rule_id
    left join public.reward_goal pbg on pbg.id = pb.goal_id
   where l.household_id = p_household
     and (coalesce(cardinality(p_members), 0) = 0 or l.member_id = any (p_members))
     and (coalesce(cardinality(p_kinds), 0) = 0
          or (case when l.entry_type = 'bonus' and l.goal_id is not null then 'goal' else l.entry_type end)
             = any (p_kinds))
     and (p_rule is null or l.points_rule_id = p_rule)
     and (p_from is null or l.created_at >= (p_from::timestamp at time zone h.timezone))
     and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone h.timezone))
   order by l.created_at desc, l.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- [PTS-11][D-158] board_snapshot as WP-121 left it, with `paybacks` (private.board_paybacks()).
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
                                       -- [PTS-09] A penalty taken back leaves the list, both ways.
                                       and not exists (select from public.penalty p
                                                        where p.id = l.penalty_id and p.taken_back_at is not null)
                                     order by l.created_at desc, l.id desc
                                     limit 5) x)) end,
               -- [PTS-09][PTS-10][D-156][D-157] What they owe while penalties are on: each money
               -- penalty with something owed (cents), oldest first, with its reason; a rule's misses
               -- as one line, with the rule's name, what is owed on them and the days missed
               -- (WP-121); null while off.
               'owes', case when m.earns_rewards and coalesce((select s.penalties_on from public.household_settings s
                                                              where s.household_id = v_household.id), false) then (
                 select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'reason', z.reason, 'owed', z.owed)
                                           || case when z.rule then jsonb_build_object('rule', true, 'missed', z.missed)
                                                   else '{}'::jsonb end
                                           order by z.first_at, z.id), '[]'::jsonb)
                   from (select coalesce(y.rule_id, y.id) as id,
                                (array_agg(y.reason order by y.given_at desc))[1] as reason,
                                sum(y.owed)::integer as owed,
                                y.rule_id is not null as rule,
                                case when y.rule_id is not null
                                     then jsonb_agg(distinct y.missed_on order by y.missed_on) end as missed,
                                min(y.given_at) as first_at
                           from (select p.id, p.rule_id, p.reason, p.given_at, p.missed_on,
                                        p.amount - coalesce((select sum(x.amount) from public.penalty_payment x
                                                              where x.penalty_id = p.id), 0)::integer as owed
                                   from public.penalty p
                                  where p.member_id = m.id and p.unit = 'money' and p.taken_back_at is null) y
                          where y.owed > 0
                          group by coalesce(y.rule_id, y.id), y.rule_id is not null) z) end,
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
    -- [PTS-11] What each penalty rule with a goal pays back, per person: the goal card's line and the
    -- Owes card's (WP-122). Read through a definer function, so a board never reads the rule itself.
    'paybacks', private.board_paybacks(v_household.id),
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

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents and its boards read paybacks; nobody writes but the
-- functions.
-- ---------------------------------------------------------------------------------------------

alter table public.penalty_payback enable row level security;
create policy penalty_payback_admin_select on public.penalty_payback for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_payback_device_select on public.penalty_payback for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.penalty_payback from public, anon;
revoke insert, update, delete, truncate on public.penalty_payback from authenticated;
grant select on public.penalty_payback to authenticated;

-- Realtime: a payback tells the board to refetch (apps/web/lib/live.ts).
alter publication supabase_realtime add table public.penalty_payback;

revoke all on function private.prevent_payback_change(), private.payback_words(public.reward_goal),
  private.pay_back_rule(public.penalty_rule, uuid, public.reward_goal, integer, date, date),
  private.take_back_payback(uuid), private.penalty_paybacks_on_goal_event()
  from public, anon, authenticated;
revoke all on function private.board_paybacks(uuid) from public, anon;
grant execute on function private.board_paybacks(uuid) to authenticated;
