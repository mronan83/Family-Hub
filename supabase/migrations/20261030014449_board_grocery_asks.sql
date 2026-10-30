-- [MEAL-22][MEAL-30] Asking, ticking off and taking off on the board's Groceries (WP-107, D-138 (8),
-- D-149; 02 §3.8).
--   * `grocery_ask`: what someone asked for at the board, as theirs. An adult's ask, a child's with
--     their OK off, and anything already open on the list go on the list at once (`added`, with the
--     item it joined); a child's with their OK on waits for a parent (`waiting`), then is `added` or
--     `declined` (Not this time), or `called_off` at the board. At most 5 wait for a child.
--   * `member.grocery_ask_ok`: each child's parent OK, on to start (D-149 (4)).
--   * A board ticks, unticks and takes off its household's items as one of its members: the tick
--     and the event say who and at which board (`grocery_item.ticked_member_id`, `ticked_device_id`,
--     `grocery_item_event.member_id`, `device_id`). A child takes off only what they alone asked for
--     (D-149 (1)); Undo puts back what that board took off in the last 10 minutes (`restored`).
--   * Every way in still goes through the one merge: add_groceries()'s body becomes
--     private.grocery_add_items(), which the board's asks and a parent's approval use too.
--   * A waiting ask counts in the approvals alert (WP-63): "Maya: 1 grocery ask waiting".
-- Every write goes through the functions below; boards and the household's parents read the asks.

alter table public.member add column grocery_ask_ok boolean not null default true;

create table public.grocery_ask (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  member_id    uuid not null,
  name         text not null check (name = btrim(name) and length(name) between 1 and 80),
  name_key     text not null check (length(name_key) between 1 and 80),
  -- The category the board suggested, used when it goes on the list as a new item.
  category_id  uuid,
  brand_id     uuid,
  status       text not null default 'waiting'
                 check (status in ('waiting', 'added', 'declined', 'called_off')),
  -- The item it went on the list as, or joined.
  item_id      uuid,
  asked_by     uuid references public.device (id) on delete set null,
  asked_at     timestamptz not null default now(),
  decided_by   uuid,
  decided_at   timestamptz,
  check ((status = 'added') = (item_id is not null)),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id) on delete cascade,
  foreign key (household_id, item_id) references public.grocery_item (household_id, id),
  foreign key (household_id, category_id) references public.grocery_category (household_id, id)
    on delete set null (category_id),
  foreign key (household_id, brand_id) references public.grocery_brand (household_id, id)
    on delete set null (brand_id)
);
create index on public.grocery_ask (household_id, status, member_id);
create index on public.grocery_ask (item_id) where item_id is not null;

alter table public.grocery_item
  add column ticked_member_id uuid,
  add column ticked_device_id uuid references public.device (id) on delete set null;
alter table public.grocery_item add constraint grocery_item_ticked_member_fkey
  foreign key (household_id, ticked_member_id) references public.member (household_id, id)
  on delete set null (ticked_member_id);

alter table public.grocery_item_event
  add column member_id uuid,
  add column device_id uuid references public.device (id) on delete set null;
alter table public.grocery_item_event add constraint grocery_item_event_member_fkey
  foreign key (household_id, member_id) references public.member (household_id, id)
  on delete set null (member_id);
alter table public.grocery_item_event drop constraint grocery_item_event_kind_check;
alter table public.grocery_item_event add constraint grocery_item_event_kind_check
  check (kind in ('added', 'merged', 'changed', 'ticked', 'unticked', 'removed', 'restored'));
create index on public.grocery_item_event (device_id, at) where device_id is not null;

-- ---------------------------------------------------------------------------------------------
-- The one way in, shared
-- ---------------------------------------------------------------------------------------------

-- [MEAL-20][MEAL-29] add_groceries()'s body as WP-116 left it, without the access check, so a board's
-- ask and a parent's approval add through the same merge. The caller checks access.
create function private.grocery_add_items(p_household uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x        jsonb;
  r        jsonb;
  v_list   uuid;
  v_name   text;
  v_key    text;
  v_amount text;
  v_into   uuid;
  v_item   uuid;
  v_store  uuid;
  v_brand  uuid;
  v_kind   text;
  v_member uuid;
  v_entry  uuid;
  v_merged boolean;
  v_out    jsonb := '[]';
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 200 then
    raise exception 'items to add' using errcode = '22023', hint = 'bad_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || p_household, 0));
  select id into v_list from public.grocery_list where household_id = p_household;

  for x in select * from jsonb_array_elements(p_items) loop
    v_name := nullif(btrim(x ->> 'name'), '');
    v_key := nullif(btrim(x ->> 'key'), '');
    v_amount := nullif(btrim(x ->> 'amount'), '');
    r := coalesce(x -> 'reason', '{}');
    v_kind := coalesce(r ->> 'kind', 'added');
    begin
      v_into := nullif(x ->> 'into_id', '')::uuid;
      v_store := nullif(x ->> 'store_id', '')::uuid;
      v_brand := nullif(x ->> 'brand_id', '')::uuid;
      v_member := nullif(r ->> 'member_id', '')::uuid;
      v_entry := nullif(r ->> 'meal_plan_entry_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'bad item' using errcode = '22023', hint = 'bad_request';
    end;
    if v_name is null or v_key is null then
      raise exception 'a name' using errcode = '22023', hint = 'bad_request';
    end if;
    if v_kind not in ('added', 'meal', 'ask', 'staple') then
      raise exception 'bad reason' using errcode = '22023', hint = 'bad_request';
    end if;
    if v_entry is not null and not exists (select from public.meal_plan_entry e
                                            where e.id = v_entry and e.household_id = p_household) then
      raise exception 'not this family''s meal' using errcode = '22023', hint = 'meal_gone';
    end if;
    if v_member is not null and not exists (select from public.member m
                                             where m.id = v_member and m.household_id = p_household) then
      raise exception 'not this family''s member' using errcode = '22023', hint = 'bad_request';
    end if;
    if v_store is not null and not exists (select from public.grocery_store s
                                            where s.id = v_store and s.household_id = p_household) then
      v_store := null;
    end if;

    if v_brand is not null then
      update public.grocery_brand set archived_at = null
       where id = v_brand and household_id = p_household and archived_at is not null;
      if not exists (select from public.grocery_brand b where b.id = v_brand and b.household_id = p_household) then
        v_brand := null;
      end if;
    end if;
    if v_brand is null then
      v_brand := private.grocery_brand_for(p_household, x ->> 'brand');
    end if;

    v_item := null;
    if v_into is not null then
      select i.id into v_item from public.grocery_item i
       where i.id = v_into and i.household_id = p_household and i.status = 'open';
    end if;
    if v_item is null then
      select i.id into v_item from public.grocery_item i
       where i.household_id = p_household and i.name_key = v_key and i.status = 'open';
    end if;
    v_merged := v_item is not null;
    if not v_merged then
      insert into public.grocery_item (household_id, list_id, name, name_key, category_id, store_id,
                                       brand_id, created_by)
      values (p_household, v_list, v_name, v_key,
              private.grocery_category_or_other(p_household, nullif(x ->> 'category_id', '')::uuid),
              v_store, v_brand, auth.uid())
      returning id into v_item;
    elsif v_brand is not null then
      with changed as (
        update public.grocery_item set brand_id = v_brand
         where id = v_item and brand_id is distinct from v_brand
        returning id)
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
      select p_household, id, 'changed', auth.uid(), jsonb_build_object('brand', v_brand) from changed;
    end if;
    insert into public.grocery_item_reason (household_id, item_id, kind, by_user, member_id,
                                            meal_plan_entry_id, label, amount)
    values (p_household, v_item, v_kind, auth.uid(), v_member, v_entry,
            nullif(btrim(r ->> 'label'), ''), v_amount);
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id, detail)
    values (p_household, v_item, case when v_merged then 'merged' else 'added' end, auth.uid(),
            case when v_kind = 'ask' then v_member end, private.my_device_id(),
            jsonb_strip_nulls(jsonb_build_object('name', v_name, 'amount', v_amount, 'reason', v_kind,
                                                 'label', nullif(btrim(r ->> 'label'), ''))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_item, 'merged', v_merged));
  end loop;
  return v_out;
end $$;

-- [MEAL-20] The one way in, for the household's parents, as before.
create or replace function public.add_groceries(p_household uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.grocery_access(p_household);
  return private.grocery_add_items(p_household, p_items);
end $$;

-- What the household had last time for a thing (by its key): category, store and brand.
create function private.grocery_last(p_household uuid, p_key text)
returns table (category_id uuid, store_id uuid, brand_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.category_id, i.store_id, i.brand_id from public.grocery_item i
   where i.household_id = p_household and i.name_key = p_key
   order by i.created_at desc limit 1
$$;

-- An ask as an item to add: last time's category (else the board's suggestion) and store (else the
-- preferred one, D-142), and its brand; the reason is the asker's.
create function private.grocery_ask_item(a public.grocery_ask) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'name', a.name, 'key', a.name_key,
           'category_id', coalesce(l.category_id, a.category_id),
           'store_id', coalesce(l.store_id, (select g.preferred_store_id from public.grocery_list g
                                               where g.household_id = a.household_id)),
           'brand_id', a.brand_id,
           'reason', jsonb_build_object('kind', 'ask', 'member_id', a.member_id))
    from (select 1) one
    left join lateral private.grocery_last(a.household_id, a.name_key) l on true
$$;

-- ---------------------------------------------------------------------------------------------
-- The board: who is it, and which household
-- ---------------------------------------------------------------------------------------------

-- A member of the calling board's household, not archived; raises otherwise.
create function private.board_member(p_member uuid) returns public.member
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.member;
begin
  select * into m from public.member where id = p_member and archived_at is null;
  if private.my_device_id() is null or not found
     or m.household_id is distinct from private.device_household_id() then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return m;
end $$;

-- The calling board's household's items, all of them; raises otherwise. One change at a time.
create function private.board_items(p_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.device_household_id();
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'no items' using errcode = '22023', hint = 'bad_request';
  end if;
  if v_household is null or exists (select from unnest(p_ids) x (id)
                                     where not exists (select from public.grocery_item i
                                                        where i.id = x.id and i.household_id = v_household)) then
    raise exception 'not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || v_household, 0));
  return v_household;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-22] Asking at the board
-- ---------------------------------------------------------------------------------------------

-- [MEAL-22] Someone asks for a thing at the board, as theirs: `key` is the merge's key for the name
-- (lib/grocery-merge.ts), `category` the board's suggestion, `brand` one of the household's or none.
-- Something open on the list already takes the asker as a reason ("already"); an adult's ask, or a
-- child's with their OK off, goes on the list; a child's with their OK on waits, at most 5 at a time.
-- Returns {id, status, item_id, already}.
create function public.ask_groceries(p_member uuid, p_name text, p_key text, p_category uuid default null,
                                     p_brand uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m         public.member := private.board_member(p_member);
  v_name    text := nullif(btrim(p_name), '');
  v_key     text := nullif(btrim(p_key), '');
  v_open    uuid;
  v_already boolean;
  a         public.grocery_ask;
begin
  if v_name is null or v_key is null or length(v_name) > 80 or length(v_key) > 80 then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  if p_brand is not null and not exists (select from public.grocery_brand b
                                          where b.id = p_brand and b.household_id = m.household_id) then
    raise exception 'not this family''s brand' using errcode = '22023', hint = 'bad_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || m.household_id, 0));

  -- The same thing waiting for them already: that ask, unchanged.
  select * into a from public.grocery_ask x
   where x.member_id = p_member and x.name_key = v_key and x.status = 'waiting';
  if found then
    return jsonb_build_object('id', a.id, 'status', a.status, 'item_id', null, 'already', false);
  end if;

  select i.id into v_open from public.grocery_item i
   where i.household_id = m.household_id and i.name_key = v_key and i.status = 'open';
  v_already := v_open is not null;
  if not v_already and m.role = 'child' and m.grocery_ask_ok
     and (select count(*) from public.grocery_ask x where x.member_id = p_member and x.status = 'waiting') >= 5 then
    raise exception 'five asks waiting' using errcode = '22023', hint = 'too_many';
  end if;

  a.household_id := m.household_id;
  a.member_id := p_member;
  a.name := v_name;
  a.name_key := v_key;
  a.category_id := private.grocery_category_or_other(m.household_id, p_category);
  a.brand_id := p_brand;
  a.status := 'waiting';
  a.item_id := null;
  -- What doesn't wait goes on the list first, so the ask is saved as it is (never waiting a moment).
  if v_already or m.role = 'adult' or not m.grocery_ask_ok then
    a.status := 'added';
    a.item_id := (private.grocery_add_items(m.household_id, jsonb_build_array(private.grocery_ask_item(a))) -> 0 ->> 'id')::uuid;
  end if;
  insert into public.grocery_ask (household_id, member_id, name, name_key, category_id, brand_id, status, item_id, asked_by)
  values (a.household_id, a.member_id, a.name, a.name_key, a.category_id, a.brand_id, a.status, a.item_id,
          private.my_device_id())
  returning * into a;
  return jsonb_build_object('id', a.id, 'status', a.status, 'item_id', a.item_id, 'already', v_already);
end $$;

-- [MEAL-22] Call off: a board takes back an ask of its household that still waits. Returns whether
-- it did (false when a parent decided it meanwhile).
create function public.call_off_grocery_ask(p_ask uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.device_household_id();
begin
  if private.my_device_id() is null
     or not exists (select from public.grocery_ask g where g.id = p_ask and g.household_id = v_household) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  update public.grocery_ask set status = 'called_off', decided_at = now()
   where id = p_ask and status = 'waiting';
  return found;
end $$;

-- [MEAL-22] A parent adds the children's waiting asks to the list, through the merge (p_approve), or
-- turns them down (Not this time). Only the household's parents. Returns how many were decided.
create function public.decide_grocery_asks(p_ids uuid[], p_approve boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a       public.grocery_ask;
  v_n     integer := 0;
begin
  if auth.uid() is null or p_ids is null or cardinality(p_ids) = 0 or p_approve is null then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if exists (select from unnest(p_ids) x (id)
              where not exists (select from public.grocery_ask g where g.id = x.id
                                   and g.household_id in (select private.admin_household_ids()))) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  for a in select * from public.grocery_ask x where x.id = any (p_ids) and x.status = 'waiting'
            order by x.asked_at for update loop
    if p_approve then
      update public.grocery_ask
         set status = 'added', decided_by = auth.uid(), decided_at = now(),
             item_id = (private.grocery_add_items(a.household_id, jsonb_build_array(private.grocery_ask_item(a))) -> 0 ->> 'id')::uuid
       where id = a.id;
    else
      update public.grocery_ask set status = 'declined', decided_by = auth.uid(), decided_at = now()
       where id = a.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- [MEAL-22] A child's parent OK (D-149 (4)): on, their asks wait for a parent; off, they go straight
-- on the list. Only the household's parents, for a child. Returns the setting.
create function public.set_grocery_ask_ok(p_member uuid, p_ok boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m public.member;
begin
  select * into m from public.member where id = p_member;
  if auth.uid() is null or not found or p_ok is null
     or m.household_id not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if m.role <> 'child' then
    raise exception 'a child''s setting' using errcode = '22023', hint = 'not_a_child';
  end if;
  update public.member set grocery_ask_ok = p_ok where id = p_member;
  return p_ok;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-30] Ticking off and taking off: one body for the admin app and the board
-- ---------------------------------------------------------------------------------------------

-- set_groceries_ticked()'s body as WP-104 made it, saying who (a member, at a board) when a board
-- does it. The caller checks access and takes the household's lock.
create function private.grocery_set_ticked(p_household uuid, p_ids uuid[], p_ticked boolean,
                                           p_member uuid, p_device uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  i      public.grocery_item;
  v_twin uuid;
  v_n    integer := 0;
begin
  if p_ticked is null then
    raise exception 'tick or untick' using errcode = '22023', hint = 'bad_request';
  end if;
  for i in select * from public.grocery_item where id = any (p_ids) order by name loop
    if p_ticked and i.status = 'open' then
      update public.grocery_item
         set status = 'ticked', ticked_at = now(), ticked_by = auth.uid(),
             ticked_member_id = p_member, ticked_device_id = p_device
       where id = i.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id)
      values (p_household, i.id, 'ticked', auth.uid(), p_member, p_device);
      v_n := v_n + 1;
    elsif not p_ticked and i.status = 'ticked' then
      select t.id into v_twin from public.grocery_item t
       where t.household_id = p_household and t.name_key = i.name_key and t.status = 'open';
      if v_twin is not null then
        update public.grocery_item_reason set item_id = i.id where item_id = v_twin;
        update public.grocery_ask set item_id = i.id where item_id = v_twin;
        update public.grocery_item set status = 'removed', removed_at = now() where id = v_twin;
        insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id, detail)
        values (p_household, v_twin, 'merged', auth.uid(), p_member, p_device, jsonb_build_object('into', i.id));
      end if;
      update public.grocery_item
         set status = 'open', ticked_at = null, ticked_by = null, ticked_member_id = null, ticked_device_id = null
       where id = i.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id)
      values (p_household, i.id, 'unticked', auth.uid(), p_member, p_device);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.set_groceries_ticked(p_ids uuid[], p_ticked boolean) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  return private.grocery_set_ticked(private.grocery_items_household(p_ids), p_ids, p_ticked, null, null);
end $$;

-- [MEAL-30] A board ticks (a buy) or unticks its household's items, as one of its members.
create function public.board_tick_groceries(p_ids uuid[], p_member uuid, p_ticked boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m           public.member := private.board_member(p_member);
  v_household uuid := private.board_items(p_ids);
begin
  return private.grocery_set_ticked(v_household, p_ids, p_ticked, m.id, private.my_device_id());
end $$;

-- [MEAL-30] A board takes its household's items off the list (not a buy), as one of its members. A
-- child takes off only a thing every reason of which is their own ask (D-149 (1)).
create function public.board_remove_groceries(p_ids uuid[], p_member uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m           public.member := private.board_member(p_member);
  v_household uuid := private.board_items(p_ids);
  v_n         integer;
begin
  if m.role = 'child' and exists (
       select from unnest(p_ids) x (id)
        where not exists (select from public.grocery_item_reason r where r.item_id = x.id)
           or exists (select from public.grocery_item_reason r
                       where r.item_id = x.id and (r.kind <> 'ask' or r.member_id is distinct from m.id))) then
    raise exception 'only a grown-up' using errcode = '42501', hint = 'not_yours';
  end if;
  with gone as (
    update public.grocery_item set status = 'removed', removed_at = now()
     where id = any (p_ids) and status = 'open'
    returning id)
  insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id)
  select v_household, id, 'removed', auth.uid(), m.id, private.my_device_id() from gone;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- [MEAL-30] Undo: a board puts back what it took off in the last 10 minutes, as it was. If the same
-- thing was added again meanwhile, that one is folded into it, so the list still has it once.
create function public.board_restore_groceries(p_ids uuid[], p_member uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  m           public.member := private.board_member(p_member);
  v_household uuid := private.board_items(p_ids);
  v_device    uuid := private.my_device_id();
  i           public.grocery_item;
  v_twin      uuid;
  v_n         integer := 0;
begin
  for i in select * from public.grocery_item x where x.id = any (p_ids) and x.status = 'removed'
              and x.removed_at > now() - interval '10 minutes'
              and exists (select from public.grocery_item_event e
                           where e.item_id = x.id and e.kind = 'removed' and e.device_id = v_device
                             and e.at >= x.removed_at) loop
    select t.id into v_twin from public.grocery_item t
     where t.household_id = v_household and t.name_key = i.name_key and t.status = 'open';
    if v_twin is not null then
      update public.grocery_item_reason set item_id = i.id where item_id = v_twin;
      update public.grocery_ask set item_id = i.id where item_id = v_twin;
      update public.grocery_item set status = 'removed', removed_at = now() where id = v_twin;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id, detail)
      values (v_household, v_twin, 'merged', auth.uid(), m.id, v_device, jsonb_build_object('into', i.id));
    end if;
    update public.grocery_item set status = 'open', removed_at = null where id = i.id;
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, member_id, device_id)
    values (v_household, i.id, 'restored', auth.uid(), m.id, v_device);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-18][MEAL-22][MEAL-30] The board's read, as WP-116 left it, and:
--   * `asks`: the board's Asked for card: what waits, what is on the list (asked in the last 7 days,
--     its item still open), and until the household's day ends what was got or turned down;
--   * `got`: what was ticked today, newest first, with who (Got today);
--   * `known`: the things the household has had, most bought first, each with its brands newest
--     first, for the ask's tiles, its matches as one types, and its brand row.
-- ---------------------------------------------------------------------------------------------
create or replace function public.board_groceries() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_household uuid := private.device_household_id();
  v_tz        text;
  v_today     date;
begin
  if v_household is null then
    return null;
  end if;
  select h.timezone into v_tz from public.household h where h.id = v_household;
  v_today := private.local_date(v_tz, now());
  return jsonb_build_object(
    'ever', exists (select from public.grocery_item i where i.household_id = v_household),
    'today', v_today,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon,
                                          'starter_key', c.starter_key, 'is_other', c.is_other,
                                          'sort_order', c.sort_order)
                       order by c.is_other, c.sort_order, c.name)
        from public.grocery_category c where c.household_id = v_household), '[]'),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'sort_order', s.sort_order)
                       order by s.sort_order, s.name)
        from public.grocery_store s where s.household_id = v_household), '[]'),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'archived', b.archived_at is not null)
                       order by lower(b.name))
        from public.grocery_brand b where b.household_id = v_household), '[]'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'amount', i.amount, 'category_id', i.category_id,
               'store_id', i.store_id, 'brand_id', i.brand_id, 'created_at', i.created_at,
               'reasons', coalesce((
                 select jsonb_agg(jsonb_build_object('kind', r.kind, 'member_id', r.member_id,
                                                     'label', r.label, 'amount', r.amount,
                                                     'created_at', r.created_at)
                                  order by r.created_at)
                   from public.grocery_item_reason r where r.item_id = i.id), '[]'))
             order by lower(i.name))
        from public.grocery_item i where i.household_id = v_household and i.status = 'open'), '[]'),
    'asks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'member_id', a.member_id, 'name', a.name, 'brand_id', a.brand_id,
               'status', a.status, 'asked_at', a.asked_at, 'item_status', i.status,
               'got_today', i.status = 'ticked' and private.local_date(v_tz, i.ticked_at) = v_today)
             order by a.asked_at desc)
        from public.grocery_ask a
        left join public.grocery_item i on i.id = a.item_id
       where a.household_id = v_household
         and (a.status = 'waiting'
              or (a.status = 'added' and i.status = 'open' and a.asked_at > now() - interval '7 days')
              or (a.status = 'added' and i.status = 'ticked' and private.local_date(v_tz, i.ticked_at) = v_today)
              or (a.status = 'declined' and private.local_date(v_tz, a.decided_at) = v_today))), '[]'),
    'got', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'brand_id', i.brand_id,
                                          'category_id', i.category_id, 'ticked_at', i.ticked_at,
                                          'member_id', i.ticked_member_id)
                       order by i.ticked_at desc)
        from public.grocery_item i
       where i.household_id = v_household and i.status = 'ticked'
         and i.ticked_at > now() - interval '2 days'
         and private.local_date(v_tz, i.ticked_at) = v_today), '[]'),
    'known', coalesce((
      select jsonb_agg(jsonb_build_object('key', k.name_key, 'name', k.name, 'category_id', k.category_id,
                                          'buys', k.buys, 'brand_ids', k.brand_ids)
                       order by k.buys desc, k.last_at desc)
        from (select i.name_key,
                     (array_agg(i.name order by i.created_at desc))[1] as name,
                     (array_agg(i.category_id order by i.created_at desc))[1] as category_id,
                     count(*) filter (where i.status = 'ticked') as buys,
                     max(i.created_at) as last_at,
                     coalesce((select jsonb_agg(b.brand_id order by b.last_at desc)
                                 from (select j.brand_id, max(j.created_at) as last_at
                                         from public.grocery_item j
                                        where j.household_id = v_household and j.name_key = i.name_key
                                          and j.brand_id is not null
                                        group by j.brand_id) b), '[]') as brand_ids
                from public.grocery_item i
               where i.household_id = v_household
               group by i.name_key
               order by count(*) filter (where i.status = 'ticked') desc, max(i.created_at) desc
               limit 300) k), '[]'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-22][CHR-20] The approvals alert counts grocery asks (WP-63, D-149 (9))
-- ---------------------------------------------------------------------------------------------

drop function private.approvals_waiting(uuid, uuid, timestamptz, timestamptz);

-- What waits for this parent that became waiting in (p_from, p_to] and still waits: one row per
-- child, with their check-offs, reward requests, lunch changes and grocery asks.
create function private.approvals_waiting(p_household uuid, p_member uuid, p_from timestamptz, p_to timestamptz)
returns table (child uuid, name text, checkoffs integer, requests integer, lunches integer, groceries integer)
language sql stable security definer set search_path = '' as $$
  with parent as (
    select m.id, m.user_id from public.member m where m.id = p_member
  ), checkoff as (
    select coalesce(o.done_by[1], (select a.member_id from public.chore_occurrence_assignee a
                                    where a.occurrence_id = o.id order by a.member_id limit 1)) as child
      from public.chore_occurrence o
      join public.chore c on c.id = o.chore_id
      cross join parent p
     where o.household_id = p_household
       and o.status = 'pending_approval'
       and o.status_changed_at > p_from and o.status_changed_at <= p_to
       and (c.visibility = 'family' or c.created_by = p.user_id
            or exists (select from public.chore_assignee ca where ca.chore_id = c.id and ca.member_id = p.id))
       and not (p.id = any (o.done_by))
  ), request as (
    select r.member_id as child
      from public.redemption r
      cross join parent p
     where r.household_id = p_household
       and r.status = 'requested'
       and r.requested_at > p_from and r.requested_at <= p_to
       and not (r.requested_by_type = 'admin' and r.requested_by is not distinct from p.user_id)
  ), lunch as (
    -- [MEAL-09] A child's lunch change, until its cut-off.
    select l.member_id as child
      from public.lunch_request l
     where l.household_id = p_household
       and l.status = 'waiting'
       and l.requested_at > p_from and l.requested_at <= p_to
       and l.open_until > p_to
  ), grocery as (
    -- [MEAL-22] A child's grocery ask from the board.
    select g.member_id as child
      from public.grocery_ask g
     where g.household_id = p_household
       and g.status = 'waiting'
       and g.asked_at > p_from and g.asked_at <= p_to
  ), counted as (
    select child, count(*)::integer as checkoffs, 0 as requests, 0 as lunches, 0 as groceries from checkoff group by child
    union all
    select child, 0, count(*)::integer, 0, 0 from request group by child
    union all
    select child, 0, 0, count(*)::integer, 0 from lunch group by child
    union all
    select child, 0, 0, 0, count(*)::integer from grocery group by child
  )
  select m.id, m.display_name, sum(k.checkoffs)::integer, sum(k.requests)::integer, sum(k.lunches)::integer,
         sum(k.groceries)::integer
    from counted k
    join public.member m on m.id = k.child
   group by m.id, m.display_name, m.created_at
   order by m.created_at, m.display_name
$$;

-- "Maya: 3 check-offs and 1 grocery ask · Leo: 1 reward request waiting".
create or replace function private.approvals_line(p_waiting jsonb) returns text
language sql immutable set search_path = '' as $$
  select string_agg(
           (w ->> 'name') || ': ' || concat_ws(' and ',
             case (w ->> 'checkoffs')::integer when 0 then null when 1 then '1 check-off'
                  else (w ->> 'checkoffs') || ' check-offs' end,
             case (w ->> 'requests')::integer when 0 then null when 1 then '1 reward request'
                  else (w ->> 'requests') || ' reward requests' end,
             case coalesce((w ->> 'lunches')::integer, 0) when 0 then null when 1 then '1 lunch change'
                  else (w ->> 'lunches') || ' lunch changes' end,
             case coalesce((w ->> 'groceries')::integer, 0) when 0 then null when 1 then '1 grocery ask'
                  else (w ->> 'groceries') || ' grocery asks' end),
           ' · ' order by ord) || ' waiting'
    from jsonb_array_elements(p_waiting) with ordinality as x (w, ord)
$$;

revoke all on function private.approvals_waiting(uuid, uuid, timestamptz, timestamptz),
  private.approvals_line(jsonb) from public, anon, authenticated;

-- [CHR-20] As WP-92 left it, and: when only grocery asks wait, the alert opens Groceries.
create or replace function public.claim_reminders(p_household uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz      text;
  v_today   date;
  d         public.reminder_delivery;
  p         public.reminder_preference;
  v_devices jsonb;
  v_title   text;
  v_body    text;
  v_url     text;
  v_tag     text;
  v_skip    text;
  v_out     jsonb := '[]'::jsonb;
  o         record;
  v_open    integer;
  v_late    integer;
  v_names   text[];
  v_waiting jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select timezone into v_tz from public.household where id = p_household;
  v_today := (p_now at time zone v_tz)::date;

  for d in select * from public.reminder_delivery
            where household_id = p_household and status = 'held' and scheduled_for <= p_now
            order by scheduled_for, id
            for update skip locked loop
    v_skip := null;
    v_tag := d.dedupe_key;
    select * into p from public.reminder_preference where member_id = d.member_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
                                                 'auth', s.auth_secret) order by s.created_at), '[]'::jsonb)
      into v_devices
      from public.push_subscription s where s.member_id = d.member_id and s.enabled;

    if d.kind = 'approval' then
      update public.reminder_delivery set waiting_to = greatest(p_now, waiting_from) where id = d.id;
    end if;

    if p.member_id is null or not p.enabled then
      v_skip := 'reminders_off';
    elsif d.kind = 'approval' and not p.approval_alerts then
      v_skip := 'approvals_off';
    elsif d.scheduled_for < p_now - interval '2 hours' then
      v_skip := 'late';
    end if;

    if v_skip is null and d.kind = 'due' then
      select oc.status, oc.due_date, oc.due_time, oc.kind, c.title, c.visibility, c.archived_at,
             coalesce(ca.remind, p.default_on) as bell,
             exists (select from public.chore_occurrence_assignee a
                      where a.occurrence_id = oc.id and a.member_id = d.member_id) as assigned
        into o
        from public.chore_occurrence oc
        join public.chore c on c.id = oc.chore_id
        left join public.chore_assignee ca on ca.chore_id = oc.chore_id and ca.member_id = d.member_id
       where oc.id = d.occurrence_id;
      if o.status is null or o.status not in ('scheduled', 'rejected') then
        v_skip := 'done';
      elsif not o.assigned or not o.bell or o.archived_at is not null then
        v_skip := 'item_off';
      else
        v_title := case when o.visibility = 'private' and p.hide_private_titles
                        then case when o.kind = 'task' then 'Private task' else 'Private chore' end
                        else o.title end;
        v_body := case
          when o.due_time is null then 'Due today'
          when o.due_date = v_today then 'Due at ' || private.clock_words(o.due_time)
          when o.due_date = v_today + 1 then 'Due tomorrow at ' || private.clock_words(o.due_time)
          when o.due_date = v_today - 1 then 'Was due yesterday at ' || private.clock_words(o.due_time)
          else 'Due ' || to_char(o.due_date, 'Dy') || ' at ' || private.clock_words(o.due_time)
        end;
        v_url := '/admin/my#item-' || d.occurrence_id;
      end if;
    elsif v_skip is null and d.kind = 'approval' then
      -- [CHR-20] What still waits of what became waiting in this alert's window.
      select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_waiting
        from private.approvals_waiting(p_household, d.member_id, d.waiting_from, greatest(p_now, d.waiting_from)) w;
      if jsonb_array_length(v_waiting) = 0 then
        v_skip := 'nothing_waiting';
      else
        -- [CHR-20] Something new still waits: the alert counts everything that waits for them now
        -- (D-119), so the newest alert, which replaces the older, is never short.
        select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_waiting
          from private.approvals_waiting(p_household, d.member_id, '-infinity', greatest(p_now, d.waiting_from)) w;
        v_title := private.approvals_line(v_waiting);
        if exists (select from jsonb_array_elements(v_waiting) w where (w ->> 'checkoffs')::integer > 0
                                                                  or (w ->> 'lunches')::integer > 0) then
          v_body := 'Open Today to approve';
          v_url := '/admin/today';
        elsif exists (select from jsonb_array_elements(v_waiting) w where (w ->> 'requests')::integer > 0) then
          v_body := 'Open Rewards to decide';
          v_url := '/admin/rewards';
        else
          -- [MEAL-22] Only grocery asks wait: Groceries' Asked for.
          v_body := 'Open Groceries to decide';
          v_url := '/admin/groceries#asked';
        end if;
        v_tag := 'approval';
      end if;
    elsif v_skip is null then
      -- The digest: what is open for them today, and their overdue tasks.
      select count(*) filter (where oc.due_date = v_today),
             count(*) filter (where oc.due_date < v_today),
             (array_agg(case when c.visibility = 'private' and p.hide_private_titles then 'a private item'
                             else c.title end
                        order by oc.due_date, oc.due_time nulls last, c.title))[1:3]
        into v_open, v_late, v_names
        from public.chore_occurrence oc
        join public.chore_occurrence_assignee a on a.occurrence_id = oc.id and a.member_id = d.member_id
        join public.chore c on c.id = oc.chore_id and c.archived_at is null
       where oc.household_id = p_household and oc.status in ('scheduled', 'rejected')
         and (oc.due_date = v_today or (oc.kind = 'task' and oc.due_date < v_today));
      if v_open + v_late = 0 then
        v_skip := 'nothing_due';
      else
        v_title := 'Your day: ' || v_open || ' to do' || case when v_late > 0 then ', ' || v_late || ' overdue' else '' end;
        v_body := array_to_string(v_names, ', ')
                  || case when v_open + v_late > 3 then ' and ' || (v_open + v_late - 3) || ' more' else '' end;
        v_url := '/admin/my';
      end if;
    end if;

    if v_skip is null and jsonb_array_length(v_devices) = 0 then
      v_skip := 'no_device';
    end if;

    if v_skip is not null then
      update public.reminder_delivery set status = 'skipped', detail = v_skip where id = d.id;
    else
      update public.reminder_delivery set status = 'sent', sent_at = p_now where id = d.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'delivery_id', d.id, 'member_id', d.member_id, 'kind', d.kind,
        'payload', jsonb_build_object('title', v_title, 'body', v_body, 'url', v_url, 'tag', v_tag)
                   || case when d.kind = 'approval' then jsonb_build_object('renotify', true) else '{}'::jsonb end,
        'devices', v_devices));
    end if;
  end loop;
  return v_out;
end $$;

-- [MEAL-22][CHR-20] A grocery ask that starts waiting calls the alert at once, as a lunch change does.
create function private.alert_now_grocery_ask() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then
    perform private.alert_now(new.household_id);
  end if;
  return null;
end $$;
create trigger trg_grocery_ask_alert_now after insert or update of status on public.grocery_ask
  for each row execute function private.alert_now_grocery_ask();

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents and boards read the asks; nobody writes but the
-- functions. Each child's OK is a setting of the member, audited with it.
-- ---------------------------------------------------------------------------------------------
alter table public.grocery_ask enable row level security;
create policy grocery_ask_admin_select on public.grocery_ask for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_ask_device_select on public.grocery_ask for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.grocery_ask from public, anon;
revoke insert, update, delete, truncate on public.grocery_ask from authenticated;
grant select on public.grocery_ask to authenticated;

revoke all on function private.grocery_add_items(uuid, jsonb), private.grocery_last(uuid, text),
  private.grocery_ask_item(public.grocery_ask), private.board_member(uuid), private.board_items(uuid[]),
  private.grocery_set_ticked(uuid, uuid[], boolean, uuid, uuid), private.alert_now_grocery_ask()
  from public, anon, authenticated;
revoke all on function public.ask_groceries(uuid, text, text, uuid, uuid), public.call_off_grocery_ask(uuid),
  public.decide_grocery_asks(uuid[], boolean), public.set_grocery_ask_ok(uuid, boolean),
  public.board_tick_groceries(uuid[], uuid, boolean), public.board_remove_groceries(uuid[], uuid),
  public.board_restore_groceries(uuid[], uuid) from public, anon;
grant execute on function public.ask_groceries(uuid, text, text, uuid, uuid), public.call_off_grocery_ask(uuid),
  public.decide_grocery_asks(uuid[], boolean), public.set_grocery_ask_ok(uuid, boolean),
  public.board_tick_groceries(uuid[], uuid, boolean), public.board_remove_groceries(uuid[], uuid),
  public.board_restore_groceries(uuid[], uuid) to authenticated;

-- The boards follow the asks as they change (apps/web/lib/live.ts listens to them).
alter publication supabase_realtime add table public.grocery_ask;
