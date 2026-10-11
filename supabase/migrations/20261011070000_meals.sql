-- [MEAL-01][MEAL-02][MEAL-03][MEAL-08] Meals (WP-25, D-77; 02 §3.6): the family's meal library and
-- the week's plan.
--   * `meal`: a dish the family makes again (name, what it's good for, an icon, a recipe link). The
--     household's parents add and change them through RLS; a meal is archived, never deleted, so a
--     plan that used it keeps its name. Ingredients are carried for the grocery list later (MEAL-07).
--   * `meal_plan_entry`: one thing in one slot (breakfast, snack, lunch, dinner) on one day, from the
--     library or written in, for everyone or one person, in order within its slot. Added, moved and
--     copied through the functions below; removed by a parent through RLS.
--   * copy_meal_week() copies a week's plan to another week: a slot that already has something is
--     skipped, or replaced (the parent's choice); slots the source week leaves empty are untouched.
-- The boards read both (the board's meals, WP-28).

create table public.meal (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  name         text not null check (name = btrim(name) and length(name) between 1 and 80),
  description  text check (description = btrim(description) and length(description) between 1 and 300),
  icon         text not null default 'utensils' check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- What it's good for; none means anything. Offered first for those slots.
  meal_types   text[] not null default '{}'
                 check (meal_types <@ array['breakfast', 'snack', 'lunch', 'dinner']::text[]),
  recipe_url   text check (recipe_url ~ '^https?://[^[:space:]]+$' and length(recipe_url) <= 500),
  ingredients  jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),  -- MEAL-07, later
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, id)
);
-- One meal of a name at a time (archived ones aside), whatever its capitals.
create unique index meal_name_key on public.meal (household_id, lower(name)) where archived_at is null;
create trigger trg_meal_updated_at before update on public.meal
  for each row execute function private.set_updated_at();

create table public.meal_plan_entry (
  id           uuid primary key,              -- made by the form: adding twice is one entry
  household_id uuid not null references public.household (id) on delete cascade,
  plan_date    date not null,
  slot         text not null check (slot in ('breakfast', 'snack', 'lunch', 'dinner')),
  sort_order   integer not null default 0,
  member_id    uuid,                          -- null: everyone
  meal_id      uuid,                          -- from the library, or
  free_text    text check (free_text = btrim(free_text) and length(free_text) between 1 and 80),
  notes        text check (notes = btrim(notes) and length(notes) between 1 and 200),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  check ((meal_id is null) <> (free_text is null)),
  unique (household_id, id),
  foreign key (household_id, member_id) references public.member (household_id, id),
  foreign key (household_id, meal_id) references public.meal (household_id, id)
);
create index on public.meal_plan_entry (household_id, plan_date, slot, sort_order);
create index on public.meal_plan_entry (meal_id) where meal_id is not null;

-- ---------------------------------------------------------------------------------------------
-- The plan: add, move, copy a week
-- ---------------------------------------------------------------------------------------------

-- Raises unless the caller is a parent of the household.
create function private.meal_access(p_household uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null or auth.uid() is null
     or p_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
end $$;

-- [MEAL-01][MEAL-02][MEAL-08] A parent adds one thing to a slot, last in it. p_entry: {id, household_id,
-- plan_date, slot, member_id (null: everyone), meal_id or free_text, notes}. The same id again is the
-- same entry (a form sent twice adds one). A meal is the household's and not archived; a person is
-- the household's and not archived.
create function public.add_meal_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_household uuid;
  v_date      date;
  v_slot      text := p_entry ->> 'slot';
  v_member    uuid;
  v_meal      uuid;
  v_text      text := nullif(btrim(p_entry ->> 'free_text'), '');
  v_notes     text := nullif(btrim(p_entry ->> 'notes'), '');
  e           public.meal_plan_entry;
begin
  begin
    v_id := (p_entry ->> 'id')::uuid;
    v_household := (p_entry ->> 'household_id')::uuid;
    v_date := (p_entry ->> 'plan_date')::date;
    v_member := nullif(p_entry ->> 'member_id', '')::uuid;
    v_meal := nullif(p_entry ->> 'meal_id', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad entry' using errcode = '22023', hint = 'bad_request';
  end;
  perform private.meal_access(v_household);
  if v_id is null or v_date is null or v_slot is null or v_slot not in ('breakfast', 'snack', 'lunch', 'dinner') then
    raise exception 'a day and a meal' using errcode = '22023', hint = 'bad_request';
  end if;
  if (v_meal is null) = (v_text is null) then
    raise exception 'a meal from the library, or something written in' using errcode = '22023', hint = 'meal_or_text';
  end if;

  select * into e from public.meal_plan_entry where id = v_id;
  if found then
    if e.household_id <> v_household then
      raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
    end if;
    return jsonb_build_object('id', e.id, 'duplicate', true);
  end if;
  if v_meal is not null and not exists (select from public.meal m
                                         where m.id = v_meal and m.household_id = v_household
                                           and m.archived_at is null) then
    raise exception 'that meal isn''t in the library' using errcode = '22023', hint = 'meal_gone';
  end if;
  if v_member is not null and not exists (select from public.member m
                                           where m.id = v_member and m.household_id = v_household
                                             and m.archived_at is null) then
    raise exception 'not one of this family' using errcode = '22023', hint = 'member_gone';
  end if;

  insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, member_id, meal_id,
                                      free_text, notes, created_by)
  values (v_id, v_household, v_date, v_slot,
          coalesce((select max(sort_order) + 1 from public.meal_plan_entry
                     where household_id = v_household and plan_date = v_date and slot = v_slot), 1),
          v_member, v_meal, v_text, v_notes, auth.uid())
  on conflict (id) do nothing;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- [MEAL-08] Moves an entry one place earlier (p_step -1) or later (+1) in its slot. The slot's order
-- is written afresh (1, 2, 3 …), so moving is the same whatever the order was. At either end it
-- stays. Returns its place (1-based).
create function public.move_meal_entry(p_id uuid, p_step integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  e      public.meal_plan_entry;
  v_ids  uuid[];
  v_at   integer;
  v_to   integer;
begin
  select * into e from public.meal_plan_entry where id = p_id;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform private.meal_access(e.household_id);
  if p_step not in (-1, 1) then
    raise exception 'one place earlier or later' using errcode = '22023', hint = 'bad_request';
  end if;
  select array_agg(x.id order by x.sort_order, x.created_at, x.id) into v_ids
    from public.meal_plan_entry x
   where x.household_id = e.household_id and x.plan_date = e.plan_date and x.slot = e.slot;
  v_at := array_position(v_ids, p_id);
  v_to := least(greatest(v_at + p_step, 1), cardinality(v_ids));
  v_ids[v_at] := v_ids[v_to];
  v_ids[v_to] := p_id;
  update public.meal_plan_entry x set sort_order = o.n
    from unnest(v_ids) with ordinality o (id, n)
   where x.id = o.id and x.sort_order is distinct from o.n::integer;
  return v_to;
end $$;

-- [MEAL-03][US-702] Copies the week of 7 days from p_from to the week from p_to (any days, though the
-- app sends the starts of household weeks). For each day and slot the source has something in:
-- 'skip' leaves a destination slot that already has something alone; 'overwrite' replaces what is
-- there. Slots the source leaves empty are untouched. The copies are new entries (they change on
-- their own), in the same order, for the same people. Returns {copied, skipped, replaced} (entries
-- copied; slots skipped; slots replaced).
create function public.copy_meal_week(p_household uuid, p_from date, p_to date, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_shift    integer := p_to - p_from;
  v_copied   integer := 0;
  v_skipped  integer := 0;
  v_replaced integer := 0;
  s          record;
  v_n        integer;
begin
  perform private.meal_access(p_household);
  if p_from is null or p_to is null or p_mode is null or p_mode not in ('skip', 'overwrite') then
    raise exception 'two weeks, and skip or overwrite' using errcode = '22023', hint = 'bad_request';
  end if;
  if p_from = p_to then
    raise exception 'a week onto itself' using errcode = '22023', hint = 'same_week';
  end if;
  -- One copy at a time per household, so two at once don't both fill a slot.
  perform pg_advisory_xact_lock(hashtextextended('copy_meal_week:' || p_household, 0));

  for s in select distinct e.plan_date, e.slot
             from public.meal_plan_entry e
            where e.household_id = p_household and e.plan_date between p_from and p_from + 6
            order by e.plan_date, e.slot loop
    if exists (select from public.meal_plan_entry d
                where d.household_id = p_household and d.plan_date = s.plan_date + v_shift and d.slot = s.slot) then
      if p_mode = 'skip' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      delete from public.meal_plan_entry d
       where d.household_id = p_household and d.plan_date = s.plan_date + v_shift and d.slot = s.slot;
      v_replaced := v_replaced + 1;
    end if;
    insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, member_id, meal_id,
                                        free_text, notes, created_by)
    select gen_random_uuid(), p_household, e.plan_date + v_shift, e.slot,
           row_number() over (order by e.sort_order, e.created_at, e.id), e.member_id, e.meal_id, e.free_text,
           e.notes, auth.uid()
      from public.meal_plan_entry e
     where e.household_id = p_household and e.plan_date = s.plan_date and e.slot = s.slot;
    get diagnostics v_n = row_count;
    v_copied := v_copied + v_n;
  end loop;
  return jsonb_build_object('copied', v_copied, 'skipped', v_skipped, 'replaced', v_replaced);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row level security: the household's parents read and write the library (no deletes: archive) and
-- read and remove plan entries; its boards read both.
-- ---------------------------------------------------------------------------------------------

alter table public.meal enable row level security;
alter table public.meal_plan_entry enable row level security;

create policy meal_admin_select on public.meal for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_admin_insert on public.meal for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy meal_admin_update on public.meal for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy meal_device_select on public.meal for select to authenticated
  using (household_id = (select private.device_household_id()));

create policy meal_plan_entry_admin_select on public.meal_plan_entry for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_plan_entry_admin_delete on public.meal_plan_entry for delete to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_plan_entry_device_select on public.meal_plan_entry for select to authenticated
  using (household_id = (select private.device_household_id()));

revoke all on public.meal, public.meal_plan_entry from public, anon;
revoke delete, truncate on public.meal from authenticated;
revoke insert, update, truncate on public.meal_plan_entry from authenticated;
grant select, insert, update on public.meal to authenticated;
grant select, delete on public.meal_plan_entry to authenticated;

-- A parent's changes are audited like any other setting.
create trigger trg_audit after insert or update or delete on public.meal
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.meal_plan_entry
  for each row execute function private.audit_row();

revoke all on function private.meal_access(uuid) from public, anon, authenticated;
revoke all on function public.add_meal_entry(jsonb), public.move_meal_entry(uuid, integer),
  public.copy_meal_week(uuid, date, date, text) from public, anon;
grant execute on function public.add_meal_entry(jsonb), public.move_meal_entry(uuid, integer),
  public.copy_meal_week(uuid, date, date, text) to authenticated;
