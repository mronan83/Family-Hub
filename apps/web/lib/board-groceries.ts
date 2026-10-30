import type { BoardAsk, BoardGot, KnownThing } from './grocery-asks';
import type { GroceryBrand } from './grocery-brands';
import type { GroceryCategory, GroceryItem, GroceryStore } from './groceries';
import { itemKey } from './grocery-merge';

// [MEAL-18][MEAL-23] Groceries on the board (WP-104, D-138): board_groceries() read into the app's
// shape, kept with the snapshot so the board shows the last list offline; and each item's picture.

export interface BoardGroceries {
  /** Whether the household has ever had an item: the rail shows Groceries from the first one. */
  ever: boolean;
  categories: GroceryCategory[];
  stores: GroceryStore[];
  /** [MEAL-29] The household's brands, archived ones too: an item keeps its brand (WP-116). */
  brands: GroceryBrand[];
  /** The open items. */
  items: GroceryItem[];
  /** [MEAL-22] The household's day (YYYY-MM-DD) the asks and Got today are of; none before WP-107. */
  today?: string | null;
  /** [MEAL-22] The Asked for card's asks (WP-107). */
  asks?: BoardAsk[];
  /** [MEAL-30] What was ticked today (Got today). */
  got?: BoardGot[];
  /** [MEAL-22] The things the household has had, for the ask's tiles, matches and brand row. */
  known?: KnownThing[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const KINDS = ['added', 'meal', 'ask', 'staple'] as const;

/** board_groceries()'s answer, or null when there is none (an older database, or not a board). */
export function readGroceries(x: unknown): BoardGroceries | null {
  if (!isObject(x)) return null;
  const categories: GroceryCategory[] = [];
  for (const c of Array.isArray(x.categories) ? x.categories : []) {
    if (!isObject(c) || !str(c.id) || !str(c.name)) continue;
    categories.push({
      id: c.id as string,
      name: c.name as string,
      icon: str(c.icon) ?? 'shopping-cart',
      starterKey: str(c.starter_key),
      isOther: c.is_other === true,
      sortOrder: typeof c.sort_order === 'number' ? c.sort_order : 0,
    });
  }
  const stores: GroceryStore[] = [];
  for (const s of Array.isArray(x.stores) ? x.stores : []) {
    if (!isObject(s) || !str(s.id) || !str(s.name)) continue;
    stores.push({
      id: s.id as string,
      name: s.name as string,
      sortOrder: typeof s.sort_order === 'number' ? s.sort_order : 0,
    });
  }
  const brands: GroceryBrand[] = [];
  for (const b of Array.isArray(x.brands) ? x.brands : []) {
    if (!isObject(b) || !str(b.id) || !str(b.name)) continue;
    brands.push({ id: b.id as string, name: b.name as string, archived: b.archived === true });
  }
  const items: GroceryItem[] = [];
  for (const i of Array.isArray(x.items) ? x.items : []) {
    if (!isObject(i) || !str(i.id) || !str(i.name) || !str(i.category_id)) continue;
    items.push({
      id: i.id as string,
      name: i.name as string,
      amount: str(i.amount),
      categoryId: i.category_id as string,
      storeId: str(i.store_id),
      brandId: str(i.brand_id),
      status: 'open',
      tickedAt: null,
      tickedBy: null,
      createdAt: str(i.created_at) ?? '',
      reasons: (Array.isArray(i.reasons) ? i.reasons : []).filter(isObject).map((r) => ({
        kind: KINDS.find((k) => k === r.kind) ?? 'added',
        byUser: null,
        memberId: str(r.member_id),
        mealPlanEntryId: null,
        label: str(r.label),
        amount: str(r.amount),
        createdAt: str(r.created_at) ?? '',
      })),
    });
  }
  const asks: BoardAsk[] = [];
  for (const a of Array.isArray(x.asks) ? x.asks : []) {
    if (!isObject(a) || !str(a.id) || !str(a.member_id) || !str(a.name)) continue;
    if (a.status !== 'waiting' && a.status !== 'added' && a.status !== 'declined') continue;
    asks.push({
      id: a.id as string,
      memberId: a.member_id as string,
      name: a.name as string,
      brandId: str(a.brand_id),
      status: a.status,
      itemStatus:
        a.item_status === 'open' || a.item_status === 'ticked' || a.item_status === 'removed'
          ? a.item_status
          : null,
      gotToday: a.got_today === true,
      askedAt: str(a.asked_at) ?? '',
    });
  }
  const got: BoardGot[] = [];
  for (const g of Array.isArray(x.got) ? x.got : []) {
    if (!isObject(g) || !str(g.id) || !str(g.name) || !str(g.ticked_at)) continue;
    got.push({
      id: g.id as string,
      name: g.name as string,
      brandId: str(g.brand_id),
      categoryId: str(g.category_id) ?? '',
      tickedAt: g.ticked_at as string,
      memberId: str(g.member_id),
    });
  }
  const known: KnownThing[] = [];
  for (const k of Array.isArray(x.known) ? x.known : []) {
    if (!isObject(k) || !str(k.key) || !str(k.name)) continue;
    known.push({
      key: k.key as string,
      name: k.name as string,
      categoryId: str(k.category_id) ?? '',
      buys: typeof k.buys === 'number' ? k.buys : 0,
      brandIds: (Array.isArray(k.brand_ids) ? k.brand_ids : []).filter(
        (b): b is string => typeof b === 'string',
      ),
    });
  }
  return {
    ever: x.ever === true || items.length > 0,
    categories,
    stores,
    brands,
    items,
    today: str(x.today),
    asks,
    got,
    known,
  };
}

/** The snapshot's answer with board_groceries()'s beside it, for readSnapshot. */
export function withGroceries(snapshot: unknown, groceries: unknown): unknown {
  return isObject(snapshot) && groceries != null ? { ...snapshot, groceries } : snapshot;
}

// Pictures that fit a thing, by a word of its name (the app's own icons, D-70).
const PICTURES: Record<string, string> = {
  apple: 'apple',
  banana: 'banana',
  cherry: 'cherry',
  grape: 'grape',
  orange: 'citrus',
  lemon: 'citrus',
  lime: 'citrus',
  carrot: 'carrot',
  milk: 'milk',
  cream: 'milk',
  yogurt: 'milk',
  cheddar: 'milk',
  cheese: 'milk',
  egg: 'egg',
  bread: 'croissant',
  sourdough: 'croissant',
  bagel: 'croissant',
  croissant: 'croissant',
  tortilla: 'croissant',
  roll: 'croissant',
  beef: 'beef',
  steak: 'beef',
  pork: 'beef',
  chicken: 'drumstick',
  turkey: 'drumstick',
  fish: 'fish',
  salmon: 'fish',
  tuna: 'fish',
  shrimp: 'fish',
  rice: 'wheat',
  pasta: 'wheat',
  flour: 'wheat',
  oat: 'wheat',
  cereal: 'wheat',
  bean: 'soup',
  soup: 'soup',
  butter: 'sandwich',
  cookie: 'cookie',
  cracker: 'cookie',
  chip: 'cookie',
  popcorn: 'popcorn',
  candy: 'candy',
  cake: 'cake-slice',
  coffee: 'coffee',
  tea: 'coffee',
  juice: 'cup-soda',
  soda: 'cup-soda',
  water: 'glass-water',
  ice: 'ice-cream-cone',
  pizza: 'pizza',
  salad: 'salad',
  lettuce: 'salad',
  spinach: 'salad',
  soap: 'spray-can',
  detergent: 'spray-can',
  towel: 'shopping-bag',
};

/** An item's picture: a word of its name that has one (the last word first), else its category's. */
export function pictureOf(name: string, category: GroceryCategory | undefined): string {
  const words = itemKey(name).split(' ').reverse();
  for (const w of words) {
    const p = PICTURES[w];
    if (p) return p;
  }
  return category?.icon ?? 'shopping-cart';
}
