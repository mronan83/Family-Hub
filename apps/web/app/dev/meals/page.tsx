import type { Metadata } from 'next';
import { MealLibraryView } from '../../(admin)/admin/meals/library/view';
import { MealsView } from '../../(admin)/admin/meals/view';
import { type MealRow, type PlanEntry, type Slot, weekDays } from '@/lib/meals';

// The admin Meals pages (WP-25) with a made-up family and no database, for the UI suite and the
// guide's pictures: the week in Day or Evening (?theme=evening), opened to add a Wednesday snack
// (?add=1), and the meal library (?page=library).
export const metadata: Metadata = { title: 'Meals', robots: { index: false } };

const MAYA = 'f2000000-0000-4000-8000-000000000001';
const LEO = 'f2000000-0000-4000-8000-000000000002';
const meal = (
  n: number,
  name: string,
  icon: string,
  mealTypes: Slot[],
  extra: Partial<MealRow> = {},
) =>
  ({
    id: `f2d00000-0000-4000-8000-00000000000${n}`,
    name,
    description: null,
    icon,
    mealTypes,
    recipeUrl: null,
    archivedAt: null,
    ...extra,
  }) satisfies MealRow;
const MEALS: MealRow[] = [
  meal(1, 'Tacos', 'utensils', ['dinner'], { recipeUrl: 'https://example.com/tacos' }),
  meal(2, 'Spaghetti', 'dinner', ['dinner'], {
    description: 'With the meat sauce from the freezer',
  }),
  meal(3, 'Porridge', 'breakfast', ['breakfast']),
  meal(4, 'Pancakes', 'breakfast', ['breakfast'], { description: 'Saturdays' }),
  meal(5, 'Chicken soup', 'soup', ['lunch', 'dinner']),
  meal(6, 'Fish pie', 'dinner', ['dinner']),
  meal(7, 'Apple slices', 'apple', ['snack']),
  meal(8, 'Old casserole', 'dinner', [], { archivedAt: '2026-09-01T00:00:00Z' }),
];
const WEEK = '2026-10-11';
const TODAY = '2026-10-14';

let n = 0;
const entry = (
  day: number,
  slot: Slot,
  what: { meal?: number; text?: string },
  o: Partial<PlanEntry> = {},
) =>
  ({
    id: `f2e10000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    planDate: weekDays(WEEK)[day]!,
    slot,
    sortOrder: n,
    memberId: null,
    mealId: what.meal ? `f2d00000-0000-4000-8000-00000000000${what.meal}` : null,
    freeText: what.text ?? null,
    notes: null,
    ...o,
  }) satisfies PlanEntry;
const ENTRIES: PlanEntry[] = [
  entry(0, 'dinner', { meal: 6 }),
  entry(1, 'breakfast', { meal: 3 }),
  entry(1, 'dinner', { meal: 1 }, { notes: 'Make extra for lunch' }),
  entry(2, 'lunch', { text: 'Leftover tacos' }, { memberId: LEO }),
  entry(2, 'dinner', { meal: 2 }),
  entry(3, 'breakfast', { meal: 3 }),
  entry(3, 'snack', { meal: 7 }, { memberId: MAYA }),
  entry(3, 'snack', { text: 'Crackers' }),
  entry(3, 'dinner', { meal: 5 }),
  entry(4, 'dinner', { text: 'Out for Grandma’s birthday' }),
  entry(5, 'dinner', { text: 'Pizza and a movie' }),
  entry(6, 'breakfast', { meal: 4 }),
];

export default async function DevMealsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; page?: string; add?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  return (
    <div className={`admin ${theme}`}>
      {p.page === 'library' ? (
        <MealLibraryView meals={MEALS} notice={null} error={null} />
      ) : (
        <MealsView
          week={WEEK}
          today={TODAY}
          days={weekDays(WEEK)}
          entries={ENTRIES}
          meals={MEALS}
          members={[
            { id: MAYA, displayName: 'Maya' },
            { id: LEO, displayName: 'Leo' },
            { id: 'f2000000-0000-4000-8000-0000000000a1', displayName: 'Alex' },
          ]}
          addAt={p.add ? { day: TODAY, slot: 'snack' } : null}
          newId="f2e10000-0000-4000-8000-0000000000ff"
          notice={null}
          error={null}
        />
      )}
    </div>
  );
}
