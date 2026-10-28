-- [MEAL-29] Grocery brands (WP-116, D-148; 02 §3.8): the household's own list of brands, an item's
-- brand, and the brand it had last time (read by the app from the items, as the store, D-142).
--   * `grocery_brand`: a brand of the household, one per name ignoring case and spacing (`name_key`,
--     as the app's brandKey()); archived ones stay on the items that have them and are never offered.
--   * `grocery_item.brand_id`: an item's brand, or none.
-- Every write goes through the functions below, as a parent of the household (grocery_access()).
-- The household's parents and boards read the brands; the boards follow them by Realtime.

create table public.grocery_brand (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  name         text not null check (name = btrim(name) and length(name) between 1 and 40),
  name_key     text not null generated always as
                 (lower(regexp_replace(normalize(name, NFKC), '\s+', '', 'g'))) stored,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (household_id, id)
);
create unique index grocery_brand_name_key on public.grocery_brand (household_id, name_key);

alter table public.grocery_item add column brand_id uuid;
alter table public.grocery_item add constraint grocery_item_brand_fkey
  foreign key (household_id, brand_id) references public.grocery_brand (household_id, id)
  on delete set null (brand_id);
create index on public.grocery_item (brand_id) where brand_id is not null;

-- A brand name as typed: spaces trimmed and runs of them one; null when nothing is left.
create function private.grocery_brand_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '')
$$;

-- [MEAL-29] The household's brand by that name, ignoring case and spacing (an archived one comes
-- back), else a new one saved to its brands; null for no name. The caller checks access.
create function private.grocery_brand_for(p_household uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := private.grocery_brand_name(p_name);
  v_id   uuid;
begin
  if v_name is null then
    return null;
  end if;
  if length(v_name) > 40 then
    raise exception 'a brand under 40 letters' using errcode = '22023', hint = 'bad_request';
  end if;
  insert into public.grocery_brand (household_id, name) values (p_household, v_name)
  on conflict (household_id, name_key) do update set archived_at = null
  returning id into v_id;
  return v_id;
end $$;

-- The household of a brand, checked as the caller's; raises otherwise. One change at a time.
create function private.grocery_brand_household(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.grocery_brand where id = p_id;
  if v_household is null then
    raise exception 'not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.grocery_access(v_household);
  perform pg_advisory_xact_lock(hashtextextended('groceries:' || v_household, 0));
  return v_household;
end $$;

-- [MEAL-29] Adds a brand from the Brands list. One by that name already among them is refused;
-- an archived one is brought back.
create function public.add_grocery_brand(p_household uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := private.grocery_brand_name(p_name);
begin
  perform private.grocery_access(p_household);
  if v_name is null then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  if exists (select from public.grocery_brand
              where household_id = p_household and archived_at is null
                and name_key = lower(regexp_replace(normalize(v_name, NFKC), '\s+', '', 'g'))) then
    raise exception 'that brand is there already' using errcode = '23505', hint = 'brand_taken';
  end if;
  return private.grocery_brand_for(p_household, v_name);
end $$;

-- [MEAL-29] Renames a brand; another brand's name (ignoring case and spacing) is refused (D-148).
create function public.rename_grocery_brand(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_brand_household(p_id);
  v_name      text := private.grocery_brand_name(p_name);
begin
  if v_name is null or length(v_name) > 40 then
    raise exception 'a name' using errcode = '22023', hint = 'bad_request';
  end if;
  begin
    update public.grocery_brand set name = v_name where id = p_id;
  exception when unique_violation then
    raise exception 'that brand is there already' using errcode = '23505', hint = 'brand_taken';
  end;
end $$;

-- [MEAL-29] Archives a brand (kept on its items, never offered) or brings it back. Returns its name.
create function public.archive_grocery_brand(p_id uuid, p_archived boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_brand_household(p_id);
  v_name      text;
begin
  if p_archived is null then
    raise exception 'archive or restore' using errcode = '22023', hint = 'bad_request';
  end if;
  update public.grocery_brand
     set archived_at = case when p_archived then coalesce(archived_at, now()) end
   where id = p_id
  returning name into v_name;
  return v_name;
end $$;

-- [MEAL-29] Merges one brand into another of the household's (D-148): every item with it, open,
-- ticked or removed, gets the brand kept, so the memory of last time's brand moves too; the merged
-- one is removed. Returns the kept brand's name.
create function public.merge_grocery_brands(p_from uuid, p_into uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_brand_household(p_from);
  v_name      text;
begin
  if p_into is null or p_into = p_from then
    raise exception 'merge into another brand' using errcode = '22023', hint = 'bad_request';
  end if;
  select name into v_name from public.grocery_brand
   where id = p_into and household_id = v_household and archived_at is null;
  if v_name is null then
    raise exception 'not one of this family''s brands' using errcode = '22023', hint = 'brand_gone';
  end if;
  insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
  select v_household, i.id, 'changed', auth.uid(),
         jsonb_build_object('brand', p_into, 'was', jsonb_build_object('brand', p_from), 'why', 'brands merged')
    from public.grocery_item i where i.brand_id = p_from and i.status = 'open';
  update public.grocery_item set brand_id = p_into where brand_id = p_from;
  delete from public.grocery_brand where id = p_from;
  return v_name;
end $$;

-- [MEAL-29] An item's Brand… (or several's): a brand of the household's by name, found ignoring case
-- and spacing or saved to its brands; null or empty for no brand.
create function public.set_groceries_brand(p_ids uuid[], p_brand text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := private.grocery_items_household(p_ids);
  v_brand     uuid := private.grocery_brand_for(v_household, p_brand);
  v_n         integer;
begin
  with changed as (
    update public.grocery_item set brand_id = v_brand
     where id = any (p_ids) and brand_id is distinct from v_brand
    returning id)
  insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
  select v_household, id, 'changed', auth.uid(), jsonb_build_object('brand', v_brand) from changed;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- [MEAL-20][MEAL-29] The one way in, as WP-104 made it, with each item's brand: `brand_id` (one of
-- the household's) or `brand` (a name, found or saved).
create or replace function public.add_groceries(p_household uuid, p_items jsonb) returns jsonb
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
    if v_store is not null and not exists (select from public.grocery_store s
                                            where s.id = v_store and s.household_id = p_household) then
      v_store := null;
    end if;

    -- [MEAL-29] The brand: one of the household's by id (an archived one comes back), else by name,
    -- found ignoring case and spacing or saved to its brands; none when neither is given.
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
      -- [MEAL-29] One open item per name stays: adding it again with another brand changes its brand;
      -- an add with no brand keeps the one it has (D-148).
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
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
    values (p_household, v_item, case when v_merged then 'merged' else 'added' end, auth.uid(),
            jsonb_strip_nulls(jsonb_build_object('name', v_name, 'amount', v_amount, 'reason', v_kind,
                                                 'label', nullif(btrim(r ->> 'label'), ''))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_item, 'merged', v_merged));
  end loop;
  return v_out;
end $$;

-- [MEAL-18][MEAL-29] The board's read, as WP-104 made it, with the brands and each item's brand.
create or replace function public.board_groceries() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_household uuid := private.device_household_id();
begin
  if v_household is null then
    return null;
  end if;
  return jsonb_build_object(
    'ever', exists (select from public.grocery_item i where i.household_id = v_household),
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
        from public.grocery_item i where i.household_id = v_household and i.status = 'open'), '[]'));
end $$;

-- Row level security: the household's parents and boards read; nobody writes but the functions.
alter table public.grocery_brand enable row level security;
create policy grocery_brand_admin_select on public.grocery_brand for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy grocery_brand_device_select on public.grocery_brand for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.grocery_brand from public, anon;
revoke insert, update, delete, truncate on public.grocery_brand from authenticated;
grant select on public.grocery_brand to authenticated;

-- A setting, audited like the categories and stores.
create trigger trg_audit after insert or update or delete on public.grocery_brand
  for each row execute function private.audit_row();

revoke all on function private.grocery_brand_name(text), private.grocery_brand_for(uuid, text),
  private.grocery_brand_household(uuid) from public, anon, authenticated;
revoke all on function public.add_grocery_brand(uuid, text), public.rename_grocery_brand(uuid, text),
  public.archive_grocery_brand(uuid, boolean), public.merge_grocery_brands(uuid, uuid),
  public.set_groceries_brand(uuid[], text) from public, anon;
grant execute on function public.add_grocery_brand(uuid, text), public.rename_grocery_brand(uuid, text),
  public.archive_grocery_brand(uuid, boolean), public.merge_grocery_brands(uuid, uuid),
  public.set_groceries_brand(uuid[], text) to authenticated;

-- The boards follow a brand's rename (apps/web/lib/live.ts listens to it).
alter publication supabase_realtime add table public.grocery_brand;
