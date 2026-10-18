-- [MEAL-28] The household's preferred store (WP-112, D-142; 02 §3.8): Groceries → Categories and
-- stores → New items go to. A new item takes it; one had before keeps the store it had last time
-- (the app's suggestion, lib/groceries.ts). Null is Any store, the start. Set only through
-- set_grocery_preferred_store(), as a parent of the household; removing the store clears it, by the
-- foreign key. RLS is unchanged: grocery_list's policies already let the household's parents and
-- boards read it, and nobody writes it but the functions.

alter table public.grocery_list add column preferred_store_id uuid;
alter table public.grocery_list add constraint grocery_list_preferred_store_fkey
  foreign key (household_id, preferred_store_id) references public.grocery_store (household_id, id)
  on delete set null (preferred_store_id);

-- p_store null for Any store. A store of another household is refused.
create function public.set_grocery_preferred_store(p_household uuid, p_store uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.grocery_access(p_household);
  if p_store is not null and not exists (select from public.grocery_store
                                          where id = p_store and household_id = p_household) then
    raise exception 'not this family''s store' using errcode = '22023', hint = 'bad_request';
  end if;
  update public.grocery_list set preferred_store_id = p_store where household_id = p_household;
end $$;

revoke all on function public.set_grocery_preferred_store(uuid, uuid) from public, anon;
grant execute on function public.set_grocery_preferred_store(uuid, uuid) to authenticated;

-- A setting, audited like the categories and stores.
create trigger trg_audit after update on public.grocery_list
  for each row execute function private.audit_row();
