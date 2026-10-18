-- [MEAL-19] A meal taken off the plan takes its share off the grocery list (WP-105, D-138 (6), Q8).
-- When a plan entry is removed (a parent's remove, or a week copied over it) or changed to another
-- meal or to something written in, each open item it put on the list loses that meal's reason and
-- the amount it brought; an item only it needed is removed (not a buy). A ticked item is history and
-- is left as it is: its reason just no longer points at the entry. Each change is in the item's
-- history.

create function private.take_meal_share(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in select distinct i.id, i.household_id
             from public.grocery_item_reason x join public.grocery_item i on i.id = x.item_id
            where x.meal_plan_entry_id = p_entry and i.status = 'open' loop
    insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
    select r.household_id, r.id, 'changed', auth.uid(),
           jsonb_strip_nulls(jsonb_build_object('why', 'meal off the plan', 'label', min(x.label),
                                                'amount', string_agg(x.amount, ' + ')))
      from public.grocery_item_reason x where x.item_id = r.id and x.meal_plan_entry_id = p_entry;
    delete from public.grocery_item_reason where item_id = r.id and meal_plan_entry_id = p_entry;
    if not exists (select from public.grocery_item_reason where item_id = r.id) then
      update public.grocery_item set status = 'removed', removed_at = now() where id = r.id;
      insert into public.grocery_item_event (household_id, item_id, kind, by_user, detail)
      values (r.household_id, r.id, 'removed', auth.uid(), '{"why": "meal off the plan"}');
    end if;
  end loop;
end $$;

create function private.meal_off_plan_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A household being deleted takes its list with it: nothing to take off.
  if not exists (select from public.household h where h.id = old.household_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    perform private.take_meal_share(old.id);
    return old;
  end if;
  if new.meal_id is distinct from old.meal_id then
    perform private.take_meal_share(old.id);
  end if;
  return new;
end $$;

create trigger trg_meal_off_plan_delete before delete on public.meal_plan_entry
  for each row execute function private.meal_off_plan_trigger();
create trigger trg_meal_off_plan_change after update of meal_id on public.meal_plan_entry
  for each row execute function private.meal_off_plan_trigger();

revoke all on function private.take_meal_share(uuid), private.meal_off_plan_trigger()
  from public, anon, authenticated;
