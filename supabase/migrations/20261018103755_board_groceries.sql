-- [MEAL-18][MEAL-23] Groceries on the board (WP-104, D-138): the board reads its household's list,
-- read-only, beside its snapshot and as live as it (Realtime on the list's tables, 01 §7).
--   * board_groceries(): the household's categories and stores in its order, its open items with
--     why each is on the list and the amounts they bring, and whether it has ever had an item (the
--     rail shows Groceries from the first one). For a board only; anything else gets null.

create function public.board_groceries() returns jsonb
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'amount', i.amount, 'category_id', i.category_id,
               'store_id', i.store_id, 'created_at', i.created_at,
               'reasons', coalesce((
                 select jsonb_agg(jsonb_build_object('kind', r.kind, 'member_id', r.member_id,
                                                     'label', r.label, 'amount', r.amount,
                                                     'created_at', r.created_at)
                                  order by r.created_at)
                   from public.grocery_item_reason r where r.item_id = i.id), '[]'))
             order by lower(i.name))
        from public.grocery_item i where i.household_id = v_household and i.status = 'open'), '[]'));
end $$;

revoke all on function public.board_groceries() from public, anon;
grant execute on function public.board_groceries() to authenticated;

-- The boards follow the list as it changes (apps/web/lib/live.ts listens to each).
alter publication supabase_realtime add table public.grocery_item, public.grocery_item_reason,
  public.grocery_category, public.grocery_store;
