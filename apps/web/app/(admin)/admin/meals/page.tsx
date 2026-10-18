import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { copyWords, type Slot, SLOTS, weekDays, weekFrom } from '@/lib/meals';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { lunchRefusal } from '@/lib/lunch';
import { loadLunch, loadMeals, loadMenuNames, loadPlan } from './data';
import { MealsView } from './view';
import type { GroceryItem } from '@/lib/groceries';
import { weekReview, type WeekReview } from '@/lib/meal-groceries';
import { loadGroceries } from '../groceries/data';

export const metadata: Metadata = { title: 'Meals' };

const DID: Record<string, string> = {
  added: 'Added to the plan.',
  saved: 'Saved.',
  moved: 'Moved.',
  removed: 'Removed from the plan.',
  lunch: 'Lunch changed.',
  usual: 'Usual lunches saved.',
  picks: 'Lunch picks saved.',
  nothing: 'Nothing ticked, so nothing was added to groceries.',
};

/** [MEAL-01][MEAL-03] The week's meals (`?week=` any day of it; this week by default). */
export default async function MealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/meals');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const today = isoDay(household.timezone);
  const week = weekFrom(p.week, today, household.weekStart);
  const days = weekDays(week);
  const [entries, meals, members, lunch, menus] = await Promise.all([
    loadPlan(db!, household.id, days[0]!, days[6]!),
    loadMeals(db!, household.id),
    loadMembers(db!, household.id),
    loadLunch(db!, household.id, week),
    loadMenuNames(db!, household.id),
  ]);
  const addAt =
    p.day && days.includes(p.day) && SLOTS.includes(p.slot as Slot)
      ? { day: p.day, slot: p.slot as Slot }
      : null;
  const copied =
    p.copied !== undefined
      ? copyWords({
          copied: Number(p.copied) || 0,
          skipped: Number(p.skipped) || 0,
          replaced: Number(p.replaced) || 0,
        })
      : null;
  // [MEAL-19] The week's Add to groceries, opened (WP-105): when each entry was added, if it was.
  let groceries: { review: WeekReview; open: GroceryItem[] } | null = null;
  if (p.groceries === '1') {
    const [list, added] = await Promise.all([
      loadGroceries(db!, household.id),
      db!
        .from('grocery_item_reason')
        .select('meal_plan_entry_id, created_at')
        .eq('household_id', household.id)
        .in(
          'meal_plan_entry_id',
          entries.map((e) => e.id),
        ),
    ]);
    const when = new Map<string, string>();
    for (const r of (added.data ?? []) as { meal_plan_entry_id: string; created_at: string }[]) {
      const had = when.get(r.meal_plan_entry_id);
      if (!had || r.created_at < had) when.set(r.meal_plan_entry_id, r.created_at);
    }
    groceries = {
      review: weekReview(entries, meals, when, household.timezone),
      open: list.items.filter((i) => i.status === 'open'),
    };
  }
  const done =
    p.did === 'groceries'
      ? `Added ${Number(p.n) || 0} to groceries. Same things were merged.`
      : null;
  return (
    <MealsView
      groceries={groceries}
      week={week}
      today={today}
      days={days}
      entries={entries}
      meals={meals}
      members={members
        .filter((m) => !m.archivedAt)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          avatarKey: m.avatarKey,
          color: m.color,
        }))}
      addAt={addAt}
      editId={p.edit ?? null}
      openDay={p.open ?? null}
      newId={crypto.randomUUID()}
      lunch={lunch}
      menus={menus}
      notice={copied ?? done ?? (p.did ? (DID[p.did] ?? null) : null)}
      error={
        p.lunch
          ? lunchRefusal({ hint: p.lunch })
          : p.did === 'failed'
            ? 'That didn’t change. Try again in a moment.'
            : null
      }
    />
  );
}
