-- [MEAL-15][US-701] Edit on a planned meal (WP-76, D-111). Change offered Earlier, Later and Remove,
-- and nothing changed an entry: a parent removed it and added it again. update_meal_entry() changes
-- one entry in place: its day and meal of the day, the library meal or what was written, its people
-- and its note. The entry keeps its id. In the same day and meal of the day it keeps its place in the
-- order; moved to another, it goes last there, as an added entry does. Its people are replaced.
-- A library meal or a person archived since keeps the entry valid while it stays on it; a new one must
-- be in the library, or in the family, now.

-- p_entry: {id, household_id, plan_date, slot, member_ids (none or empty: everyone), meal_id or
-- free_text, notes}, as add_meal_entry() takes. Returns {id, sort_order}.
create function public.update_meal_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id        uuid;
  v_household uuid;
  v_date      date;
  v_slot      text := p_entry ->> 'slot';
  v_members   uuid[];
  v_meal      uuid;
  v_text      text := nullif(btrim(p_entry ->> 'free_text'), '');
  v_notes     text := nullif(btrim(p_entry ->> 'notes'), '');
  v_order     integer;
  e           public.meal_plan_entry;
begin
  begin
    v_id := (p_entry ->> 'id')::uuid;
    v_household := (p_entry ->> 'household_id')::uuid;
    v_date := (p_entry ->> 'plan_date')::date;
    v_meal := nullif(p_entry ->> 'meal_id', '')::uuid;
    if jsonb_typeof(p_entry -> 'member_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}') into v_members
        from jsonb_array_elements_text(p_entry -> 'member_ids') x;
    elsif p_entry -> 'member_ids' is null or jsonb_typeof(p_entry -> 'member_ids') = 'null' then
      v_members := '{}';
    else
      raise exception 'bad entry' using errcode = '22023', hint = 'bad_request';
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad entry' using errcode = '22023', hint = 'bad_request';
  end;
  perform private.meal_access(v_household);

  select * into e from public.meal_plan_entry where id = v_id for update;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  if e.household_id <> v_household then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_date is null or v_slot is null or v_slot not in ('breakfast', 'snack', 'lunch', 'dinner') then
    raise exception 'a day and a meal' using errcode = '22023', hint = 'bad_request';
  end if;
  if (v_meal is null) = (v_text is null) then
    raise exception 'a meal from the library, or something written in' using errcode = '22023', hint = 'meal_or_text';
  end if;
  if v_meal is not null and v_meal is distinct from e.meal_id
     and not exists (select from public.meal m
                      where m.id = v_meal and m.household_id = v_household and m.archived_at is null) then
    raise exception 'that meal isn''t in the library' using errcode = '22023', hint = 'meal_gone';
  end if;
  if exists (select from unnest(v_members) x (id)
              where not exists (select from public.member m
                                 where m.id = x.id and m.household_id = v_household
                                   and (m.archived_at is null
                                        or exists (select from public.meal_plan_entry_member p
                                                    where p.entry_id = v_id and p.member_id = x.id)))) then
    raise exception 'not one of this family' using errcode = '22023', hint = 'member_gone';
  end if;

  v_order := case
    when e.plan_date = v_date and e.slot = v_slot then e.sort_order
    else coalesce((select max(sort_order) + 1 from public.meal_plan_entry
                    where household_id = v_household and plan_date = v_date and slot = v_slot), 1)
  end;
  update public.meal_plan_entry
     set plan_date = v_date, slot = v_slot, sort_order = v_order,
         meal_id = v_meal, free_text = v_text, notes = v_notes
   where id = v_id;
  delete from public.meal_plan_entry_member where entry_id = v_id and member_id <> all (v_members);
  insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
  select v_household, v_id, x from unnest(v_members) x
  on conflict do nothing;
  return jsonb_build_object('id', v_id, 'sort_order', v_order);
end $$;

revoke all on function public.update_meal_entry(jsonb) from public, anon;
grant execute on function public.update_meal_entry(jsonb) to authenticated;
