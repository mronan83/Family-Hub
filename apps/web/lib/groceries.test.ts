import { describe, expect, it } from 'vitest';
import items from './__fixtures__/grocery-items.json';
import { starterList } from './grocery-starter';
import {
  categoryOrder,
  forMeals,
  type GroceryCategory,
  type GroceryItem,
  gotRecently,
  itemAmount,
  sections,
  storeChips,
  suggest,
  type SuggestContext,
  whyLines,
} from './groceries';

const cat = (id: string, name: string, sortOrder: number, starterKey: string | null = null) =>
  ({
    id,
    name,
    icon: 'carrot',
    starterKey,
    isOther: starterKey === 'other',
    sortOrder,
  }) satisfies GroceryCategory;
const PRODUCE = cat('c1', 'Produce', 1, 'produce');
const DAIRY = cat('c2', 'Dairy & Eggs', 2, 'dairy');
const SNACKS = cat('c3', 'Snacks', 3, 'snacks');
const OTHER = cat('c9', 'Other', 9, 'other');
const CATEGORIES = [OTHER, SNACKS, DAIRY, PRODUCE];

let n = 0;
const item = (name: string, categoryId: string, o: Partial<GroceryItem> = {}): GroceryItem => ({
  id: `i${(n += 1)}`,
  name,
  amount: null,
  categoryId,
  storeId: null,
  status: 'open',
  tickedAt: null,
  tickedBy: null,
  createdAt: '2026-10-17T12:00:00Z',
  reasons: [],
  ...o,
});

describe('the list', () => {
  it('[MEAL-23-a] groups by the household’s categories in their order, Other last, A to Z inside', () => {
    expect(categoryOrder(CATEGORIES).map((c) => c.name)).toEqual([
      'Produce',
      'Dairy & Eggs',
      'Snacks',
      'Other',
    ]);
    const items = [
      item('onions', PRODUCE.id),
      item('Apples', PRODUCE.id),
      item('bananas', PRODUCE.id),
      item('Mystery', OTHER.id),
      item('Milk', DAIRY.id),
      item('Gone', 'removed-category'),
      item('Got', DAIRY.id, { status: 'ticked', tickedAt: '2026-10-17T12:00:00Z' }),
    ];
    const s = sections(items, CATEGORIES);
    expect(s.map((x) => [x.category.name, x.items.map((i) => i.name)])).toEqual([
      ['Produce', ['Apples', 'bananas', 'onions']],
      ['Dairy & Eggs', ['Milk']],
      ['Other', ['Gone', 'Mystery']],
    ]);
  });

  it('[MEAL-23-a] a store chip shows only its items, still by category; Any store those with none', () => {
    const items = [
      item('Milk', DAIRY.id, { storeId: 's1' }),
      item('Apples', PRODUCE.id, { storeId: 's1' }),
      item('Eggs', DAIRY.id, { storeId: 's2' }),
      item('Pears', PRODUCE.id),
    ];
    const stores = [
      { id: 's2', name: 'Aldi', sortOrder: 2 },
      { id: 's1', name: 'Costco', sortOrder: 1 },
      { id: 's3', name: 'Meijer', sortOrder: 3 },
    ];
    expect(storeChips(items, stores)).toEqual([
      { filter: 'all', label: 'All', count: 4 },
      { filter: 's1', label: 'Costco', count: 2 },
      { filter: 's2', label: 'Aldi', count: 1 },
      { filter: 'any', label: 'Any store', count: 1 },
    ]);
    expect(
      sections(items, CATEGORIES, 's1').map((x) => [x.category.name, x.items.map((i) => i.name)]),
    ).toEqual([
      ['Produce', ['Apples']],
      ['Dairy & Eggs', ['Milk']],
    ]);
    expect(sections(items, CATEGORIES, 'any').flatMap((x) => x.items.map((i) => i.name))).toEqual([
      'Pears',
    ]);
  });

  it('[MEAL-18-c] Got recently: ticked in the last 7 days, newest first; not 8 days ago', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const items = [
      item('Coffee', DAIRY.id, { status: 'ticked', tickedAt: '2026-10-17T22:42:00Z' }),
      item('Foil', DAIRY.id, { status: 'ticked', tickedAt: '2026-10-11T12:00:00Z' }),
      item('Old', DAIRY.id, { status: 'ticked', tickedAt: '2026-10-10T11:59:00Z' }),
      item('Pasta', DAIRY.id, { status: 'ticked', tickedAt: '2026-10-17T22:43:00Z' }),
      item('Open', DAIRY.id),
    ];
    expect(gotRecently(items, now).map((i) => i.name)).toEqual(['Pasta', 'Coffee', 'Foil']);
    expect(sections(items, CATEGORIES).flatMap((s) => s.items.map((i) => i.name))).toEqual([
      'Open',
    ]);
  });

  it('[MEAL-23-a] each item says what to buy and why, the meals once each', () => {
    const people = [
      { id: 'm1', name: 'Leo', userId: null, avatarKey: 'frog', color: 'member-4' },
      { id: 'm2', name: 'Alex', userId: 'u1', avatarKey: 'owl', color: 'member-1' },
    ];
    const r = (o: Partial<GroceryItem['reasons'][number]>) => ({
      kind: 'added' as const,
      byUser: null,
      memberId: null,
      mealPlanEntryId: null,
      label: null,
      amount: null,
      createdAt: '2026-10-17T12:00:00Z',
      ...o,
    });
    const onions = item('Onions', PRODUCE.id, {
      reasons: [
        r({ kind: 'meal', label: 'Tacos, Tue', amount: '1' }),
        r({ kind: 'meal', label: 'Chili, Wed', amount: '2', createdAt: '2026-10-17T12:01:00Z' }),
        r({ kind: 'ask', memberId: 'm1', createdAt: '2026-10-17T12:02:00Z' }),
        r({ byUser: 'u1', createdAt: '2026-10-17T12:03:00Z' }),
        r({ byUser: 'u1', createdAt: '2026-10-17T12:04:00Z' }),
      ],
    });
    expect(itemAmount(onions)).toBe('×3');
    expect(itemAmount({ ...onions, amount: '×4' })).toBe('×7');
    expect(forMeals(onions)).toBe('Tacos, Chili');
    expect(whyLines(onions, people)).toEqual([
      { kind: 'meal', label: 'Tacos, Tue' },
      { kind: 'meal', label: 'Chili, Wed' },
      { kind: 'ask', member: people[0] },
      { kind: 'added', who: 'Alex' },
    ]);
  });
});

describe('the suggestion', () => {
  const ctx = (o: Partial<SuggestContext> = {}): SuggestContext => ({
    categories: CATEGORIES,
    past: [],
    learned: [],
    starter: new Map([
      ['yogurt', 'dairy'],
      ['greek yogurt', 'dairy'],
      ['popcorn', 'snacks'],
      ['apple', 'produce'],
      ['frozen pea', 'frozen'],
    ]),
    ...o,
  });

  it('[MEAL-24-a] an item had before gets the category and store it had last time', () => {
    const past = [
      {
        key: 'greek yogurt',
        categoryId: SNACKS.id,
        storeId: 's1',
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        key: 'greek yogurt',
        categoryId: DAIRY.id,
        storeId: 's2',
        createdAt: '2026-10-10T00:00:00Z',
      },
    ];
    expect(suggest('2 Greek yogurts', ctx({ past }))).toEqual({
      categoryId: DAIRY.id,
      storeId: 's2',
      from: 'last',
    });
  });

  it('[MEAL-24-b] a new item takes the household’s learned words before the starter list', () => {
    const learned = [
      { word: 'yogurt', categoryId: SNACKS.id, weight: 2 },
      { word: 'greek', categoryId: PRODUCE.id, weight: 1 },
    ];
    expect(suggest('vanilla yogurt', ctx({ learned }))).toEqual({
      categoryId: SNACKS.id,
      storeId: null,
      from: 'learned',
    });
    // The thing itself, the last word, counts most.
    expect(suggest('greek yogurt', ctx({ learned }))?.categoryId).toBe(SNACKS.id);
  });

  it('[MEAL-24-c] an item nothing has taught takes the starter list’s category, renamed or not', () => {
    const renamed = { ...DAIRY, name: 'Fridge' };
    expect(suggest('Greek yogurt', ctx({ categories: [PRODUCE, renamed, SNACKS, OTHER] }))).toEqual(
      { categoryId: DAIRY.id, storeId: null, from: 'starter' },
    );
    expect(suggest('popcorn', ctx())?.categoryId).toBe(SNACKS.id);
    expect(suggest('Apples', ctx())?.categoryId).toBe(PRODUCE.id);
    // A starter category the household removed: Other.
    expect(suggest('frozen peas', ctx())).toEqual({
      categoryId: OTHER.id,
      storeId: null,
      from: 'other',
    });
  });

  it('[MEAL-24-c] the shipped starter list places made-up items in the starter categories', () => {
    const KEYS = ['produce', 'dairy', 'bakery', 'meat', 'pantry', 'frozen', 'snacks', 'household'];
    const all = [...KEYS.map((k, i) => cat(k, k, i, k)), cat('other', 'Other', 9, 'other')];
    const at = (text: string) =>
      suggest(text, { categories: all, past: [], learned: [], starter: starterList })?.categoryId;
    expect(at('Bananas')).toBe('produce');
    expect(at('2 lb ground beef')).toBe('meat');
    expect(at('Greek yogurt')).toBe('dairy');
    expect(at('paper towels')).toBe('household');
    expect(at('frozen peas')).toBe('frozen');
    expect(at('canned corn')).toBe('pantry');
    // 200 made-up items, as measured for D-140: at least 84.5% placed right.
    const right = (items as [string, string][]).filter(([text, want]) => at(text) === want).length;
    expect(right, `${right} of ${items.length}`).toBeGreaterThanOrEqual(169);
  });

  it('[MEAL-24-d] an item nothing knows goes to Other, with any store', () => {
    expect(suggest('flux capacitor', ctx())).toEqual({
      categoryId: OTHER.id,
      storeId: null,
      from: 'other',
    });
    expect(suggest('   ', ctx())).toBeNull();
  });
});
