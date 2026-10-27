-- [PTS-08] The household points register (WP-115, D-147): every points_ledger entry of a household in
-- one list, filtered by member, type, bonus rule and the household's own days, with what they add up
-- to, and each bonus rule's payouts. Nothing new is stored. Each function runs as its caller, so RLS
-- decides what it reads: a parent of the household reads its ledger (a board too), and an earn on an
-- item the parent may not see comes back without its title (D-34).
--
-- A type is the entry's, but a bonus a goal paid is a 'goal' payout, apart from a rule's 'bonus'.

create function public.points_register(
  p_household uuid,
  p_members   uuid[]  default null,  -- null or empty: every member
  p_kinds     text[]  default null,  -- earn, bonus, goal, adjustment, spend, refund, reversal
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
  created_by      uuid)
language sql stable security invoker set search_path = '' as $$
  with h as (select timezone from public.household where id = p_household)
  select l.id, l.member_id,
         case when l.entry_type = 'bonus' and l.goal_id is not null then 'goal' else l.entry_type end,
         l.amount, l.created_at, l.reason, l.occurrence_id, c.title, l.goal_id, g.title,
         l.points_rule_id, l.created_by_type, l.created_by
    from public.points_ledger l
    cross join h
    left join public.chore_occurrence o on o.id = l.occurrence_id
    left join public.chore c on c.id = o.chore_id
    left join public.reward_goal g on g.id = l.goal_id
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

-- What the same filtered entries add up to, a row per member: how many, what they added, what they
-- took away, and the latest.
create function public.points_register_totals(
  p_household uuid,
  p_members   uuid[] default null,
  p_kinds     text[] default null,
  p_rule      uuid   default null,
  p_from      date   default null,
  p_to        date   default null)
returns table (member_id uuid, entries integer, added integer, taken integer, latest timestamptz)
language sql stable security invoker set search_path = '' as $$
  with h as (select timezone from public.household where id = p_household)
  select l.member_id, count(*)::integer,
         coalesce(sum(l.amount) filter (where l.amount > 0), 0)::integer,
         coalesce(sum(l.amount) filter (where l.amount < 0), 0)::integer,
         max(l.created_at)
    from public.points_ledger l
    cross join h
   where l.household_id = p_household
     and (coalesce(cardinality(p_members), 0) = 0 or l.member_id = any (p_members))
     and (coalesce(cardinality(p_kinds), 0) = 0
          or (case when l.entry_type = 'bonus' and l.goal_id is not null then 'goal' else l.entry_type end)
             = any (p_kinds))
     and (p_rule is null or l.points_rule_id = p_rule)
     and (p_from is null or l.created_at >= (p_from::timestamp at time zone h.timezone))
     and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone h.timezone))
   group by l.member_id
$$;

-- [PTS-05] Each bonus rule's payouts: how many times it has paid, and the latest.
create function public.points_rule_payouts(p_household uuid)
returns table (points_rule_id uuid, times integer, latest timestamptz)
language sql stable security invoker set search_path = '' as $$
  select l.points_rule_id, count(*)::integer, max(l.created_at)
    from public.points_ledger l
   where l.household_id = p_household and l.points_rule_id is not null
   group by l.points_rule_id
$$;

revoke all on function public.points_register(uuid, uuid[], text[], uuid, date, date, integer, integer),
                       public.points_register_totals(uuid, uuid[], text[], uuid, date, date),
                       public.points_rule_payouts(uuid)
  from public, anon;
grant execute on function public.points_register(uuid, uuid[], text[], uuid, date, date, integer, integer),
                          public.points_register_totals(uuid, uuid[], text[], uuid, date, date),
                          public.points_rule_payouts(uuid)
  to authenticated;
