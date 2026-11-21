-- [PTS-09] One-time penalties and the penalty balance (WP-120, D-154, D-156; 02 §4.2c).
--   * `household_settings.penalties_on`: the household's on/off, off by default (D-154 (7)).
--   * `penalty_reason`: the household's penalty reasons, each in points or money with a default
--     amount. A parent adds and removes them; a removed reason stays for the penalties given with it.
--   * `penalty`: a penalty a parent gave a member who earns rewards, with its reason (copied, so a
--     reason removed later still reads), in points or money (cents). Taken back once at most.
--   * `penalty_payment`: money paid outside FamilyWise, recorded by a parent against one penalty.
--   * A points penalty is a `penalty` entry in the points ledger (D-49), taken at once; taking it back
--     posts a `penalty` entry giving the points back. It is settled when taken, so it is never owed
--     (D-156 (2)). A money penalty is owed until it is paid or taken back.
-- Every write goes through a definer function, for a parent of the household. The board reads
-- through RLS (board_snapshot() runs as its caller): each penalty's reason and amount, and what each
-- person owes, while penalties are on.

alter table public.household_settings
  add column penalties_on boolean not null default false;

create table public.penalty_reason (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  name         text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  unit         text not null check (unit in ('points', 'money')),
  amount       integer not null check (amount between 1 and 100000),  -- points, or cents
  removed_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (household_id, id),
  check (unit <> 'points' or amount <= 10000)
);
-- One reason of a name at a time among those not removed.
create unique index penalty_reason_name on public.penalty_reason (household_id, lower(name))
  where removed_at is null;

create table public.penalty (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  member_id     uuid not null,
  reason_id     uuid,
  reason        text not null check (char_length(reason) between 1 and 80),
  unit          text not null check (unit in ('points', 'money')),
  amount        integer not null check (amount between 1 and 100000),  -- points, or cents
  given_by      uuid not null,
  given_at      timestamptz not null default clock_timestamp(),
  dedupe_key    text not null unique,                                   -- giving twice gives once
  taken_back_at timestamptz,
  taken_back_by uuid,
  unique (household_id, id),
  check (unit <> 'points' or amount <= 10000),
  check ((taken_back_at is null) = (taken_back_by is null)),
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, reason_id) references public.penalty_reason (household_id, id)
);
create index on public.penalty (member_id, given_at desc);
create index on public.penalty (household_id, given_at desc);

create table public.penalty_payment (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  penalty_id   uuid not null,
  amount       integer not null check (amount between 1 and 100000),  -- cents
  recorded_by  uuid not null,
  recorded_at  timestamptz not null default clock_timestamp(),
  dedupe_key   text not null unique,
  foreign key (household_id, penalty_id) references public.penalty (household_id, id)
);
create index on public.penalty_payment (penalty_id);

-- The ledger's new type: a penalty's points, taken (negative) or given back (positive), tied to it.
alter table public.points_ledger
  add column penalty_id uuid,
  add constraint points_ledger_penalty_fk foreign key (household_id, penalty_id)
    references public.penalty (household_id, id),
  drop constraint points_ledger_entry_type_check,
  add constraint points_ledger_entry_type_check check (entry_type in
    ('earn', 'reversal', 'bonus', 'spend', 'refund', 'adjustment', 'penalty')),
  add constraint points_ledger_penalty_pair check ((entry_type = 'penalty') = (penalty_id is not null));
create index on public.points_ledger (penalty_id) where penalty_id is not null;

-- Append-only, as the ledger (D-49): a penalty changes once, when it is taken back; a payment never.
-- Both go only with the household that owns them.
create function private.prevent_penalty_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Each column is read as jsonb, so the payment table (which has no taken_back_at) passes too.
  if tg_op = 'UPDATE' and tg_table_name = 'penalty'
     and to_jsonb(old) ->> 'taken_back_at' is null and to_jsonb(new) ->> 'taken_back_at' is not null
     and (to_jsonb(new) - 'taken_back_at' - 'taken_back_by') = (to_jsonb(old) - 'taken_back_at' - 'taken_back_by') then
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select from public.household where id = old.household_id) then
    return old;
  end if;
  raise exception 'penalties are append-only' using errcode = '42501', hint = 'append_only';
end $$;
create trigger trg_penalty_immutable before update or delete on public.penalty
  for each row execute function private.prevent_penalty_change();
create trigger trg_penalty_payment_immutable before update or delete on public.penalty_payment
  for each row execute function private.prevent_penalty_change();

-- What a penalty leaves owed, in cents: a money penalty not taken back, less what was paid. A points
-- penalty is settled when taken (D-156 (2)).
create function private.penalty_owed(p_penalty uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select case when p.unit = 'money' and p.taken_back_at is null
              then p.amount - coalesce((select sum(x.amount) from public.penalty_payment x
                                         where x.penalty_id = p.id), 0)::integer
              else 0 end
    from public.penalty p
   where p.id = p_penalty
$$;

-- The caller is a parent of the household, else not allowed.
create function private.penalty_admin(p_household uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_household is null
     or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Settings: the on/off and the reasons
-- ---------------------------------------------------------------------------------------------

-- [PTS-09] Penalties on or off for the household. Off hides Give a penalty and what's owed on the
-- board; the history stays.
create function public.set_penalties_on(p_household uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform private.penalty_admin(p_household);
  if p_on is null then
    raise exception 'say on or off' using errcode = '22023', hint = 'bad_request';
  end if;
  update public.household_settings set penalties_on = p_on where household_id = p_household;
  return p_on;
end $$;

-- [PTS-09] A new penalty reason: a name, points or money, and its default amount (points, or cents).
create function public.add_penalty_reason(p_household uuid, p_name text, p_unit text, p_amount integer)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_id   uuid;
begin
  perform private.penalty_admin(p_household);
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'name the reason, in up to 80 characters' using errcode = '22023', hint = 'bad_name';
  elsif p_unit is null or p_unit not in ('points', 'money') then
    raise exception 'points or money' using errcode = '22023', hint = 'bad_unit';
  elsif p_amount is null or p_amount < 1 or p_amount > (case when p_unit = 'points' then 10000 else 100000 end) then
    raise exception 'an amount from 1' using errcode = '22023', hint = 'bad_amount';
  elsif exists (select from public.penalty_reason r where r.household_id = p_household
                  and r.removed_at is null and lower(r.name) = lower(v_name)) then
    raise exception 'there is a reason of that name' using errcode = '23505', hint = 'duplicate_name';
  end if;
  insert into public.penalty_reason (household_id, name, unit, amount, created_by)
  values (p_household, v_name, p_unit, p_amount, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- [PTS-09] A reason removed from the list: not offered again; penalties given with it keep it.
create function public.remove_penalty_reason(p_reason uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.penalty_reason where id = p_reason;
  perform private.penalty_admin(v_household);
  update public.penalty_reason set removed_at = coalesce(removed_at, now()) where id = p_reason;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Giving, taking back and paying
-- ---------------------------------------------------------------------------------------------

-- [PTS-09][US-1111] A parent gives a member who earns rewards a penalty, with a reason from the
-- household's list and its amount (the reason's, unless the parent changed it). In points it is
-- taken at once: a `penalty` entry in the ledger, so a balance may go below zero (points to earn
-- back). In money it is owed until paid. The request id makes a resend give it once.
create function public.give_penalty(p_member_id uuid, p_reason_id uuid, p_amount integer, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member  public.member;
  v_reason  public.penalty_reason;
  v_key     text := 'pen:' || p_request_id;
  v_pen     public.penalty;
  v_amount  integer;
  v_new     boolean := false;
begin
  select * into v_member from public.member where id = p_member_id;
  perform private.penalty_admin(v_member.household_id);
  if p_request_id is null then
    raise exception 'say which request this is' using errcode = '22023', hint = 'request_required';
  end if;

  select * into v_pen from public.penalty where dedupe_key = v_key;
  if not found then
    if not coalesce((select s.penalties_on from public.household_settings s
                      where s.household_id = v_member.household_id), false) then
      raise exception 'penalties are off' using errcode = '22023', hint = 'penalties_off';
    elsif v_member.archived_at is not null then
      raise exception 'archived members get no penalties' using errcode = '22023', hint = 'member_archived';
    elsif not v_member.earns_rewards then
      raise exception 'this member does not earn rewards' using errcode = '22023', hint = 'not_earning';
    end if;
    select * into v_reason from public.penalty_reason
     where id = p_reason_id and household_id = v_member.household_id and removed_at is null;
    if not found then
      raise exception 'choose a reason from the list' using errcode = '22023', hint = 'bad_reason';
    end if;
    v_amount := coalesce(p_amount, v_reason.amount);
    if v_amount < 1 or v_amount > (case when v_reason.unit = 'points' then 10000 else 100000 end) then
      raise exception 'an amount from 1' using errcode = '22023', hint = 'bad_amount';
    end if;
    insert into public.penalty (household_id, member_id, reason_id, reason, unit, amount, given_by, dedupe_key)
    values (v_member.household_id, v_member.id, v_reason.id, v_reason.name, v_reason.unit, v_amount,
            auth.uid(), v_key)
    on conflict (dedupe_key) do nothing
    returning * into v_pen;
    if v_pen.id is null then
      select * into v_pen from public.penalty where dedupe_key = v_key;
    else
      v_new := true;
      if v_pen.unit = 'points' then
        insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                          created_by_type, created_by, penalty_id)
        values (v_pen.household_id, v_pen.member_id, 'penalty', -v_pen.amount, v_pen.reason,
                'pen:' || v_pen.id, 'admin', auth.uid(), v_pen.id);
      end if;
    end if;
  end if;
  if v_pen.member_id <> v_member.id or v_pen.reason_id is distinct from p_reason_id
     or (p_amount is not null and v_pen.amount <> p_amount) then
    raise exception 'that request was already used for something else' using errcode = '22023', hint = 'request_reused';
  end if;
  return jsonb_build_object('id', v_pen.id, 'duplicate', not v_new, 'unit', v_pen.unit,
                            'amount', v_pen.amount, 'owed', private.penalty_owed(v_pen.id),
                            'balance', private.member_balance(v_pen.member_id));
end $$;

-- [PTS-09] A penalty given by mistake, taken back (D-156 (3)): in points, a `penalty` entry gives the
-- points back; in money, nothing is owed on it any more. Taking it back again changes nothing.
create function public.take_back_penalty(p_penalty_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pen public.penalty;
begin
  select * into v_pen from public.penalty where id = p_penalty_id;
  perform private.penalty_admin(v_pen.household_id);
  if v_pen.taken_back_at is null then
    update public.penalty set taken_back_at = now(), taken_back_by = auth.uid()
     where id = v_pen.id and taken_back_at is null;
    if v_pen.unit = 'points' then
      insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                        created_by_type, created_by, penalty_id)
      values (v_pen.household_id, v_pen.member_id, 'penalty', v_pen.amount, v_pen.reason,
              'pen-back:' || v_pen.id, 'admin', auth.uid(), v_pen.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return jsonb_build_object('id', v_pen.id, 'owed', private.penalty_owed(v_pen.id));
end $$;

-- [PTS-09][US-1111] Money paid outside FamilyWise, recorded against one money penalty: from 1 cent
-- up to what is owed on it (D-156 (4)). The request id makes a resend record it once.
create function public.record_penalty_paid(p_penalty_id uuid, p_amount integer, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pen  public.penalty;
  v_key  text := 'paid:' || p_request_id;
  v_paid public.penalty_payment;
begin
  select * into v_pen from public.penalty where id = p_penalty_id;
  perform private.penalty_admin(v_pen.household_id);
  if p_request_id is null then
    raise exception 'say which request this is' using errcode = '22023', hint = 'request_required';
  end if;
  select * into v_paid from public.penalty_payment where dedupe_key = v_key;
  if not found then
    if v_pen.unit <> 'money' then
      raise exception 'a points penalty is settled when it is taken' using errcode = '22023', hint = 'not_money';
    elsif p_amount is null or p_amount < 1 or p_amount > private.penalty_owed(v_pen.id) then
      raise exception 'up to what is owed' using errcode = '22023', hint = 'bad_amount';
    end if;
    insert into public.penalty_payment (household_id, penalty_id, amount, recorded_by, dedupe_key)
    values (v_pen.household_id, v_pen.id, p_amount, auth.uid(), v_key)
    on conflict (dedupe_key) do nothing
    returning * into v_paid;
    if v_paid.id is null then
      select * into v_paid from public.penalty_payment where dedupe_key = v_key;
    end if;
  end if;
  if v_paid.penalty_id <> v_pen.id or v_paid.amount <> p_amount then
    raise exception 'that request was already used for something else' using errcode = '22023', hint = 'request_reused';
  end if;
  return jsonb_build_object('id', v_paid.id, 'owed', private.penalty_owed(v_pen.id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents and its boards read; nobody writes but the functions.
-- ---------------------------------------------------------------------------------------------

alter table public.penalty_reason enable row level security;
alter table public.penalty enable row level security;
alter table public.penalty_payment enable row level security;

create policy penalty_reason_admin_select on public.penalty_reason for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_admin_select on public.penalty for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_device_select on public.penalty for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy penalty_payment_admin_select on public.penalty_payment for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy penalty_payment_device_select on public.penalty_payment for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.penalty_reason, public.penalty, public.penalty_payment from public, anon;
revoke insert, update, delete, truncate on public.penalty_reason, public.penalty, public.penalty_payment
  from authenticated;
grant select on public.penalty_reason, public.penalty, public.penalty_payment to authenticated;

-- The reasons are a setting, audited like the brands.
create trigger trg_audit after insert or update or delete on public.penalty_reason
  for each row execute function private.audit_row();

-- Realtime: a money penalty or a payment tells the board to refetch (apps/web/lib/live.ts); a points
-- penalty already does through the ledger.
alter publication supabase_realtime add table public.penalty, public.penalty_payment;

revoke all on function public.set_penalties_on(uuid, boolean), public.add_penalty_reason(uuid, text, text, integer),
  public.remove_penalty_reason(uuid), public.give_penalty(uuid, uuid, integer, uuid),
  public.take_back_penalty(uuid), public.record_penalty_paid(uuid, integer, uuid)
  from public, anon;
grant execute on function public.set_penalties_on(uuid, boolean), public.add_penalty_reason(uuid, text, text, integer),
  public.remove_penalty_reason(uuid), public.give_penalty(uuid, uuid, integer, uuid),
  public.take_back_penalty(uuid), public.record_penalty_paid(uuid, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board's snapshot (WP-81's, as WP-124 left it)
-- ---------------------------------------------------------------------------------------------

-- [PTS-09][D-154][D-156] board_snapshot as before, with penalties: each member's `points.recent`
-- leaves out a penalty that was taken back (its entry and the one giving it back), and each member
-- who earns rewards has `owes`, while the household's penalties are on: their money penalties with
-- something owed, oldest first, each with its reason and what is owed (cents); null while off.
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
               -- [PTS-09][D-156] What they owe while penalties are on: each money penalty with
               -- something owed (cents), oldest first, with its reason; null while off.
               'owes', case when m.earns_rewards and coalesce((select s.penalties_on from public.household_settings s
                                                              where s.household_id = v_household.id), false) then (
                 select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'reason', y.reason, 'owed', y.owed)
                                           order by y.given_at, y.id), '[]'::jsonb)
                   from (select p.id, p.reason, p.given_at,
                                p.amount - coalesce((select sum(x.amount) from public.penalty_payment x
                                                      where x.penalty_id = p.id), 0)::integer as owed
                           from public.penalty p
                          where p.member_id = m.id and p.unit = 'money' and p.taken_back_at is null) y
                  where y.owed > 0) end,
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

revoke all on function private.penalty_owed(uuid), private.penalty_admin(uuid),
  private.prevent_penalty_change() from public, anon;
