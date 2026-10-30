import type { GroceryBrand } from '@/lib/grocery-brands';
import { itemKey } from '@/lib/grocery-merge';
import type { GroceriesData } from '../../(admin)/admin/groceries/data';
import { addDays, type Bought, type StapleChoice } from '@/lib/grocery-staples';
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
    role: 'adult',
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000002',
    name: 'Sam',
    userId: SAM_USER,
    avatarKey: 'bear',
    color: 'member-2',
    role: 'adult',
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000003',
    name: 'Maya',
    userId: null,
    avatarKey: 'fox',
    color: 'member-3',
    role: 'child',
    askOk: true,
  },
  {
    id: 'f3b00000-0000-4000-8000-000000000004',
    name: 'Leo',
    userId: null,
    avatarKey: 'frog',
    color: 'member-4',
    role: 'child',
    askOk: true,
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

/**
 * [MEAL-29] The demo family's brands (WP-116), as the brands mockup draws them: Kirkland and Kirkland
 * Signature the near-duplicates to merge, Horizon archived.
 */
export const BRANDS: GroceryBrand[] = [
  ['Chobani', false],
  ["Dave's Killer Bread", false],
  ['Fairlife', false],
  ['Horizon', true],
  ['Jif', false],
  ['Kirkland', false],
  ['Kirkland Signature', false],
  ['Mission', false],
  ["Peet's", false],
].map(([name, archived], i) => ({
  id: `f3a10000-0000-4000-8000-00000000000${i + 1}`,
  name: name as string,
  archived: archived as boolean,
}));
const BRAND = Object.fromEntries(BRANDS.map((b) => [b.name, b.id])) as Record<string, string>;

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
  brandId: null,
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
  item('Greek yogurt', 'dairy', [ask(MAYA!)], { brandId: BRAND.Chobani! }),
  item('Milk', 'dairy', [added('Alex', '×2')], {
    storeId: STORE.Costco!,
    brandId: BRAND.Kirkland!,
  }),
  item('Sourdough', 'bakery', [added('Alex')], { brandId: BRAND["Dave's Killer Bread"]! }),
  item('Tortillas', 'bakery', [meal('Tacos, Tue', '8')], {
    storeId: STORE.Kroger!,
    brandId: BRAND.Mission!,
  }),
  item('Ground beef', 'meat', [meal('Tacos, Tue', '1 lb'), meal('Chili, Wed', '1 lb')], {
    storeId: STORE.Kroger!,
  }),
  item('Salmon fillets', 'meat', [meal('Salmon and rice, Thu', '×4')], { storeId: STORE.Costco! }),
  item('Kidney beans', 'pantry', [meal('Chili, Wed', '2 cans')]),
  item('Peanut butter', 'pantry', [added('Sam')], { brandId: BRAND.Jif! }),
  item('Rice', 'pantry', [added('Sam'), meal('Salmon and rice, Thu')]),
  item('Dish soap', 'household', [added('Alex')], { storeId: STORE.Walmart! }),
  item('Paper towels', 'household', [added('Sam')], {
    storeId: STORE.Costco!,
    brandId: BRAND['Kirkland Signature']!,
  }),
  item('Coffee', 'pantry', [added('Sam')], {
    brandId: BRAND["Peet's"]!,
    status: 'ticked',
    tickedAt: at(23 * 60 + 40),
    tickedBy: SAM_USER,
    // [MEAL-30] Ticked at the board, as Sam (WP-107).
    tickedMemberId: 'f3b00000-0000-4000-8000-000000000002',
    tickedBoard: 'Kitchen',
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

/** Buy days from the last one and the gaps before it, oldest first. */
function bought(name: string, last: string, gaps: number[], buys?: number): Bought {
  const days = [last];
  for (const g of [...gaps].reverse()) days.unshift(addDays(days[0]!, -g));
  return { key: itemKey(name), name, buys: buys ?? days.length, days: days.slice(-8) };
}

/**
 * [MEAL-21] The demo family's staples (WP-106), as the mockup draws them on Sun, Oct 18: Butter,
 * Cereal and Trash bags running low; Milk, Bananas, Eggs and Sourdough on the list; Coffee due Oct 29;
 * Cheddar, Tortillas and Strawberries still learning; Birthday candles not suggested.
 */
export const BOUGHT: Bought[] = [
  bought('Milk', '2026-10-14', [5, 5, 4, 5, 5, 6, 5], 14),
  bought('Bananas', '2026-10-13', [6, 6, 7, 6, 5]),
  bought('Eggs', '2026-10-11', [8, 8, 7, 9, 8]),
  bought('Butter', '2026-10-09', [9, 8, 10, 9]),
  bought('Cereal', '2026-10-12', [7, 7, 6, 8, 7]),
  bought('Trash bags', '2026-09-27', [21, 21, 20, 22]),
  bought('Coffee', '2026-10-17', [14, 13, 15]),
  bought('Sourdough', '2026-10-15', [4, 4, 3, 4, 4, 5, 4], 12),
  bought('Cheddar', '2026-10-06', [12]),
  bought('Tortillas', '2026-10-13', [7, 9]),
  bought('Strawberries', '2026-10-17', [3, 11, 20, 4, 15]),
  bought('Birthday candles', '2026-08-30', [40, 50, 60]),
];
export const STAPLE_CHOICES: StapleChoice[] = [
  { key: itemKey('Birthday candles'), notNowUntil: null, offAt: '2026-09-12T15:00:00Z' },
];
/** Where the running-low staples were had last time: their category, store and brand. */
const STAPLE_PAST = [
  ['Butter', 'dairy', 'Costco', 'Kirkland'],
  ['Cereal', 'pantry', 'Kroger', null],
  ['Trash bags', 'household', 'Costco', 'Kirkland Signature'],
].map(([name, cat, store, brand]) => ({
  key: itemKey(name!),
  categoryId: CAT[cat!]!,
  storeId: STORE[store!]!,
  brandId: brand ? BRAND[brand]! : null,
  createdAt: '2026-10-01T15:00:00Z',
}));

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
    brands: BRANDS,
    items,
    people: PEOPLE,
    past: [
      ...items.map((i) => ({
        key: itemKey(i.name),
        categoryId: i.categoryId,
        storeId: i.storeId,
        brandId: i.brandId,
        createdAt: i.createdAt,
      })),
      ...(state === 'empty' ? [] : STAPLE_PAST),
    ],
    learned: [
      { word: 'yogurt', categoryId: CAT.dairy!, weight: 3 },
      { word: 'greek', categoryId: CAT.dairy!, weight: 1 },
      { word: 'popcorn', categoryId: CAT.snacks!, weight: 2 },
    ],
    preferredStoreId: (preferred && STORE[preferred]) || null,
    // [MEAL-21] The staples (WP-106); an empty list has no history either.
    bought: state === 'empty' ? [] : BOUGHT,
    stapleChoices: state === 'empty' ? [] : STAPLE_CHOICES,
    // [MEAL-22] Maya's popcorn and Leo's ice cream wait for a parent (WP-107).
    asks:
      state === 'empty'
        ? []
        : [
            {
              id: 'f3c00000-0000-4000-8000-000000000001',
              memberId: MAYA!.id,
              name: 'Popcorn',
              brandId: null,
              askedAt: at(40),
              board: 'Kitchen',
            },
            {
              id: 'f3c00000-0000-4000-8000-000000000002',
              memberId: LEO!.id,
              name: 'Orange juice',
              brandId: BRAND.Kirkland!,
              askedAt: at(17),
              board: 'Kitchen',
            },
          ],
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

/** [MEAL-21] Running low?'s Add on Butter (WP-106): Butter · Kirkland on the list as a staple. */
export function withStapleAdded(data: GroceriesData): { data: GroceriesData; id: string } {
  const butter = item('Butter', 'dairy', [r('staple', { byUser: ALEX_USER, createdAt: at(1) })], {
    storeId: STORE.Costco!,
    brandId: BRAND.Kirkland!,
    createdAt: at(1),
  });
  return { data: { ...data, items: [...data.items, butter] }, id: butter.id };
}
