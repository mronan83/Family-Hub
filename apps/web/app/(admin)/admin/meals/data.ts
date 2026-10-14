import type { SupabaseClient } from '@supabase/supabase-js';
import { type LunchChild, lunchFromDb } from '@/lib/lunch';
import type { MealRow, PlanEntry, Slot } from '@/lib/meals';

// Meals (WP-25), read through RLS as the parent: the library, and a week's plan.

/** [MEAL-02] The household's meals, by name; archived ones too (a plan may still name them). */
export async function loadMeals(db: SupabaseClient, householdId: string): Promise<MealRow[]> {
  const { data, error } = await db
    .from('meal')
    .select('id, name, description, icon, meal_types, recipe_url, archived_at')
    .eq('household_id', householdId)
    .order('name');
  if (error) throw new Error(`meals: ${error.message}`);
  return (
    data as {
      id: string;
      name: string;
      description: string | null;
      icon: string;
      meal_types: Slot[];
      recipe_url: string | null;
      archived_at: string | null;
    }[]
  ).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon,
    mealTypes: m.meal_types,
    recipeUrl: m.recipe_url,
    archivedAt: m.archived_at,
  }));
}

/** [MEAL-01][MEAL-10] The plan from `from` to `to` (dates, inclusive), each entry with its people. */
export async function loadPlan(
  db: SupabaseClient,
  householdId: string,
  from: string,
  to: string,
): Promise<PlanEntry[]> {
  const { data, error } = await db
    .from('meal_plan_entry')
    .select(
      'id, plan_date, slot, sort_order, meal_id, free_text, notes, meal_plan_entry_member(member_id)',
    )
    .eq('household_id', householdId)
    .gte('plan_date', from)
    .lte('plan_date', to)
    .order('plan_date')
    .order('sort_order');
  if (error) throw new Error(`meal plan: ${error.message}`);
  return (
    data as {
      id: string;
      plan_date: string;
      slot: Slot;
      sort_order: number;
      meal_plan_entry_member: { member_id: string }[] | null;
      meal_id: string | null;
      free_text: string | null;
      notes: string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    planDate: e.plan_date,
    slot: e.slot,
    sortOrder: e.sort_order,
    memberIds: (e.meal_plan_entry_member ?? []).map((p) => p.member_id),
    mealId: e.meal_id,
    freeText: e.free_text,
    notes: e.notes,
  }));
}

/** [MEAL-04] Each child's lunch for the week from `from`: buy, bring, or none (and why). */
export async function loadLunch(
  db: SupabaseClient,
  householdId: string,
  from: string,
): Promise<LunchChild[]> {
  const { data, error } = await db.rpc('lunch_week', { p_household: householdId, p_from: from });
  if (error) throw new Error(`lunch: ${error.message}`);
  return lunchFromDb(data as Parameters<typeof lunchFromDb>[0]);
}

/** [MENU-01] The household's school menus by name, for each child's choice (WP-27). */
export async function loadMenuNames(
  db: SupabaseClient,
  householdId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('menu_source')
    .select('id, name')
    .eq('household_id', householdId)
    .order('name');
  if (error) throw new Error(`menus: ${error.message}`);
  return (data ?? []).map((m) => ({ id: m.id as string, name: m.name as string }));
}
