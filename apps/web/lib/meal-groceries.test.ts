import { describe, expect, it } from 'vitest';
import type { GroceryCategory, GroceryItem } from './groceries';
import { rowNotes, startTicked, weekGroceryItems, weekReview } from './meal-groceries';
import type { MealRow, PlanEntry } from './meals';

const meal = (id: string, name: string, ingredients: MealRow['ingredients']): MealRow => ({
  id,
  name,
  description: null,
  icon: 'utensils',
  mealTypes: ['dinner'],
  recipeUrl: null,
  archivedAt: null,
  ingredients,
});
const i = (name: string, amount: string | null = null, have = false) => ({ name, amount, have });
const MEALS = [
  meal('tacos', 'Tacos', [
    i('Ground beef', '1 lb'),
    i('Onion', '1'),
    i('Taco seasoning', null, true),
  ]),
  meal('chili', 'Chili', [i('Ground beef', '1 lb'), i('Onions', '2'), i('Kidney beans', '2 cans')]),
  meal('salmon', 'Salmon and rice', [i('Salmon fillets', '×4'), i('Rice')]),
  meal('pancakes', 'Pancakes', [i('Eggs'), i('Milk')]),
  meal('pizza', 'Pizza night', []),
];
let n = 0;
const entry = (
  planDate: string,
  slot: PlanEntry['slot'],
  mealId: string | null,
  freeText: string | null = null,
): PlanEntry => ({
  id: `e${(n += 1)}`,
  planDate,
  slot,
  sortOrder: 1,
  memberIds: [],
  mealId,
  freeText,
  notes: null,
});
// Sun Oct 18 to Sat Oct 24, 2026, written out of order.
const WEEK = [
  entry('2026-10-24', 'breakfast', 'pancakes'),
  entry('2026-10-21', 'dinner', 'chili'),
  entry('2026-10-20', 'dinner', 'tacos'),
  entry('2026-10-22', 'dinner', 'salmon'),
  entry('2026-10-23', 'dinner', 'pizza'),
  entry('2026-10-19', 'dinner', null, 'Leftovers'),
];
const listed = (name: string, amount: string | null = null): GroceryItem => ({
  id: name,
  name,
  amount,
  categoryId: 'c',
  storeId: null,
  status: 'open',
  tickedAt: null,
  tickedBy: null,
  createdAt: '',
  reasons: [],
});

describe('a week’s meals into groceries', () => {
  const added = new Map([[WEEK[0]!.id, '2026-10-18T15:00:00Z']]);
  const review = weekReview(WEEK, MEALS, added, 'America/Chicago');

  it('[MEAL-19-a] lists the planned library meals by meal in day order, with their ingredients', () => {
    expect(review.meals.map((m) => `${m.name} ${m.day}`)).toEqual([
      'Tacos Tue',
      'Chili Wed',
      'Salmon and rice Thu',
      'Pancakes Sat',
    ]);
    expect(review.meals[1]!.rows.map((r) => [r.name, r.amount])).toEqual([
      ['Ground beef', '1 lb'],
      ['Onions', '2'],
      ['Kidney beans', '2 cans'],
    ]);
    // Written in, or nothing kept yet: said, not listed.
    expect(review.without).toEqual(['Leftovers', 'Pizza night']);
  });

  it('[MEAL-19-a] what we usually have, and a meal already added that week, start unticked', () => {
    const ticked = startTicked(review);
    const names = review.meals.flatMap((m) =>
      m.rows.filter((r) => ticked.has(r.id)).map((r) => `${m.name}: ${r.name}`),
    );
    expect(names).toEqual([
      'Tacos: Ground beef',
      'Tacos: Onion',
      'Chili: Ground beef',
      'Chili: Onions',
      'Chili: Kidney beans',
      'Salmon and rice: Salmon fillets',
      'Salmon and rice: Rice',
    ]);
    const notes = rowNotes(review, ticked, []);
    const of = (meal: number, row: number) => notes.get(review.meals[meal]!.rows[row]!.id)?.text;
    expect(of(0, 2)).toBe('We usually have it');
    expect(review.meals[3]!.addedOn).toBe('Sun');
    expect(of(3, 0)).toBe('Added Sun');
  });

  it('[MEAL-19-a] a ticked row says what it makes once merged; nothing is scaled', () => {
    const ticked = startTicked(review);
    const notes = rowNotes(review, ticked, [listed('Rice'), listed('Kidney beans', '1 can')]);
    const of = (meal: number, row: number) => notes.get(review.meals[meal]!.rows[row]!.id)?.text;
    expect(of(1, 0)).toBe('With Tacos: 2 lb');
    expect(of(1, 1)).toBe('With Tacos: ×3');
    expect(of(1, 2)).toBe('On the list: Kidney beans 1 can, makes 3 cans');
    expect(of(2, 1)).toBe('On the list already');
    expect(of(0, 0)).toBeUndefined();
    // Unticking the tacos' beef: the chili's beef is first again.
    const less = new Set(ticked);
    less.delete(review.meals[0]!.rows[0]!.id);
    expect(rowNotes(review, less, []).get(review.meals[1]!.rows[0]!.id)).toBeUndefined();
  });
});

describe('the week’s items for the list (WP-112)', () => {
  const review = weekReview(WEEK, MEALS, new Map(), 'America/Chicago');
  const cat = (id: string, starterKey: string): GroceryCategory => ({
    id,
    name: id,
    icon: 'carrot',
    starterKey,
    isOther: starterKey === 'other',
    sortOrder: 1,
  });
  const categories = [cat('meat', 'meat'), cat('produce', 'produce'), cat('other', 'other')];

  it('[MEAL-28-d] each new item takes its suggested category and store: last time’s, else the preferred one', () => {
    const chili = review.meals.find((m) => m.name === 'Chili')!;
    const items = weekGroceryItems(review, new Set(chili.rows.map((r) => r.id)), {
      categories,
      // Ground beef was got at Kroger last time; onions at no store.
      past: [
        { key: 'ground beef', categoryId: 'meat', storeId: 'kroger', createdAt: '2026-10-01' },
        { key: 'onion', categoryId: 'produce', storeId: null, createdAt: '2026-10-01' },
      ],
      learned: [],
      starter: null,
      preferredStoreId: 'costco',
    });
    expect(items.map((i) => [i.name, i.amount, i.category_id, i.store_id])).toEqual([
      ['Ground beef', '1 lb', 'meat', 'kroger'],
      ['Onions', '2', 'produce', 'costco'],
      ['Kidney beans', '2 cans', 'other', 'costco'],
    ]);
    expect(items[0]!.reason).toEqual({
      kind: 'meal',
      meal_plan_entry_id: chili.entryId,
      label: 'Chili, Wed',
    });
    // Rows not ticked are left out.
    expect(weekGroceryItems(review, new Set(), { categories, past: [], learned: [] })).toEqual([]);
  });
});
