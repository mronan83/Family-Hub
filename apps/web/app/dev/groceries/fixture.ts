import { itemKey } from '@/lib/grocery-merge';
import type { GroceriesData } from '../../(admin)/admin/groceries/data';
import type {
  GroceryCategory,
  GroceryItem,
  GroceryReason,
  GroceryStore,
  Person,
} from '@/lib/groceries';

// The made-up demo family's grocery list (WP-104), as the approved mockup draws it: Alex and Sam,
// Maya and Leo; Tuesday's tacos and Wednesday's chili; four things got this week. For the dev
// pages (UI suite, screen shots, the guide); no database.

export const NOW = Date.parse('2026-10-18T21:22:00Z'); // Sun, Oct 18, 4:22 pm in Chicago
export const TZ = 'America/Chicago';

const ALEX_USER = 'f3a00000-0000-4000-8000-0000000000a1';
const SAM_USER = 'f3a00000-0000-4000-8000-0000000000a2';
export const PEOPLE: Person[] = [
  {
    id: 'f3b00000-0000-4000-8000-000000000001',
    name: 'Alex',
    userId: ALEX_USER,
    avatarKey: 'owl',
    color: 'member-1',
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000002',
    name: 'Sam',
    userId: SAM_USER,
    avatarKey: 'bear',
    color: 'member-2',
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000003',
    name: 'Maya',
    userId: null,
    avatarKey: 'fox',
    color: 'member-3',
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000004',
    name: 'Leo',
    userId: null,
    avatarKey: 'frog',
    color: 'member-4',
  },
];
const [, , MAYA, LEO] = PEOPLE;

const c = (n: number, key: string, name: string, icon: string): GroceryCategory => ({
  id: `f3c00000-0000-4000-8000-00000000000${n}`,
  name,
  icon,
  starterKey: key,
  isOther: key === 'other',
  sortOrder: n,
});
export const CATEGORIES: GroceryCategory[] = [
  c(1, 'produce', 'Produce', 'carrot'),
  c(2, 'dairy', 'Dairy & Eggs', 'milk'),
  c(3, 'bakery', 'Bakery', 'croissant'),
  c(4, 'meat', 'Meat & Seafood', 'beef'),
  c(5, 'pantry', 'Pantry', 'wheat'),
  c(6, 'frozen', 'Frozen', 'snowflake'),
  c(7, 'snacks', 'Snacks', 'cookie'),
  c(8, 'household', 'Household', 'shopping-bag'),
  c(9, 'other', 'Other', 'package'),
];
const CAT = Object.fromEntries(CATEGORIES.map((x) => [x.starterKey, x.id])) as Record<
  string,
  string
>;

export const STORES: GroceryStore[] = [
  'Costco',
  'Kroger',
  'Aldi',
  'Walmart',
  'Meijer',
  "Sam's Club",
].map((name, i) => ({ id: `f3d00000-0000-4000-8000-00000000000${i + 1}`, name, sortOrder: i + 1 }));
const STORE = Object.fromEntries(STORES.map((s) => [s.name, s.id])) as Record<string, string>;

const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const r = (kind: GroceryReason['kind'], o: Partial<GroceryReason> = {}): GroceryReason => ({
  kind,
  byUser: null,
  memberId: null,
  mealPlanEntryId: null,
  label: null,
  amount: null,
  createdAt: at(600),
  ...o,
});
const added = (who: string, amount: string | null = null) =>
  r('added', { byUser: who === 'Alex' ? ALEX_USER : SAM_USER, amount });
const meal = (label: string, amount: string | null = null) =>
  r('meal', {
    label,
    amount,
    mealPlanEntryId: `f3e00000-0000-4000-8000-${label.length.toString().padStart(12, '0')}`,
  });
const ask = (who: Person, amount: string | null = null) => r('ask', { memberId: who.id, amount });

let n = 0;
const item = (
  name: string,
  cat: string,
  reasons: GroceryReason[],
  o: Partial<GroceryItem> = {},
): GroceryItem => ({
  id: `f3f00000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  name,
  amount: null,
  categoryId: CAT[cat]!,
  storeId: null,
  status: 'open',
  tickedAt: null,
  tickedBy: null,
  createdAt: at(1000 - n),
  reasons,
  ...o,
});

export const ITEMS: GroceryItem[] = [
  item('Apples', 'produce', [ask(LEO!, '×6')]),
  item('Avocados', 'produce', [added('Alex', '×2')], { storeId: STORE.Aldi! }),
  item('Baby spinach', 'produce', [added('Sam')]),
  item('Bananas', 'produce', [added('Sam')], { storeId: STORE.Aldi! }),
  item('Lettuce', 'produce', [meal('Tacos, Tue', '1')]),
  item('Onions', 'produce', [meal('Tacos, Tue', '1'), meal('Chili, Wed', '2')]),
  item('Cheddar', 'dairy', [meal('Tacos, Tue')], { storeId: STORE.Kroger! }),
  item('Eggs', 'dairy', [added('Sam', '1 dozen')], { storeId: STORE.Aldi! }),
  item('Greek yogurt', 'dairy', [ask(MAYA!)]),
  item('Milk', 'dairy', [added('Alex', '×2')], { storeId: STORE.Costco! }),
  item('Sourdough', 'bakery', [added('Alex')]),
  item('Tortillas', 'bakery', [meal('Tacos, Tue', '8')], { storeId: STORE.Kroger! }),
  item('Ground beef', 'meat', [meal('Tacos, Tue', '1 lb'), meal('Chili, Wed', '1 lb')], {
    storeId: STORE.Kroger!,
  }),
  item('Salmon fillets', 'meat', [meal('Salmon and rice, Thu', '×4')], { storeId: STORE.Costco! }),
  item('Kidney beans', 'pantry', [meal('Chili, Wed', '2 cans')]),
  item('Peanut butter', 'pantry', [added('Sam')]),
  item('Rice', 'pantry', [added('Sam'), meal('Salmon and rice, Thu')]),
  item('Dish soap', 'household', [added('Alex')], { storeId: STORE.Walmart! }),
  item('Paper towels', 'household', [added('Sam')], { storeId: STORE.Costco! }),
  item('Coffee', 'pantry', [added('Sam')], {
    status: 'ticked',
    tickedAt: at(23 * 60 + 40),
    tickedBy: SAM_USER,
  }),
  item('Pasta', 'pantry', [added('Sam', '×2')], {
    status: 'ticked',
    tickedAt: at(23 * 60 + 41),
    tickedBy: SAM_USER,
  }),
  item('Strawberries', 'produce', [added('Sam')], {
    status: 'ticked',
    tickedAt: at(23 * 60 + 42),
    tickedBy: SAM_USER,
  }),
  item('Foil', 'household', [added('Alex')], {
    status: 'ticked',
    tickedAt: at(2 * 24 * 60 + 72),
    tickedBy: ALEX_USER,
  }),
];

/**
 * The page's data: busy (the mockup's list), or empty with nothing got either; [MEAL-28] with a
 * preferred store by name (WP-112), or none.
 */
export function groceriesData(
  state: 'busy' | 'empty' = 'busy',
  preferred: string | null = null,
): GroceriesData {
  const items = state === 'empty' ? [] : ITEMS;
  return {
    categories: CATEGORIES,
    stores: STORES,
    items,
    people: PEOPLE,
    past: items.map((i) => ({
      key: itemKey(i.name),
      categoryId: i.categoryId,
      storeId: i.storeId,
      createdAt: i.createdAt,
    })),
    learned: [
      { word: 'yogurt', categoryId: CAT.dairy!, weight: 3 },
      { word: 'greek', categoryId: CAT.dairy!, weight: 1 },
      { word: 'popcorn', categoryId: CAT.snacks!, weight: 2 },
    ],
    preferredStoreId: (preferred && STORE[preferred]) || null,
  };
}

const HOME_LIST = [
  'Apples',
  'Avocados',
  'Bananas',
  'Onions',
  'Eggs',
  'Milk',
  'Tortillas',
  'Paper towels',
];

/**
 * [MEAL-27] Home's Groceries card (WP-112), as its mockup draws it: 8 on the list (Onions ×3 among
 * them), Ground beef had before at Kroger and not on the list now, Costco preferred; after Add, with
 * Ground beef 2 lb on it; or nothing on the list. Everything the demo family has had is its history.
 */
export function homeGroceries(state: 'busy' | 'added' | 'empty' = 'busy'): GroceriesData {
  const all = groceriesData('busy', 'Costco');
  const beef = ITEMS.find((i) => i.name === 'Ground beef')!;
  const open =
    state === 'empty'
      ? []
      : [
          ...ITEMS.filter((i) => HOME_LIST.includes(i.name)),
          ...(state === 'added'
            ? [
                {
                  ...beef,
                  id: 'f3f00000-0000-4000-8000-0000000000b1',
                  reasons: [added('Alex', '2 lb')],
                },
              ]
            : []),
        ];
  return { ...all, items: open };
}
