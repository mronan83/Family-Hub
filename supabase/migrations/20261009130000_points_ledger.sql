-- [PTS-01][PTS-02][PTS-07][NFR-06] The points ledger (WP-16, 02 §4.2b, D-28, D-32, D-49): an
-- append-only list of every points change, and each member's balance is its sum. Earns and reversals
-- follow an occurrence's status: whoever it rewarded holds its points while it is done, and nobody
-- does otherwise. Every other entry goes through one definer function; nothing in the app inserts.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table public.points_ledger (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.household (id) on delete cascade,
  member_id       uuid not null,
  entry_type      text not null check (entry_type in
                    ('earn', 'reversal', 'bonus', 'spend', 'refund', 'adjustment')),
  amount          integer not null check (amount <> 0),            -- signed
  occurrence_id   uuid,                                            -- an earn's or its reversal's
  reason          text check (char_length(reason) between 1 and 200),
  dedupe_key      text not null unique,                            -- posting twice posts once
  created_by_type text not null check (created_by_type in ('system', 'admin', 'device')),
  created_by      uuid,                                            -- the admin's user id
  created_at      timestamptz not null default clock_timestamp(),  -- posting order, even within one transaction
  check (entry_type <> 'earn' or (amount > 0 and occurrence_id is not null)),
  check (entry_type <> 'reversal' or amount < 0),
  check (entry_type <> 'adjustment' or (reason is not null and created_by_type = 'admin' and created_by is not null)),
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, occurrence_id) references public.chore_occurrence (household_id, id)
    on delete cascade
);
create index on public.points_ledger (household_id, member_id, created_at desc);
create index on public.points_ledger (occurrence_id) where occurrence_id is not null;

-- Append-only: never updated, and deleted only with the household that owns it (its export and
-- delete, or the demo family's reset). A mistake is corrected by a new entry (US-1106).
create function private.prevent_ledger_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' or exists (select from public.household where id = old.household_id) then
    raise exception 'the points ledger is append-only' using errcode = '42501', hint = 'append_only';
  end if;
  return old;
end $$;
create trigger trg_pl_immutable before update or delete on public.points_ledger
  for each row execute function private.prevent_ledger_change();

-- ---------------------------------------------------------------------------
-- Earn and reversal (D-32, D-49): an occurrence owes its points to each member it rewarded while it
-- is done (completed or approved), and nothing otherwise. Each change posts the difference between
-- what it owes and what the ledger already holds for it, so whatever changed the status (an event,
-- day close, a parent's rebuild) the ledger agrees, and posting again posts nothing. Postings for one
-- occurrence are made one at a time under its row lock, so each key's sequence number is unique.
-- ---------------------------------------------------------------------------

create function private.reconcile_occurrence_points(p_occurrence uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  o        record;
  r        record;
  v_posted integer := 0;
begin
  -- Owed to members who still exist: one removed since (members are archived, not deleted, but RLS
  -- lets an admin delete one with no points) must never make a check-off fail.
  select occ.id, occ.household_id, occ.points_snapshot,
         case when occ.status in ('completed', 'approved')
              then array(select m.id from public.member m
                          where m.id = any (occ.rewarded) and m.household_id = occ.household_id)
              else '{}'::uuid[] end as owed_to
    into o
    from public.chore_occurrence occ
   where occ.id = p_occurrence;
  if not found then
    return 0;
  end if;
  for r in
    with held as (
      select l.member_id, sum(l.amount)::integer as amount, count(*)::integer as entries
        from public.points_ledger l
       where l.occurrence_id = o.id and l.entry_type in ('earn', 'reversal')
       group by l.member_id
    ), members as (
      select unnest(o.owed_to) as member_id
      union
      select h.member_id from held h
    )
    select m.member_id,
           case when m.member_id = any (o.owed_to) then o.points_snapshot else 0 end
             - coalesce(h.amount, 0) as delta,
           coalesce(h.entries, 0) as entries
      from members m
      left join held h using (member_id)
     order by m.member_id
  loop
    continue when r.delta = 0;
    insert into public.points_ledger (household_id, member_id, entry_type, amount, occurrence_id,
                                      dedupe_key, created_by_type)
    values (o.household_id, r.member_id, case when r.delta > 0 then 'earn' else 'reversal' end, r.delta,
            o.id, 'occ:' || o.id || ':' || r.member_id || ':' || (r.entries + 1), 'system');
    v_posted := v_posted + 1;
  end loop;
  return v_posted;
end $$;

create function private.post_points() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.reconcile_occurrence_points(new.id);
  return null;
end $$;
create trigger trg_occ_points after update of status, rewarded, points_snapshot on public.chore_occurrence
  for each row
  when (old.status is distinct from new.status or old.rewarded is distinct from new.rewarded
        or old.points_snapshot is distinct from new.points_snapshot)
  execute function private.post_points();

-- Check-offs made before the ledger existed (WP-10 to here) earn what they would have: once per
-- rewarded member of each done occurrence that holds nothing yet, dated when it became done. Run once
-- below; running it again posts nothing.
create function private.backfill_points() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_posted integer;
begin
  insert into public.points_ledger (household_id, member_id, entry_type, amount, occurrence_id,
                                    dedupe_key, created_by_type, created_at)
  select o.household_id, m.id, 'earn', o.points_snapshot, o.id, 'occ:' || o.id || ':' || m.id || ':1', 'system',
         coalesce(o.status_changed_at, now())
    from public.chore_occurrence o
    join public.member m on m.id = any (o.rewarded) and m.household_id = o.household_id
   where o.status in ('completed', 'approved') and o.points_snapshot > 0
     and not exists (select from public.points_ledger l where l.occurrence_id = o.id and l.member_id = m.id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_posted = row_count;
  return v_posted;
end $$;
-- The trigger above already holds the occurrence table, so nothing changes in between.
select private.backfill_points();

-- ---------------------------------------------------------------------------
-- Every other entry (D-28): one writer, called by named entry points. Adjustments now; spends and
-- refunds (WP-18), goal payouts and rule bonuses (WP-30) later.
-- ---------------------------------------------------------------------------

-- The new entry's id, or null when its dedupe key was already posted.
create function private.post_ledger(
  p_household uuid, p_member uuid, p_type text, p_amount integer, p_dedupe_key text, p_reason text,
  p_created_by_type text, p_created_by uuid)
returns uuid
language sql security definer set search_path = '' as $$
  insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                    created_by_type, created_by)
  values (p_household, p_member, p_type, p_amount, p_reason, p_dedupe_key, p_created_by_type, p_created_by)
  on conflict (dedupe_key) do nothing
  returning id
$$;

create function private.member_balance(p_member uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0)::integer from public.points_ledger where member_id = p_member
$$;

-- [PTS-01][US-1106] An admin adds or takes away points with a reason, as themselves. The request id
-- makes it safe to send again: the same request posts once and answers the same way. Only for a
-- member who earns rewards and is not archived (D-32); it may take a balance below zero, which the
-- board shows as points to earn back (PTS-02).
create function public.adjust_points(p_member_id uuid, p_amount integer, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_member public.member;
  v_reason text := nullif(btrim(p_reason), '');
  v_key    text := 'adj:' || p_request_id;
  v_new    uuid;
  v_entry  public.points_ledger;
begin
  select * into v_member from public.member where id = p_member_id;
  if v_uid is null or not found or not exists (
       select from public.household_user hu where hu.household_id = v_member.household_id and hu.user_id = v_uid) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_request_id is null then
    raise exception 'say which request this is' using errcode = '22023', hint = 'request_required';
  end if;

  select * into v_entry from public.points_ledger where dedupe_key = v_key;
  if not found then
    if v_member.archived_at is not null then
      raise exception 'archived members do not earn points' using errcode = '22023', hint = 'member_archived';
    elsif not v_member.earns_rewards then
      raise exception 'this member does not earn rewards' using errcode = '22023', hint = 'not_earning';
    elsif p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
      raise exception 'points must be 1 to 10000 either way' using errcode = '22023', hint = 'bad_amount';
    elsif v_reason is null or char_length(v_reason) > 200 then
      raise exception 'say why, in up to 200 characters' using errcode = '22023', hint = 'reason_required';
    end if;
    v_new := private.post_ledger(v_member.household_id, v_member.id, 'adjustment', p_amount, v_key, v_reason,
                                 'admin', v_uid);
    select * into v_entry from public.points_ledger where dedupe_key = v_key;
  end if;
  if v_entry.member_id <> v_member.id or v_entry.amount <> p_amount then
    raise exception 'that request was already used for something else' using errcode = '22023', hint = 'request_reused';
  end if;
  return jsonb_build_object('id', v_entry.id, 'duplicate', v_new is null,
                            'balance', private.member_balance(v_member.id));
end $$;

-- ---------------------------------------------------------------------------
-- Balances, read through RLS. earned is the net of earns, their reversals and bonuses: what doing
-- things has brought in, before spending and adjustments.
-- ---------------------------------------------------------------------------

create view public.v_points_balance with (security_invoker = true) as
select l.household_id,
       l.member_id,
       sum(l.amount)::integer as balance,
       coalesce(sum(l.amount) filter (where l.entry_type in ('earn', 'reversal', 'bonus')), 0)::integer as earned,
       max(l.created_at) as last_entry_at
  from public.points_ledger l
 group by l.household_id, l.member_id;

-- ---------------------------------------------------------------------------
-- [NFR-06] The ledger agrees with the statuses: for each occurrence due in a range, each member holds
-- its points exactly while it is done and rewards them. The nightly status check reports any
-- difference; reconcile_occurrence_points corrects one (a parent's explicit action, never a job's).
-- ---------------------------------------------------------------------------

create function private.points_drift(p_household uuid, p_from date, p_to date)
returns table (occurrence_id uuid, member_id uuid, held integer, owed integer)
language sql stable security definer set search_path = '' as $$
  with occ as (
    select o.id, o.points_snapshot,
           case when o.status in ('completed', 'approved')
                then array(select m.id from public.member m
                            where m.id = any (o.rewarded) and m.household_id = o.household_id)
                else '{}'::uuid[] end as owed_to
      from public.chore_occurrence o
     where o.household_id = p_household and o.due_date between p_from and p_to
  ), held as (
    select l.occurrence_id, l.member_id, sum(l.amount)::integer as amount
      from public.points_ledger l
      join occ on occ.id = l.occurrence_id
     where l.entry_type in ('earn', 'reversal')
     group by l.occurrence_id, l.member_id
  ), pairs as (
    select occ.id as occurrence_id, unnest(occ.owed_to) as member_id from occ
    union
    select h.occurrence_id, h.member_id from held h
  )
  select p.occurrence_id, p.member_id, coalesce(h.amount, 0),
         case when p.member_id = any (occ.owed_to) then occ.points_snapshot else 0 end
    from pairs p
    join occ on occ.id = p.occurrence_id
    left join held h on h.occurrence_id = p.occurrence_id and h.member_id = p.member_id
   where coalesce(h.amount, 0)
         <> case when p.member_id = any (occ.owed_to) then occ.points_snapshot else 0 end
$$;

-- The status_check job's report gains the ledger: points_drift counts members whose points for an
-- occurrence differ from what it owes them. The job fails on either kind of drift.
create or replace function public.occurrence_status_drift(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := private.household_today(p_household_id);
  v_drift  jsonb;
  v_points jsonb;
begin
  if v_today is null then
    raise exception 'unknown household' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('occurrence_id', r.occurrence_id, 'was', r.was, 'now_is', r.now_is)), '[]')
    into v_drift
    from private.rebuild_occurrence_status(p_household_id, v_today - 14, v_today + 14) r;
  select coalesce(jsonb_agg(jsonb_build_object('occurrence_id', p.occurrence_id, 'member_id', p.member_id,
                                               'held', p.held, 'owed', p.owed)), '[]')
    into v_points
    from private.points_drift(p_household_id, v_today - 14, v_today + 14) p;
  return jsonb_build_object('from', v_today - 14, 'through', v_today + 14, 'drift', jsonb_array_length(v_drift),
                            'sample', (select coalesce(jsonb_agg(x), '[]') from (
                                         select x from jsonb_array_elements(v_drift) x limit 5) s),
                            'points_drift', jsonb_array_length(v_points),
                            'points_sample', (select coalesce(jsonb_agg(x), '[]') from (
                                                select x from jsonb_array_elements(v_points) x limit 5) s));
end $$;

-- ---------------------------------------------------------------------------
-- The board's snapshot gains each rewarded member's points (PTS-02): the balance, and the latest five
-- entries with what they were for. Read through RLS as the board, so a private item's title stays
-- hidden (its points still count). Earlier builds of the board ignore the new field.
-- ---------------------------------------------------------------------------

create or replace function public.board_snapshot(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_device    public.device;
  v_household public.household;
  v_today     date;
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
  -- yesterday through two weeks ahead (calendar).
  v_today := (now() at time zone v_household.timezone)::date;
  v_from := coalesce(p_from, v_today - 1);
  v_to := coalesce(p_to, v_today + 14);
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
      'week_start', v_household.week_start),
    'device', jsonb_build_object(
      'id', v_device.id,
      'name', v_device.name,
      'theme', coalesce(v_device.board_config ->> 'theme', 'auto')),
    -- Children first, then adults; each by name. Archived members are not on the board. Points only
    -- for those who earn rewards (D-32).
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
                                     limit 5) x)) end)
             order by (m.role = 'child') desc, m.display_name, m.id)
        from public.member m
       where m.household_id = v_household.id and m.archived_at is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke all on function private.prevent_ledger_change(), private.reconcile_occurrence_points(uuid),
                       private.post_points(), private.backfill_points(), private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid),
                       private.member_balance(uuid), private.points_drift(uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.adjust_points(uuid, integer, text, uuid) from public, anon;
grant execute on function public.adjust_points(uuid, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security (D-28): admins and the board read their household's ledger, whole, because a
-- balance is a sum (a private item's earn shows only its amount; its title stays behind the item's
-- own RLS). Nobody inserts, updates or deletes: not the app, not the service role.
-- ---------------------------------------------------------------------------

alter table public.points_ledger enable row level security;

create policy points_ledger_admin_select on public.points_ledger for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy points_ledger_device_select on public.points_ledger for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.points_ledger, public.v_points_balance from anon;
revoke insert, update, delete, truncate on public.points_ledger from authenticated, service_role;
grant select on public.points_ledger, public.v_points_balance to authenticated;

-- Realtime: a points change tells the board to refetch (apps/web/lib/live.ts).
alter publication supabase_realtime add table public.points_ledger;
