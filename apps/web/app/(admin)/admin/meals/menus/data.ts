import type { SupabaseClient } from '@supabase/supabase-js';
import type { MenuItem } from '@/lib/menu/nutrislice';
import type { MenuAdapter, MenuDayRow, MenuSourceRow, MenuStatus } from '@/lib/menus';

/**
 * [MENU-01][MENU-04] The household's school menus, oldest first (RLS): each with how its fetches are
 * going, the children whose lunch comes from it, and its days from `from` to `to`.
 */
export async function loadMenus(
  db: SupabaseClient,
  householdId: string,
  from: string,
  to: string,
): Promise<MenuSourceRow[]> {
  const [sources, days, links] = await Promise.all([
    db
      .from('menu_source')
      .select('id, name, adapter, config, status, last_fetch_at, last_success_at, last_error')
      .eq('household_id', householdId)
      .order('created_at'),
    db
      .from('school_menu_day')
      .select('source_id, menu_date, items, no_service, note, origin, is_override')
      .eq('household_id', householdId)
      .eq('meal_service', 'lunch')
      .gte('menu_date', from)
      .lte('menu_date', to)
      .order('menu_date'),
    db
      .from('member_lunch')
      .select('member_id, menu_source_id')
      .eq('household_id', householdId)
      .not('menu_source_id', 'is', null),
  ]);
  if (sources.error) throw new Error(`menus: ${sources.error.message}`);
  if (days.error) throw new Error(`menu days: ${days.error.message}`);
  if (links.error) throw new Error(`children's menus: ${links.error.message}`);
  return (sources.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    adapter: s.adapter as MenuAdapter,
    config: (s.config ?? {}) as MenuSourceRow['config'],
    status: s.status as MenuStatus,
    lastFetchAt: (s.last_fetch_at as string | null) ?? null,
    lastSuccessAt: (s.last_success_at as string | null) ?? null,
    lastError: (s.last_error as string | null) ?? null,
    childIds: (links.data ?? [])
      .filter((l) => l.menu_source_id === s.id)
      .map((l) => l.member_id as string),
    days: (days.data ?? [])
      .filter((d) => d.source_id === s.id)
      .map((d): MenuDayRow => ({
        date: d.menu_date as string,
        items: (d.items ?? []) as MenuItem[],
        noService: d.no_service as boolean,
        ...(d.note ? { note: d.note as string } : {}),
        origin: d.origin as MenuDayRow['origin'],
        own: d.is_override as boolean,
      })),
  }));
}
