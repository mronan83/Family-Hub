-- [PTS-10] Penalty rules that build up on missed items, with dates and a max (WP-121, D-154, D-157;
-- 02 §4.2d).
--   * `penalty_rule`: a parent's rule: a name, a reason from the household's list (its unit), one or
--     more people who earn rewards, what counts (chosen chores, a tag, or all their chores), start and
--     end dates, an amount per miss and a max. `accrued_through` is the last day the rule has been
--     worked out for, so a day is judged once.
--   * `penalty_rule_member`, `penalty_rule_chore`: who it is for, and the chores it links.
--   * Each miss a rule adds is a `penalty` (WP-120's table) with `rule_id`, `occurrence_id` and
--     `missed_on`, given by nobody (the system): owed, paid, shown and listed as every penalty is. In
--     points it is also a `penalty` ledger entry, "Name, missed Tuesday".
--   * Day close (`close_household_day()`) works out each rule for the days that closed: a linked chore
--     a rule's person missed (member status `missed`) on a day between its dates, on a day it is due
--     for them (a day off or a no-school day never counts), adds the amount, up to the max. Skipped and
--     covered are never `missed`. Nothing is added while penalties are off.
--   * A parent's Mark done on time (WP-117, D-151) takes back what that miss added, at once; Uncheck
--     after it adds it again, up to the max (D-157).
-- Every write goes through a definer function, for a parent of the household. Boards read the
-- penalties a rule added (WP-120's RLS), never the rule's own rows.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.penalty_rule (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.household (id) on delete cascade,
  name            text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  reason_id       uuid not null,
  unit            text not null check (unit in ('points', 'money')),
  amount          integer not null check (amount between 1 and 100000),      -- per miss: points, or cents
  max_amount      integer not null check (max_amount between 1 and 100000),  -- the most it has on a person
  scope           text not null check (scope in ('items', 'tag', 'all')),
  tag_id          uuid,
  start_date      date not null,
  end_date        date not null,
  accrued_through date,                                                      -- worked out through this day
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, id),
  check (end_date >= start_date),
  check (max_amount >= amount),
  check (unit <> 'points' or max_amount <= 10000),
  check ((scope = 'tag') = (tag_id is not null)),
  foreign key (household_id, reason_id) references public.penalty_reason (household_id, id),
  foreign key (household_id, tag_id) references public.tag (household_id, id)
);
create index on public.penalty_rule (household_id);
create trigger trg_penalty_rule_updated before update on public.penalty_rule
  for each row execute function private.set_updated_at();

create table public.penalty_rule_member (
  household_id uuid not null,
  rule_id      uuid not null,
  member_id    uuid not null,
  primary key (rule_id, member_id),
  foreign key (household_id, rule_id) references public.penalty_rule (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade
);
create index on public.penalty_rule_member (household_id, member_id);

create table public.penalty_rule_chore (
  household_id uuid not null,
  rule_id      uuid not null,
  chore_id     uuid not null,
  primary key (rule_id, chore_id),
  foreign key (household_id, rule_id) references public.penalty_rule (household_id, id) on delete cascade,
  foreign key (household_id, chore_id) references public.chore (household_id, id) on delete cascade
);
create index on public.penalty_rule_chore (household_id, chore_id);

-- A penalty a rule added: the rule, the chore's day it was for, and that day. Given by nobody (the
-- system), so `given_by` is null only on these. `taken_back_on_time`: taken back by a parent's Mark
-- done on time, so Uncheck adds it again (D-157). A rule's miss is live once at most per day and person.
alter table public.penalty
  add column rule_id            uuid,
  add column occurrence_id      uuid references public.chore_occurrence (id) on delete set null,
  add column missed_on          date,
  add column taken_back_on_time boolean not null default false,
  alter column given_by drop not null,
  add constraint penalty_rule_fk foreign key (household_id, rule_id) references public.penalty_rule (household_id, id),
  add constraint penalty_rule_fields check ((rule_id is null) = (missed_on is null)),
  add constraint penalty_given_by check (given_by is not null or rule_id is not null),
  drop constraint penalty_check1,
  add constraint penalty_taken_back check (taken_back_by is null or taken_back_at is not null),
  add constraint penalty_on_time check (not taken_back_on_time or taken_back_at is not null);
create index on public.penalty (rule_id, member_id) where rule_id is not null;
create unique index penalty_rule_live on public.penalty (rule_id, occurrence_id, member_id)
  where rule_id is not null and taken_back_at is null;

-- Append-only as before (WP-120): a penalty changes once, when it is taken back; a payment never. A
-- rule's chore removed later leaves its misses (the occurrence id is cleared, the day stays).
create or replace function private.prevent_penalty_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_keep text[] := array['taken_back_at', 'taken_back_by', 'taken_back_on_time'];
begin
  if tg_op = 'UPDATE' and tg_table_name = 'penalty'
     and to_jsonb(old) ->> 'taken_back_at' is null and to_jsonb(new) ->> 'taken_back_at' is not null
     and (to_jsonb(new) - v_keep) = (to_jsonb(old) - v_keep) then
    return new;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'penalty'
     and to_jsonb(old) ->> 'occurrence_id' is not null and to_jsonb(new) ->> 'occurrence_id' is null
     and (to_jsonb(new) - 'occurrence_id') = (to_jsonb(old) - 'occurrence_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select from public.household where id = old.household_id) then
    return old;
  end if;
  raise exception 'penalties are append-only' using errcode = '42501', hint = 'append_only';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Adding up
-- ---------------------------------------------------------------------------------------------

-- What a rule has on a person: in money, what is owed on its misses (less what was paid); in points,
-- the points its misses took. Misses taken back count for nothing (D-157).
create function private.penalty_rule_held(p_rule uuid, p_member uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount - case when p.unit = 'money'
                                      then coalesce((select sum(x.amount) from public.penalty_payment x
                                                      where x.penalty_id = p.id), 0) else 0 end), 0)::integer
    from public.penalty p
   where p.rule_id = p_rule and p.member_id = p_member and p.taken_back_at is null
$$;

-- [PTS-10] One miss of a rule's chore by a person: adds the rule's amount, or what is left under its
-- max, as a penalty (and in points, a ledger entry). Nothing when the max is reached or it is already
-- there. Returns what it added.
create function private.add_rule_miss(p_rule public.penalty_rule, p_member uuid, p_occ uuid, p_day date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_amount integer;
  v_n      integer;
  v_id     uuid;
begin
  if exists (select from public.penalty p where p.rule_id = p_rule.id and p.occurrence_id = p_occ
               and p.member_id = p_member and p.taken_back_at is null) then
    return 0;
  end if;
  v_amount := least(p_rule.amount, p_rule.max_amount - private.penalty_rule_held(p_rule.id, p_member));
  if v_amount < 1 then
    return 0;
  end if;
  select count(*) into v_n from public.penalty p
   where p.rule_id = p_rule.id and p.occurrence_id = p_occ and p.member_id = p_member;
  insert into public.penalty (household_id, member_id, reason_id, reason, unit, amount, given_by, dedupe_key,
                              rule_id, occurrence_id, missed_on)
  values (p_rule.household_id, p_member, p_rule.reason_id, p_rule.name, p_rule.unit, v_amount, null,
          'rule:' || p_rule.id || ':' || p_occ || ':' || p_member || ':' || v_n,
          p_rule.id, p_occ, p_day)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return 0;
  end if;
  if p_rule.unit = 'points' then
    insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                      created_by_type, created_by, penalty_id)
    values (p_rule.household_id, p_member, 'penalty', -v_amount,
            p_rule.name || ', missed ' || trim(to_char(p_day, 'FMDay')),
            'pen:' || v_id, 'system', null, v_id);
  end if;
  return v_amount;
end $$;

-- [PTS-10][D-154] A miss a rule counts: a chore (never a task) the rule links, missed by one of its
-- people (their own status: covered and skipped are not missed), on a day between its dates that is
-- a day the chore is due for them (a day off, a no-school day never counts).
create function private.rule_misses(p_rule public.penalty_rule, p_from date, p_to date)
returns table (member_id uuid, occurrence_id uuid, due_date date, due_time time)
language sql stable security definer set search_path = '' as $$
  select v.member_id, v.occurrence_id, v.due_date, v.due_time
    from public.v_member_occurrence v
    join public.chore c on c.id = v.chore_id
    join public.penalty_rule_member rm on rm.rule_id = p_rule.id and rm.member_id = v.member_id
   where v.household_id = p_rule.household_id
     and v.kind = 'chore'
     and v.member_status = 'missed'
     and v.due_date between greatest(p_from, p_rule.start_date) and least(p_to, p_rule.end_date)
     and public.resolve_day_type(v.member_id, v.due_date) = any (c.day_types)
     and case p_rule.scope
           when 'items' then exists (select from public.penalty_rule_chore rc
                                      where rc.rule_id = p_rule.id and rc.chore_id = v.chore_id)
           when 'tag' then exists (select from public.chore_tag ct
                                    where ct.chore_id = v.chore_id and ct.tag_id = p_rule.tag_id)
           else true
         end
$$;

-- [PTS-10] Works out each of the household's rules for the days that closed since it was last worked
-- out, in day order (so the max is reached by the earliest misses). While penalties are off nothing
-- is added, and those days are not worked out again later. Returns how many misses it added.
create function private.accrue_penalty_rules(p_household uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household);
  v_on    boolean := coalesce((select s.penalties_on from public.household_settings s
                                where s.household_id = p_household), false);
  r       public.penalty_rule;
  m       record;
  v_to    date;
  v_added integer := 0;
begin
  for r in select * from public.penalty_rule
            where household_id = p_household
              and start_date < v_today
              and (accrued_through is null or accrued_through < least(end_date, v_today - 1))
            order by created_at, id
              for update skip locked loop
    v_to := least(r.end_date, v_today - 1);
    if v_on then
      for m in select * from private.rule_misses(r, coalesce(r.accrued_through + 1, r.start_date), v_to)
                order by due_date, due_time nulls last, occurrence_id, member_id loop
        if private.add_rule_miss(r, m.member_id, m.occurrence_id, m.due_date) > 0 then
          v_added := v_added + 1;
        end if;
      end loop;
    end if;
    update public.penalty_rule set accrued_through = v_to where id = r.id;
  end loop;
  return v_added;
end $$;

-- [CHR-07][PTS-10] The day_close job (hourly): finalizes the household's past routines (WP-10), then
-- works out its penalty rules for the days that closed (WP-121).
create or replace function public.close_household_day(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := private.household_today(p_household_id);
  v_closed integer;
begin
  if v_today is null then
    raise exception 'unknown household' using errcode = 'P0002';
  end if;
  v_closed := private.close_past_due(p_household_id);
  return jsonb_build_object('closed', v_closed, 'through', v_today - 1,
                            'penalties', private.accrue_penalty_rules(p_household_id));
end $$;

-- [PTS-10][CHR-24][D-151][D-157] After each check-off event: a Mark done on time takes back what a
-- rule added for that day (its points given back), as the parent who marked it; an event that makes
-- the day missed again (Uncheck) adds back what Mark done on time took back, up to the max. Only days
-- a rule has already worked out; day close does the rest.
create function private.penalty_rules_on_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_occ   public.chore_occurrence;
  v_event public.chore_completion_event;
  p       public.penalty;
  r       public.penalty_rule;
  v_back  record;
  v_mem   uuid;
begin
  select * into v_occ from public.chore_occurrence where id = new.occurrence_id;
  if not found or v_occ.kind <> 'chore' then
    return null;
  end if;
  select * into v_event from public.chore_completion_event where id = v_occ.status_event_id;
  if v_occ.status = 'approved' and coalesce(v_event.marked_on_time, false) then
    for p in select * from public.penalty
              where occurrence_id = v_occ.id and rule_id is not null and taken_back_at is null
                for update loop
      update public.penalty
         set taken_back_at = now(), taken_back_by = v_event.actor_id, taken_back_on_time = true
       where id = p.id;
      if p.unit = 'points' then
        insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                          created_by_type, created_by, penalty_id)
        values (p.household_id, p.member_id, 'penalty', p.amount,
                coalesce((select l.reason from public.points_ledger l where l.penalty_id = p.id and l.amount < 0
                           order by l.created_at limit 1), p.reason) || ', marked on time',
                'pen-back:' || p.id, case when v_event.actor_id is null then 'system' else 'admin' end,
                v_event.actor_id, p.id)
        on conflict (dedupe_key) do nothing;
      end if;
    end loop;
  elsif v_occ.status = 'missed' and coalesce((select s.penalties_on from public.household_settings s
                                               where s.household_id = v_occ.household_id), false) then
    for v_back in
      select distinct q.rule_id, q.member_id
        from public.penalty q
       where q.occurrence_id = v_occ.id and q.taken_back_on_time
         and not exists (select from public.penalty l where l.rule_id = q.rule_id and l.occurrence_id = v_occ.id
                           and l.member_id = q.member_id and l.taken_back_at is null)
    loop
      select * into r from public.penalty_rule
       where id = v_back.rule_id and accrued_through >= v_occ.due_date;
      v_mem := v_back.member_id;
      if r.id is not null and exists (select from private.rule_misses(r, v_occ.due_date, v_occ.due_date) y
                  where y.occurrence_id = v_occ.id and y.member_id = v_mem) then
        perform private.add_rule_miss(r, v_mem, v_occ.id, v_occ.due_date);
      end if;
    end loop;
  end if;
  return null;
end $$;
create trigger trg_cce_penalty_rules after insert on public.chore_completion_event
  for each row execute function private.penalty_rules_on_event();

-- ---------------------------------------------------------------------------------------------
-- What the app calls
-- ---------------------------------------------------------------------------------------------

-- [PTS-10][US-1112] A parent adds a penalty rule, or changes one (with its id). `p_rule`: name,
-- reason_id, member_ids, scope ('items', 'tag', 'all'), chore_ids (items), tag_id (tag), start_date,
-- end_date, amount, max_amount (points, or cents, in the reason's unit). A new rule starts today or
-- later; a changed one keeps its start or moves it to today or later. A change counts from the next
-- day close; what the rule already added stays.
create function public.save_penalty_rule(p_household uuid, p_rule jsonb) returns uuid
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

  if v_id is null then
    insert into public.penalty_rule (household_id, name, reason_id, unit, amount, max_amount, scope, tag_id,
                                     start_date, end_date, accrued_through, created_by)
    values (p_household, v_name, v_reason.id, v_reason.unit, v_amount, v_max, v_scope,
            case when v_scope = 'tag' then v_tag end, v_start, v_end, v_start - 1, auth.uid())
    returning id into v_id;
  else
    if v_reason.unit <> v_old.unit then
      raise exception 'a rule keeps its unit' using errcode = '22023', hint = 'unit_changed';
    end if;
    update public.penalty_rule
       set name = v_name, reason_id = v_reason.id, amount = v_amount, max_amount = v_max, scope = v_scope,
           tag_id = case when v_scope = 'tag' then v_tag end, start_date = v_start, end_date = v_end,
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

-- [PTS-10][US-1112] Money paid outside FamilyWise against a rule's misses for a person: spread over
-- them oldest first, from 1 cent up to what is owed on the rule. The request id makes a resend
-- record it once.
create function public.record_penalty_rule_paid(p_rule_id uuid, p_member_id uuid, p_amount integer,
                                                p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.penalty_rule;
  v_left integer := p_amount;
  v_take integer;
  p      record;
  v_done integer;
begin
  select * into v_rule from public.penalty_rule where id = p_rule_id;
  perform private.penalty_admin(v_rule.household_id);
  if p_request_id is null then
    raise exception 'say which request this is' using errcode = '22023', hint = 'request_required';
  end if;
  select coalesce(sum(x.amount), 0)::integer into v_done
    from public.penalty_payment x where x.dedupe_key like 'paid:' || p_request_id || ':%';
  if v_done > 0 then
    if v_done <> p_amount then
      raise exception 'that request was already used for something else' using errcode = '22023', hint = 'request_reused';
    end if;
    return jsonb_build_object('owed', private.penalty_rule_held(v_rule.id, p_member_id));
  end if;
  if v_rule.unit <> 'money' then
    raise exception 'a points penalty is settled when it is taken' using errcode = '22023', hint = 'not_money';
  elsif p_amount is null or p_amount < 1 or p_amount > private.penalty_rule_held(v_rule.id, p_member_id) then
    raise exception 'up to what is owed' using errcode = '22023', hint = 'bad_amount';
  end if;
  for p in select q.id, private.penalty_owed(q.id) as owed
             from public.penalty q
            where q.rule_id = v_rule.id and q.member_id = p_member_id and q.taken_back_at is null
            order by q.missed_on, q.given_at, q.id
              for update loop
    exit when v_left = 0;
    v_take := least(v_left, p.owed);
    if v_take > 0 then
      insert into public.penalty_payment (household_id, penalty_id, amount, recorded_by, dedupe_key)
      values (v_rule.household_id, p.id, v_take, auth.uid(), 'paid:' || p_request_id || ':' || p.id);
      v_left := v_left - v_take;
    end if;
  end loop;
  return jsonb_build_object('owed', private.penalty_rule_held(v_rule.id, p_member_id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents read the rules; nobody writes but the functions.
-- ---------------------------------------------------------------------------------------------

alter table public.penalty_rule enable row level security;
alter table public.penalty_rule_member enable row level security;
alter table public.penalty_rule_chore enable row level security;

create policy penalty_rule_admin_select on public.penalty_rule for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_rule_member_admin_select on public.penalty_rule_member for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_rule_chore_admin_select on public.penalty_rule_chore for select to authenticated
  using (household_id in (select private.admin_household_ids()));

revoke all on public.penalty_rule, public.penalty_rule_member, public.penalty_rule_chore from public, anon;
revoke insert, update, delete, truncate on public.penalty_rule, public.penalty_rule_member, public.penalty_rule_chore
  from authenticated;
grant select on public.penalty_rule, public.penalty_rule_member, public.penalty_rule_chore to authenticated;

create trigger trg_audit after insert or update or delete on public.penalty_rule
  for each row execute function private.audit_row();

revoke all on function private.penalty_rule_held(uuid, uuid),
  private.add_rule_miss(public.penalty_rule, uuid, uuid, date),
  private.rule_misses(public.penalty_rule, date, date), private.accrue_penalty_rules(uuid),
  private.penalty_rules_on_event() from public, anon, authenticated;
revoke all on function public.save_penalty_rule(uuid, jsonb), public.record_penalty_rule_paid(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.save_penalty_rule(uuid, jsonb), public.record_penalty_rule_paid(uuid, uuid, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The points register: a rule's miss names its rule
-- ---------------------------------------------------------------------------------------------

-- [PTS-08][PTS-10] points_register (WP-115's) with `penalty_rule`: the rule a penalty entry came from.
drop function public.points_register(uuid, uuid[], text[], uuid, date, date, integer, integer);
create function public.points_register(
  p_household uuid,
  p_members   uuid[]  default null,  -- null or empty: every member
  p_kinds     text[]  default null,  -- earn, bonus, goal, adjustment, spend, refund, reversal, penalty
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
         l.amount, l.created_at, l.reason, l.occurrence_id, c.title, l.goal_id, g.title,
         l.points_rule_id, l.created_by_type, l.created_by, pr.name
    from public.points_ledger l
    cross join h
    left join public.chore_occurrence o on o.id = l.occurrence_id
    left join public.chore c on c.id = o.chore_id
    left join public.reward_goal g on g.id = l.goal_id
    left join public.penalty pe on pe.id = l.penalty_id
    left join public.penalty_rule pr on pr.id = pe.rule_id
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

revoke all on function public.points_register(uuid, uuid[], text[], uuid, date, date, integer, integer) from public, anon;
grant execute on function public.points_register(uuid, uuid[], text[], uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board's snapshot (WP-120's), with a rule's misses as one line of what is owed
-- ---------------------------------------------------------------------------------------------

-- [PTS-10][D-157] board_snapshot as WP-120 left it, except each member's `owes`: a rule's money misses
-- still owed are one entry (`id` the rule's, `rule` true, `missed` the days still owed), beside each
-- one-time money penalty (as before: `id`, `reason`, `owed`).
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
