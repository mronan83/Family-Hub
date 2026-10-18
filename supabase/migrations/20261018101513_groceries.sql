-- [MEAL-18][MEAL-20][MEAL-23][MEAL-24] The grocery list (WP-104, D-138; 02 §3.8): FamilyWise's own
-- list, with or without the Apple Reminders sync (WP-103, later).
--   * `grocery_list`: the household's one list.
--   * `grocery_category`, `grocery_store`: the household's own, in its order. Every household starts
--     with a made-up starter set, Other (which can't be renamed or removed) and six stores.
--   * `grocery_item`: a thing to buy: its name, the key it merges by (MEAL-20: set by the app's one
--     merge, lib/grocery-merge.ts), the admin's own amount, its category and an optional store. Open,
--     ticked (a buy) or removed (not a buy). Never deleted: the history refers to it.
--   * `grocery_item_reason`: why it is on the list, one row per way it came (who added it, which
--     meal, who asked), each with the amount it brought. The amount shown is the item's own amount
--     and its reasons' amounts combined by the app.
--   * `grocery_item_event`: every event (added, merged, changed, ticked, unticked, removed), when and
--     by whom, kept for good (D-138 (2)).
--   * `grocery_learned_word`: the household's own words, taught by every move (MEAL-24).
-- Every write goes through the functions below, as a parent of the household. Boards read the list,
-- its items, reasons, categories and stores, and write nothing.

create table public.grocery_list (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.household (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);

create table public.grocery_category (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  name         text not null check (name = btrim(name) and length(name) between 1 and 40),
  icon         text not null default 'shopping-cart' check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- The starter set's own key (produce, dairy, …), kept through a rename so the starter word list
  -- still finds it; null for a category the household made.
  starter_key  text check (starter_key ~ '^[a-z]{1,20}$'),
  is_other     boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);
create unique index grocery_category_name_key on public.grocery_category (household_id, lower(name));
create unique index grocery_category_other_key on public.grocery_category (household_id) where is_other;

create table public.grocery_store (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  name         text not null check (name = btrim(name) and length(name) between 1 and 40),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);
create unique index grocery_store_name_key on public.grocery_store (household_id, lower(name));

create table public.grocery_item (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  list_id      uuid not null,
  name         text not null check (name = btrim(name) and length(name) between 1 and 80),
  name_key     text not null check (length(name_key) between 1 and 80),
  amount       text check (amount = btrim(amount) and length(amount) between 1 and 40),
  category_id  uuid not null,
  store_id     uuid,
  status       text not null default 'open' check (status in ('open', 'ticked', 'removed')),
  ticked_at    timestamptz,
  ticked_by    uuid,
  removed_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((status = 'ticked') = (ticked_at is not null)),
  unique (household_id, id),
  foreign key (household_id, list_id) references public.grocery_list (household_id, id),
  foreign key (household_id, category_id) references public.grocery_category (household_id, id),
  foreign key (household_id, store_id) references public.grocery_store (household_id, id)
    on delete set null (store_id)
);
-- [MEAL-20] One open item of a thing: two adds of it at once make one item.
create unique index grocery_item_open_key on public.grocery_item (household_id, name_key) where status = 'open';
create index on public.grocery_item (household_id, status, ticked_at);
create index on public.grocery_item (household_id, name_key, created_at);
create trigger trg_grocery_item_updated_at before update on public.grocery_item
  for each row execute function private.set_updated_at();

create table public.grocery_item_reason (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.household (id) on delete cascade,
  item_id            uuid not null,
  kind               text not null check (kind in ('added', 'meal', 'ask', 'staple')),
  by_user            uuid,
  member_id          uuid,
  meal_plan_entry_id uuid,
  -- What it reads as: "Tacos, Tue" for a meal.
  label              text check (label = btrim(label) and length(label) between 1 and 80),
  amount             text check (amount = btrim(amount) and length(amount) between 1 and 40),
  created_at         timestamptz not null default now(),
  foreign key (household_id, item_id) references public.grocery_item (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, meal_plan_entry_id) references public.meal_plan_entry (household_id, id)
    on delete set null (meal_plan_entry_id)
);
create index on public.grocery_item_reason (item_id);
create index on public.grocery_item_reason (meal_plan_entry_id) where meal_plan_entry_id is not null;

create table public.grocery_item_event (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  item_id      uuid not null,
  kind         text not null check (kind in ('added', 'merged', 'changed', 'ticked', 'unticked', 'removed')),
  at           timestamptz not null default now(),
  by_user      uuid,
  detail       jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  foreign key (household_id, item_id) references public.grocery_item (household_id, id)
);
create index on public.grocery_item_event (household_id, item_id, at);

create table public.grocery_learned_word (
  household_id uuid not null references public.household (id) on delete cascade,
  word         text not null check (length(word) between 1 and 80),
  category_id  uuid not null,
  weight       integer not null default 1 check (weight > 0),
  updated_at   timestamptz not null default now(),
  primary key (household_id, word, category_id),
  foreign key (household_id, category_id) references public.grocery_category (household_id, id)
    on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- The starter set: every household has its list, the made-up starter categories, Other and six
-- stores from the start (MEAL-23-c). New households get them as they are made.
-- ---------------------------------------------------------------------------------------------

create function private.grocery_starter(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.grocery_list (household_id) values (p_household) on conflict (household_id) do nothing;
  if not exists (select from public.grocery_category where household_id = p_household) then
    insert into public.grocery_category (household_id, name, icon, starter_key, is_other, sort_order)
    select p_household, c.name, c.icon, c.k, c.k = 'other', c.n
      from (values (1, 'produce', 'Produce', 'carrot'), (2, 'dairy', 'Dairy & Eggs', 'milk'),
                   (3, 'bakery', 'Bakery', 'croissant'), (4, 'meat', 'Meat & Seafood', 'beef'),
                   (5, 'pantry', 'Pantry', 'wheat'), (6, 'frozen', 'Frozen', 'snowflake'),
                   (7, 'snacks', 'Snacks', 'cookie'), (8, 'household', 'Household', 'shopping-bag'),
                   (9, 'other', 'Other', 'package')) c (n, k, name, icon);
  end if;
  if not exists (select from public.grocery_store where household_id = p_household) then
    insert into public.grocery_store (household_id, name, sort_order)
    select p_household, s.name, s.n
      from (values (1, 'Costco'), (2, 'Kroger'), (3, 'Aldi'), (4, 'Walmart'), (5, 'Meijer'),
                   (6, 'Sam''s Club')) s (n, name);
  end if;
end $$;

create function private.grocery_starter_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.grocery_starter(new.id);
  return new;
end $$;
create trigger trg_grocery_starter after insert on public.household
  for each row execute function private.grocery_starter_trigger();

select private.grocery_starter(h.id) from public.household h;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Raises unless the caller is a parent of the household.
create function private.grocery_access(p_household uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null or auth.uid() is null
     or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
end $$;

-- The household of some items, all one household's and the caller's; raises otherwise.
create function private.grocery_items_household(p_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_households uuid[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'no items' using errcode = '22023', hint = 'bad_request';
  end if;
  select array_agg(distinct i.household_id) into v_households from public.grocery_item i where i.id = any (p_ids);
  if v_households is null or cardinality(v_households) <> 1
     or (select count(*) from public.grocery_item i where i.id = any (p_ids)) <> cardinality(array(select distinct unnest(p_ids))) then
    raise exception 'not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.grocery_access(v_households[1]);
  -- One change to a household's list at a time, so a merge never sees half of another.
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || v_households[1], 0));
  return v_households[1];
end $$;

-- A category of the household, or its Other when none is given or it isn't the household's.
create function private.grocery_category_or_other(p_household uuid, p_category uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.id from public.grocery_category c where c.id = p_category and c.household_id = p_household),
    (select c.id from public.grocery_category c where c.household_id = p_household and c.is_other))
$$;

-- [MEAL-24] A move teaches each word of the item's key its new category.
create function private.grocery_learn(p_household uuid, p_key text, p_category uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.grocery_learned_word (household_id, word, category_id)
  select distinct p_household, w, p_category
    from regexp_split_to_table(p_key, '\s+') w
   where w <> ''
  on conflict (household_id, word, category_id)
    do update set weight = public.grocery_learned_word.weight + 1, updated_at = now()
$$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-20] The one way in. Every source adds through here: the admin app, a week's meals
-- (WP-105), and later Apple Reminders (WP-103), a staple (WP-106) and a child's ask (WP-107).
-- ---------------------------------------------------------------------------------------------

-- p_items: [{name, key, amount, category_id, store_id, into_id,
--            reason: {kind, member_id, meal_plan_entry_id, label}}]. `key` is the merge's key for the
-- name (lib/grocery-merge.ts). An item whose key is open on the list joins it (or `into_id`, the
-- open item an admin chose to make it one with): its reason and amount are added, its name,
-- category and store stay. Otherwise a new item, in its category (Other when none) and store.
-- Returns [{id, merged}] in order.
create function public.add_groceries(p_household uuid, p_items jsonb) returns jsonb
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
  v_kind   text;
  v_member uuid;
  v_entry  uuid;
  v_merged boolean;
  v_out    jsonb := '[]';
begin
  perform private.grocery_access(p_household);
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
    if v_store is not null and not exists (select from public.grocery_store s
                                            where s.id = v_store and s.household_id = p_household) then
      v_store := null;
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
      insert into public.grocery_item (household_id, list_id, name, name_key, category_id, store_id, created_by)
      values (p_household, v_list, v_name, v_key,
              private.grocery_category_or_other(p_household, nullif(x ->> 'category_id', '')::uuid),
              v_store, auth.uid())
      returning id into v_item;
    end if;
    insert into public.grocery_item_reason (household_id, item_id, kind, by_user, member_id,
                                            meal_plan_entry_id, label, amount)
    values (p_household, v_item, v_kind, auth.uid(), v_member, v_entry,
            nullif(btrim(r ->> 'label'), ''), v_amount);
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
    values (p_household, v_item, case when v_merged then 'merged' else 'added' end, auth.uid(),
            jsonb_strip_nulls(jsonb_build_object('name', v_name, 'amount', v_amount, 'reason', v_kind,
                                                 'label', nullif(btrim(r ->> 'label'), ''))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_item, 'merged', v_merged));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-18] Tick, untick, remove, edit
-- ---------------------------------------------------------------------------------------------

-- Ticks (a buy) or unticks items. Unticking puts an item back on the list; if the same thing was
-- added again meanwhile, that one is folded into it, so the list still has it once.
create function public.set_groceries_ticked(p_ids uuid[], p_ticked boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(p_ids);
  i           public.grocery_item;
  v_twin      uuid;
  v_n         integer := 0;
begin
  if p_ticked is null then
    raise exception 'tick or untick' using errcode = '22023', hint = 'bad_request';
  end if;
  for i in select * from public.grocery_item where id = any (p_ids) order by name loop
    if p_ticked and i.status = 'open' then
      update public.grocery_item set status = 'ticked', ticked_at = now(), ticked_by = auth.uid() where id = i.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user)
      values (v_household, i.id, 'ticked', auth.uid());
      v_n := v_n + 1;
    elsif not p_ticked and i.status = 'ticked' then
      select t.id into v_twin from public.grocery_item t
       where t.household_id = v_household and t.name_key = i.name_key and t.status = 'open';
      if v_twin is not null then
        update public.grocery_item_reason set item_id = i.id where item_id = v_twin;
        update public.grocery_item set status = 'removed', removed_at = now() where id = v_twin;
        insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
        values (v_household, v_twin, 'merged', auth.uid(), jsonb_build_object('into', i.id));
      end if;
      update public.grocery_item set status = 'open', ticked_at = null, ticked_by = null where id = i.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user)
      values (v_household, i.id, 'unticked', auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Takes items off the list without a buy.
create function public.remove_groceries(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(p_ids);
  v_n         integer;
begin
  with gone as (
    update public.grocery_item set status = 'removed', removed_at = now()
     where id = any (p_ids) and status = 'open'
    returning id)
  insert into public.grocery_item_event (household_id, item_id, kind, by_user)
  select v_household, id, 'removed', auth.uid() from gone;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Edit: an open item's name (and so its key) and its amount. The amount typed is what to buy now:
-- it replaces the reasons' amounts. A name that is another open item's says so.
create function public.update_grocery_item(p_id uuid, p_name text, p_key text, p_amount text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(array[p_id]);
  i           public.grocery_item;
  v_name      text := nullif(btrim(p_name), '');
  v_key       text := nullif(btrim(p_key), '');
  v_amount    text := nullif(btrim(p_amount), '');
begin
  select * into i from public.grocery_item where id = p_id;
  if i.status <> 'open' then
    raise exception 'not on the list' using errcode = '22023', hint = 'not_open';
  end if;
  if v_name is null or v_key is null then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  if exists (select from public.grocery_item t where t.household_id = v_household and t.status = 'open'
                and t.name_key = v_key and t.id <> p_id) then
    raise exception 'already on the list' using errcode = '23505', hint = 'already_on_list';
  end if;
  update public.grocery_item set name = v_name, name_key = v_key, amount = v_amount where id = p_id;
  update public.grocery_item_reason set amount = null where item_id = p_id and amount is not null;
  insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
  values (v_household, p_id, 'changed', auth.uid(),
          jsonb_strip_nulls(jsonb_build_object('name', v_name, 'amount', v_amount,
                                               'was', jsonb_build_object('name', i.name))));
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-23][MEAL-24] Move several to a category (teaching their words), set their store
-- ---------------------------------------------------------------------------------------------

create function public.move_groceries(p_ids uuid[], p_category uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(p_ids);
  i           public.grocery_item;
  v_n         integer := 0;
begin
  if not exists (select from public.grocery_category c where c.id = p_category and c.household_id = v_household) then
    raise exception 'not one of this family''s categories' using errcode = '22023', hint = 'category_gone';
  end if;
  for i in select * from public.grocery_item where id = any (p_ids) loop
    perform private.grocery_learn(v_household, i.name_key, p_category);
    if i.category_id <> p_category then
      update public.grocery_item set category_id = p_category where id = i.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
      values (v_household, i.id, 'changed', auth.uid(),
              jsonb_build_object('category', p_category, 'was', jsonb_build_object('category', i.category_id)));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- p_store null: any store.
create function public.set_groceries_store(p_ids uuid[], p_store uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(p_ids);
  v_n         integer;
begin
  if p_store is not null and not exists (select from public.grocery_store s
                                          where s.id = p_store and s.household_id = v_household) then
    raise exception 'not one of this family''s stores' using errcode = '22023', hint = 'store_gone';
  end if;
  with changed as (
    update public.grocery_item set store_id = p_store
     where id = any (p_ids) and store_id is distinct from p_store
    returning id)
  insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
  select v_household, id, 'changed', auth.uid(), jsonb_build_object('store', p_store) from changed;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- [MEAL-23] The household's categories and stores: add, rename, order, remove
-- ---------------------------------------------------------------------------------------------

-- p_kind 'category' or 'store'. Added last.
create function public.add_grocery_place(p_household uuid, p_kind text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_id   uuid;
begin
  perform private.grocery_access(p_household);
  if v_name is null or length(v_name) > 40 or p_kind not in ('category', 'store') then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  begin
    if p_kind = 'category' then
      insert into public.grocery_category (household_id, name, sort_order)
      values (p_household, v_name,
              coalesce((select max(sort_order) + 1 from public.grocery_category
                         where household_id = p_household and not is_other), 1))
      returning id into v_id;
    else
      insert into public.grocery_store (household_id, name, sort_order)
      values (p_household, v_name,
              coalesce((select max(sort_order) + 1 from public.grocery_store where household_id = p_household), 1))
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'that name is taken' using errcode = '23505', hint = 'name_taken';
  end;
  return v_id;
end $$;

-- The household of a category or store, checked as the caller's; raises otherwise.
create function private.grocery_place_household(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  if p_kind = 'category' then
    select household_id into v_household from public.grocery_category where id = p_id;
  elsif p_kind = 'store' then
    select household_id into v_household from public.grocery_store where id = p_id;
  end if;
  if v_household is null then
    raise exception 'not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.grocery_access(v_household);
  return v_household;
end $$;

create function public.rename_grocery_place(p_kind text, p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_place_household(p_kind, p_id);
  v_name      text := nullif(btrim(p_name), '');
begin
  if v_name is null or length(v_name) > 40 then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  begin
    if p_kind = 'category' then
      if exists (select from public.grocery_category where id = p_id and is_other) then
        raise exception 'Other stays Other' using errcode = '22023', hint = 'other_fixed';
      end if;
      update public.grocery_category set name = v_name where id = p_id;
    else
      update public.grocery_store set name = v_name where id = p_id;
    end if;
  exception when unique_violation then
    raise exception 'that name is taken' using errcode = '23505', hint = 'name_taken';
  end;
end $$;

-- One place earlier (-1) or later (+1). Other stays last.
create function public.move_grocery_place(p_kind text, p_id uuid, p_step integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_place_household(p_kind, p_id);
  v_ids       uuid[];
  v_at        integer;
  v_to        integer;
begin
  if p_step not in (-1, 1) then
    raise exception 'one place earlier or later' using errcode = '22023', hint = 'bad_request';
  end if;
  if p_kind = 'category' then
    select array_agg(c.id order by c.sort_order, c.created_at, c.id) into v_ids
      from public.grocery_category c where c.household_id = v_household and not c.is_other;
  else
    select array_agg(s.id order by s.sort_order, s.created_at, s.id) into v_ids
      from public.grocery_store s where s.household_id = v_household;
  end if;
  v_at := array_position(v_ids, p_id);
  if v_at is null then
    raise exception 'Other stays last' using errcode = '22023', hint = 'other_fixed';
  end if;
  v_to := least(greatest(v_at + p_step, 1), cardinality(v_ids));
  v_ids[v_at] := v_ids[v_to];
  v_ids[v_to] := p_id;
  if p_kind = 'category' then
    update public.grocery_category c set sort_order = o.n from unnest(v_ids) with ordinality o (id, n)
     where c.id = o.id and c.sort_order is distinct from o.n::integer;
  else
    update public.grocery_store s set sort_order = o.n from unnest(v_ids) with ordinality o (id, n)
     where s.id = o.id and s.sort_order is distinct from o.n::integer;
  end if;
  return v_to;
end $$;

-- Removes a category, its items (open, ticked or removed) moved to Other; or a store, its items left
-- with no store. Returns how many items were open in it. Other can't be removed.
create function public.remove_grocery_place(p_kind text, p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_place_household(p_kind, p_id);
  v_other     uuid;
  v_n         integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || v_household, 0));
  if p_kind = 'category' then
    select id into v_other from public.grocery_category where household_id = v_household and is_other;
    if v_other = p_id then
      raise exception 'Other stays' using errcode = '22023', hint = 'other_fixed';
    end if;
    select count(*) into v_n from public.grocery_item where category_id = p_id and status = 'open';
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
    select v_household, i.id, 'changed', auth.uid(),
           jsonb_build_object('category', v_other, 'was', jsonb_build_object('category', p_id), 'why', 'category removed')
      from public.grocery_item i where i.category_id = p_id and i.status = 'open';
    update public.grocery_item set category_id = v_other where category_id = p_id;
    delete from public.grocery_category where id = p_id;
  else
    select count(*) into v_n from public.grocery_item where store_id = p_id and status = 'open';
    delete from public.grocery_store where id = p_id;
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents and boards read; nobody writes but the functions.
-- ---------------------------------------------------------------------------------------------

alter table public.grocery_list enable row level security;
alter table public.grocery_category enable row level security;
alter table public.grocery_store enable row level security;
alter table public.grocery_item enable row level security;
alter table public.grocery_item_reason enable row level security;
alter table public.grocery_item_event enable row level security;
alter table public.grocery_learned_word enable row level security;

create policy grocery_list_admin_select on public.grocery_list for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_list_device_select on public.grocery_list for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy grocery_category_admin_select on public.grocery_category for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_category_device_select on public.grocery_category for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy grocery_store_admin_select on public.grocery_store for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_store_device_select on public.grocery_store for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy grocery_item_admin_select on public.grocery_item for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_item_device_select on public.grocery_item for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy grocery_item_reason_admin_select on public.grocery_item_reason for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_item_reason_device_select on public.grocery_item_reason for select to authenticated
  using (household_id = (select private.device_household_id()));
create policy grocery_item_event_admin_select on public.grocery_item_event for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_learned_word_admin_select on public.grocery_learned_word for select to authenticated
  using (household_id in (select private.admin_household_ids()));

revoke all on public.grocery_list, public.grocery_category, public.grocery_store, public.grocery_item,
  public.grocery_item_reason, public.grocery_item_event, public.grocery_learned_word from public, anon;
revoke insert, update, delete, truncate on public.grocery_list, public.grocery_category, public.grocery_store,
  public.grocery_item, public.grocery_item_reason, public.grocery_item_event, public.grocery_learned_word
  from authenticated;
grant select on public.grocery_list, public.grocery_category, public.grocery_store, public.grocery_item,
  public.grocery_item_reason, public.grocery_item_event, public.grocery_learned_word to authenticated;

-- The categories and stores are settings: audited like any other.
create trigger trg_audit after insert or update or delete on public.grocery_category
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.grocery_store
  for each row execute function private.audit_row();

revoke all on function private.grocery_starter(uuid), private.grocery_starter_trigger(),
  private.grocery_access(uuid), private.grocery_items_household(uuid[]),
  private.grocery_category_or_other(uuid, uuid), private.grocery_learn(uuid, text, uuid),
  private.grocery_place_household(text, uuid) from public, anon, authenticated;
revoke all on function public.add_groceries(uuid, jsonb), public.set_groceries_ticked(uuid[], boolean),
  public.remove_groceries(uuid[]), public.update_grocery_item(uuid, text, text, text),
  public.move_groceries(uuid[], uuid), public.set_groceries_store(uuid[], uuid),
  public.add_grocery_place(uuid, text, text), public.rename_grocery_place(text, uuid, text),
  public.move_grocery_place(text, uuid, integer), public.remove_grocery_place(text, uuid) from public, anon;
grant execute on function public.add_groceries(uuid, jsonb), public.set_groceries_ticked(uuid[], boolean),
  public.remove_groceries(uuid[]), public.update_grocery_item(uuid, text, text, text),
  public.move_groceries(uuid[], uuid), public.set_groceries_store(uuid[], uuid),
  public.add_grocery_place(uuid, text, text), public.rename_grocery_place(text, uuid, text),
  public.move_grocery_place(text, uuid, integer), public.remove_grocery_place(text, uuid) to authenticated;
