-- [PTS-03][PTS-04] The rewards shop (WP-18, 02 §3.3b, 02 §4.2b, D-28, D-53): a household's catalog of
-- rewards and activities with point costs, an optional photo, stock and weekly limit; and
-- redemptions, which a child asks for on the board and a parent approves (posting the spend), denies,
-- fulfils or cancels (refunding a spend). Only database functions change a redemption, and the
-- ledger's spend and refund go through its one writer, private.post_ledger.

-- ---------------------------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------------------------

create table public.reward_catalog_item (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  title        text not null check (title = btrim(title) and length(title) between 1 and 80),
  description  text check (description = btrim(description) and length(description) between 1 and 300),
  icon         text not null default 'gift' check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- A photo in the private `rewards` bucket: '{household}/{item}/{file}'.
  image_path   text check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  cost_points  integer not null check (cost_points between 1 and 100000),
  stock        integer check (stock >= 0),          -- null: as many as asked for
  weekly_limit integer check (weekly_limit >= 1),   -- per child per household week; null: none
  active       boolean not null default true,       -- off: kept, but not offered
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);
create index on public.reward_catalog_item (household_id, sort_order, title);

-- ---------------------------------------------------------------------------------------------
-- Redemptions
-- ---------------------------------------------------------------------------------------------

create table public.redemption (
  id                uuid primary key,          -- made by the caller: asking twice is one request
  household_id      uuid not null references public.household (id) on delete cascade,
  member_id         uuid not null,
  catalog_item_id   uuid not null,
  cost_snapshot     integer not null check (cost_snapshot > 0),  -- the cost when asked, kept
  status            text not null default 'requested'
                      check (status in ('requested', 'approved', 'denied', 'fulfilled', 'cancelled')),
  requested_at      timestamptz not null default now(),
  requested_by_type text not null check (requested_by_type in ('device', 'admin')),
  requested_by      uuid,                       -- the board's device id, or the admin's user id
  decided_at        timestamptz,
  decided_by        uuid,
  fulfilled_at      timestamptz,
  cancelled_at      timestamptz,
  note              text check (note = btrim(note) and length(note) between 1 and 200),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, catalog_item_id) references public.reward_catalog_item (household_id, id)
);
create index on public.redemption (household_id, status, requested_at);
create index on public.redemption (member_id, status);
create index on public.redemption (catalog_item_id, status);

-- A spend or refund names its redemption.
alter table public.points_ledger add column redemption_id uuid;
alter table public.points_ledger add constraint points_ledger_redemption_fkey
  foreign key (household_id, redemption_id) references public.redemption (household_id, id);
alter table public.points_ledger add constraint points_ledger_redemption_check
  check ((entry_type in ('spend', 'refund')) = (redemption_id is not null));
create index on public.points_ledger (redemption_id) where redemption_id is not null;

-- The ledger's one writer (D-28) learns the redemption. Same body, one more argument, defaulted, so
-- the existing callers (adjust_points) are unchanged.
drop function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid);
create function private.post_ledger(
  p_household uuid, p_member uuid, p_type text, p_amount integer, p_dedupe_key text, p_reason text,
  p_created_by_type text, p_created_by uuid, p_redemption uuid default null)
returns uuid
language sql security definer set search_path = '' as $$
  insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                    created_by_type, created_by, redemption_id)
  values (p_household, p_member, p_type, p_amount, p_reason, p_dedupe_key, p_created_by_type, p_created_by,
          p_redemption)
  on conflict (dedupe_key) do nothing
  returning id
$$;

-- Who is asking: a board of this household (its device id), or one of its admins (their user id).
create function private.redemption_actor(p_household uuid, out actor_type text, out actor_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  select 'device', d.id into actor_type, actor_id
    from public.device d
   where d.auth_user_id = auth.uid() and d.status = 'active' and d.household_id = p_household;
  if found then
    return;
  end if;
  if auth.uid() is not null and exists (select from public.household_user hu
                                         where hu.household_id = p_household and hu.user_id = auth.uid()) then
    actor_type := 'admin';
    actor_id := auth.uid();
    return;
  end if;
  raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
end $$;

create function private.redemption_json(r public.redemption, p_duplicate boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'member_id', r.member_id,
                            'catalog_item_id', r.catalog_item_id, 'cost', r.cost_snapshot,
                            'duplicate', p_duplicate)
$$;

-- [PTS-04][US-1104] A child asks for a reward, on the board or through a parent. Under a lock on the
-- member (and on the item, for its stock), it is accepted only while the member's balance less what
-- they have already asked for is at least the cost, the item is offered, in stock, and under its
-- weekly limit. The caller's id makes asking twice one request: the same id answers the same way.
create function public.request_redemption(p_id uuid, p_member_id uuid, p_item_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m          record;
  i          record;
  r          public.redemption;
  v_actor    record;
  v_week     date;
  v_open     integer;
  v_balance  integer;
begin
  if p_id is null or p_member_id is null or p_item_id is null then
    raise exception 'say which request, member and reward' using errcode = '22023', hint = 'bad_request';
  end if;
  select mm.household_id, mm.earns_rewards, mm.archived_at, h.timezone, h.week_start into m
    from public.member mm join public.household h on h.id = mm.household_id
   where mm.id = p_member_id
     for update of mm;
  if not found then
    raise exception 'member not found' using errcode = 'P0002', hint = 'member_not_found';
  end if;
  select * into v_actor from private.redemption_actor(m.household_id);

  select * into r from public.redemption where id = p_id;
  if found then
    if r.member_id <> p_member_id or r.catalog_item_id <> p_item_id then
      raise exception 'that request id was used for something else' using errcode = '23514', hint = 'request_reused';
    end if;
    return private.redemption_json(r, true);
  end if;

  if not m.earns_rewards or m.archived_at is not null then
    raise exception 'this member does not earn rewards' using errcode = '23514', hint = 'not_earning';
  end if;
  select * into i from public.reward_catalog_item
   where id = p_item_id and household_id = m.household_id
     for update;
  if not found or not i.active or i.archived_at is not null then
    raise exception 'that reward is not offered' using errcode = 'P0002', hint = 'item_unavailable';
  end if;
  if i.stock is not null and (select count(*) from public.redemption
                               where catalog_item_id = i.id and status in ('requested', 'approved', 'fulfilled')) >= i.stock then
    raise exception 'that reward is out of stock' using errcode = '23514', hint = 'out_of_stock';
  end if;
  if i.weekly_limit is not null then
    v_week := private.local_date(m.timezone, now());
    v_week := v_week - ((extract(dow from v_week)::integer - m.week_start + 7) % 7);
    if (select count(*) from public.redemption
         where catalog_item_id = i.id and member_id = p_member_id
           and status in ('requested', 'approved', 'fulfilled')
           and private.local_date(m.timezone, requested_at) >= v_week) >= i.weekly_limit then
      raise exception 'asked for enough of that this week' using errcode = '23514', hint = 'weekly_limit';
    end if;
  end if;
  v_balance := private.member_balance(p_member_id);
  select coalesce(sum(cost_snapshot), 0) into v_open
    from public.redemption where member_id = p_member_id and status = 'requested';
  if v_balance - v_open < i.cost_points then
    raise exception 'not enough points' using errcode = '23514', hint = 'not_enough_points',
      detail = format('available %s, cost %s', v_balance - v_open, i.cost_points);
  end if;

  insert into public.redemption (id, household_id, member_id, catalog_item_id, cost_snapshot,
                                 requested_by_type, requested_by)
  values (p_id, m.household_id, p_member_id, i.id, i.cost_points, v_actor.actor_type, v_actor.actor_id)
  returning * into r;
  return private.redemption_json(r, false);
end $$;

-- [PTS-04][US-1105] A parent approves (the spend is posted, so the balance drops by the cost asked)
-- or denies a request. Deciding the same way again changes nothing; a decided request is not
-- decided again the other way.
create function public.decide_redemption(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.redemption;
  v_actor record;
  v_to    text;
begin
  v_to := case p_decision when 'approve' then 'approved' when 'deny' then 'denied' end;
  if v_to is null then
    raise exception 'approve or deny' using errcode = '22023', hint = 'bad_decision';
  end if;
  select * into r from public.redemption where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002', hint = 'redemption_not_found';
  end if;
  select * into v_actor from private.redemption_actor(r.household_id);
  if v_actor.actor_type <> 'admin' then
    raise exception 'a parent decides' using errcode = '42501', hint = 'not_allowed';
  end if;
  if r.status = v_to or (v_to = 'approved' and r.status = 'fulfilled') then
    return private.redemption_json(r, true);
  end if;
  if r.status <> 'requested' then
    raise exception 'that request is no longer waiting' using errcode = '23514', hint = 'not_requested';
  end if;
  update public.redemption
     set status = v_to, decided_at = now(), decided_by = v_actor.actor_id,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = p_id
  returning * into r;
  if v_to = 'approved' then
    perform private.post_ledger(r.household_id, r.member_id, 'spend', -r.cost_snapshot, 'red:' || r.id || ':spend',
                                (select title from public.reward_catalog_item where id = r.catalog_item_id),
                                'admin', v_actor.actor_id, r.id);
  end if;
  return private.redemption_json(r, false);
end $$;

-- [PTS-04][US-1104] Cancels a request: a child (on the board) or a parent while it is waiting, with
-- nothing posted; or a parent after approving it, which refunds the spend. A fulfilled reward has
-- happened and is not cancelled. Cancelling again changes nothing.
create function public.cancel_redemption(p_id uuid) returns jsonb
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
  if v_was = 'approved' then
    perform private.post_ledger(r.household_id, r.member_id, 'refund', r.cost_snapshot, 'red:' || r.id || ':refund',
                                (select title from public.reward_catalog_item where id = r.catalog_item_id),
                                'admin', v_actor.actor_id, r.id);
  end if;
  return private.redemption_json(r, false);
end $$;

-- [PTS-04][US-1105] A parent marks an approved reward as given: bookkeeping only.
create function public.fulfil_redemption(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.redemption;
  v_actor record;
begin
  select * into r from public.redemption where id = p_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002', hint = 'redemption_not_found';
  end if;
  select * into v_actor from private.redemption_actor(r.household_id);
  if v_actor.actor_type <> 'admin' then
    raise exception 'a parent marks it given' using errcode = '42501', hint = 'not_allowed';
  end if;
  if r.status = 'fulfilled' then
    return private.redemption_json(r, true);
  end if;
  if r.status <> 'approved' then
    raise exception 'approve it first' using errcode = '23514', hint = 'not_approved';
  end if;
  update public.redemption set status = 'fulfilled', fulfilled_at = now() where id = p_id returning * into r;
  return private.redemption_json(r, false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: admins manage their household's catalog and read its redemptions; a board
-- reads both. Redemptions change only through the functions above.
-- ---------------------------------------------------------------------------------------------

alter table public.reward_catalog_item enable row level security;
alter table public.redemption enable row level security;

create policy reward_catalog_item_admin_select on public.reward_catalog_item for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy reward_catalog_item_admin_insert on public.reward_catalog_item for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy reward_catalog_item_admin_update on public.reward_catalog_item for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy reward_catalog_item_device_select on public.reward_catalog_item for select to authenticated
  using (household_id = (select private.device_household_id()));

create policy redemption_admin_select on public.redemption for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy redemption_device_select on public.redemption for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.reward_catalog_item, public.redemption from anon;
revoke delete, truncate on public.reward_catalog_item from authenticated;
revoke insert, update, delete, truncate on public.redemption from authenticated;
grant select, insert, update on public.reward_catalog_item to authenticated;
grant select on public.redemption to authenticated;

revoke all on function private.post_ledger(uuid, uuid, text, integer, text, text, text, uuid, uuid),
  private.redemption_actor(uuid), private.redemption_json(public.redemption, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.request_redemption(uuid, uuid, uuid), public.decide_redemption(uuid, text, text),
  public.cancel_redemption(uuid), public.fulfil_redemption(uuid) from public, anon;
grant execute on function public.request_redemption(uuid, uuid, uuid), public.decide_redemption(uuid, text, text),
  public.cancel_redemption(uuid), public.fulfil_redemption(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Photos: a private bucket, one folder per household. Its admins add, change and remove them; its
-- boards and admins read them (through short-lived signed links).
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rewards', 'rewards', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy rewards_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'rewards'
         and ((storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h)
              or (storage.foldername(name))[1] = (select private.device_household_id())::text));
create policy rewards_photo_add on storage.objects for insert to authenticated
  with check (bucket_id = 'rewards'
              and (storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h));
create policy rewards_photo_change on storage.objects for update to authenticated
  using (bucket_id = 'rewards'
         and (storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h));
create policy rewards_photo_remove on storage.objects for delete to authenticated
  using (bucket_id = 'rewards'
         and (storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h));
