// [MEAL-18][MEAL-23][MEAL-24] Groceries (WP-104, D-138): the list as the admin app and the board show
// it, and the category and store suggested on add. Pure: no I/O; "now" is passed in.

import { brandOf, type GroceryBrand, withBrand } from './grocery-brands';
import { combineAmounts, itemKey, parseItem } from './grocery-merge';

export interface GroceryCategory {
  id: string;
  name: string;
  icon: string;
  /** The starter set's key (produce, dairy, …), kept through a rename; null for the household's own. */
  starterKey: string | null;
  isOther: boolean;
  sortOrder: number;
}

export interface GroceryStore {
  id: string;
  name: string;
  sortOrder: number;
}

export type ReasonKind = 'added' | 'meal' | 'ask' | 'staple';

export interface GroceryReason {
  kind: ReasonKind;
  /** The admin who added it (a sign-in's id). */
  byUser: string | null;
  /** The child who asked, or the person it was added for. */
  memberId: string | null;
  mealPlanEntryId: string | null;
  /** "Tacos, Tue" for a meal. */
  label: string | null;
  amount: string | null;
  createdAt: string;
}

export interface GroceryItem {
  id: string;
  name: string;
  /** The admin's own amount (Edit); the reasons' amounts add to it. */
  amount: string | null;
  categoryId: string;
  storeId: string | null;
  /** [MEAL-29] Its brand, if it has one (WP-116). */
  brandId: string | null;
  status: 'open' | 'ticked';
  tickedAt: string | null;
  tickedBy: string | null;
  createdAt: string;
  reasons: GroceryReason[];
}

export interface Person {
  id: string;
  name: string;
  userId: string | null;
  avatarKey: string | null;
  color: string;
}

/** [MEAL-20] What to buy of an item: its own amount and every reason's, combined. */
export function itemAmount(item: Pick<GroceryItem, 'amount' | 'reasons'>): string | null {
  return combineAmounts([item.amount, ...item.reasons.map((r) => r.amount)]);
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** [MEAL-23] The household's categories in its order, Other last. */
export function categoryOrder(categories: readonly GroceryCategory[]): GroceryCategory[] {
  return [...categories].sort(
    (a, b) => Number(a.isOther) - Number(b.isOther) || a.sortOrder - b.sortOrder || byName(a, b),
  );
}

/** A store chip's choice: all, one store's id, or the items with no store. */
export type StoreFilter = 'all' | 'any' | string;

export interface Section {
  category: GroceryCategory;
  items: GroceryItem[];
}

/**
 * [MEAL-18][MEAL-23] The open items by the household's categories in their order (Other last), A to
 * Z inside each whatever their capitals, kept to one store's items or to those with no store when a
 * chip is chosen. Categories with nothing in them are left out.
 */
export function sections(
  items: readonly GroceryItem[],
  categories: readonly GroceryCategory[],
  store: StoreFilter = 'all',
): Section[] {
  const open = items.filter(
    (i) =>
      i.status === 'open' &&
      (store === 'all' || (store === 'any' ? i.storeId === null : i.storeId === store)),
  );
  const ordered = categoryOrder(categories);
  const other = ordered.find((c) => c.isOther);
  const known = new Set(ordered.map((c) => c.id));
  return ordered
    .map((category) => ({
      category,
      items: open
        .filter((i) =>
          known.has(i.categoryId) ? i.categoryId === category.id : category.id === other?.id,
        )
        .sort(byName),
    }))
    .filter((s) => s.items.length > 0);
}

export interface StoreChip {
  filter: StoreFilter;
  label: string;
  count: number;
}

/**
 * [MEAL-23] The store chips over the list: All, each store that has open items (in the household's
 * order), and Any store for the items with none; each with its count.
 */
export function storeChips(
  items: readonly GroceryItem[],
  stores: readonly GroceryStore[],
): StoreChip[] {
  const open = items.filter((i) => i.status === 'open');
  const chips: StoreChip[] = [{ filter: 'all', label: 'All', count: open.length }];
  for (const s of [...stores].sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b))) {
    const count = open.filter((i) => i.storeId === s.id).length;
    if (count > 0) chips.push({ filter: s.id, label: s.name, count });
  }
  const none = open.filter((i) => i.storeId === null).length;
  if (none > 0 && none < open.length)
    chips.push({ filter: 'any', label: 'Any store', count: none });
  return chips;
}

export const GOT_RECENTLY_DAYS = 7;

/**
 * [MEAL-18] Got recently: the items ticked in the last 7 days, newest first. A ticked item is off the
 * list at once and stays here, with Untick, for a week.
 */
export function gotRecently(items: readonly GroceryItem[], now: number): GroceryItem[] {
  const since = now - GOT_RECENTLY_DAYS * 86_400_000;
  return items
    .filter((i) => i.status === 'ticked' && i.tickedAt && Date.parse(i.tickedAt) >= since)
    .sort((a, b) => Date.parse(b.tickedAt!) - Date.parse(a.tickedAt!));
}

export type WhyLine =
  | { kind: 'meal'; label: string }
  | { kind: 'ask'; member: Person | null }
  | { kind: 'staple' }
  | { kind: 'added'; who: string };

/**
 * Why an item is on the list, a line per way it came, in the order they came: each meal once, each
 * child who asked, a staple, and who added it (once each).
 */
/** [MEAL-18] How many are on the list, in words: "19 to get", or "Nothing to get". */
export function toGet(n: number): string {
  return n === 0 ? 'Nothing to get' : `${n} to get`;
}

export function whyLines(item: GroceryItem, people: readonly Person[]): WhyLine[] {
  const lines: WhyLine[] = [];
  const seen = new Set<string>();
  const once = (k: string, line: WhyLine) => {
    if (seen.has(k)) return;
    seen.add(k);
    lines.push(line);
  };
  for (const r of [...item.reasons].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (r.kind === 'meal') once(`meal:${r.label}`, { kind: 'meal', label: r.label ?? 'A meal' });
    else if (r.kind === 'ask') {
      const m = people.find((p) => p.id === r.memberId) ?? null;
      once(`ask:${r.memberId}`, { kind: 'ask', member: m });
    } else if (r.kind === 'staple') once('staple', { kind: 'staple' });
    else {
      const who =
        people.find((p) => p.userId !== null && p.userId === r.byUser)?.name ??
        people.find((p) => p.id === r.memberId)?.name ??
        'An admin';
      once(`added:${who}`, { kind: 'added', who });
    }
  }
  return lines;
}

/** The meals an item is for, by name ("Tacos, Chili"), as the board says it. */
export function forMeals(item: GroceryItem): string | null {
  const names = [
    ...new Set(
      item.reasons.filter((r) => r.kind === 'meal' && r.label).map((r) => r.label!.split(',')[0]!),
    ),
  ];
  return names.length > 0 ? names.join(', ') : null;
}

// ---------------------------------------------------------------------------------------------
// [MEAL-24] The suggestion
// ---------------------------------------------------------------------------------------------

export interface PastItem {
  key: string;
  categoryId: string;
  storeId: string | null;
  /** [MEAL-29] The brand it had (WP-116). */
  brandId?: string | null;
  createdAt: string;
}

export interface LearnedWord {
  word: string;
  categoryId: string;
  weight: number;
}

export interface SuggestContext {
  categories: readonly GroceryCategory[];
  /** Items the household has had, any status. */
  past: readonly PastItem[];
  learned: readonly LearnedWord[];
  /** The starter list: an item key → a starter category's key (`grocery-starter.ts`). */
  starter?: ReadonlyMap<string, string> | null;
  /** [MEAL-28] The household's preferred store (New items go to); none is Any store. */
  preferredStoreId?: string | null;
  /** [MEAL-29] The household's brands, archived ones too (WP-116). */
  brands?: readonly GroceryBrand[];
}

export interface Suggestion {
  categoryId: string;
  storeId: string | null;
  from: 'last' | 'learned' | 'starter' | 'other';
  /** [MEAL-28] Where the store came from: last time's, the preferred store, or none (Any store). */
  storeFrom: 'last' | 'preferred' | 'any';
  /** [MEAL-29] The brand it had last time, if that brand is still offered; else none (D-148). */
  brandId: string | null;
}

/** The words of a key, longest phrase first: "greek yogurt" → "greek yogurt", "yogurt", "greek". */
function phrases(key: string): string[] {
  const words = key.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let n = words.length; n >= 1; n -= 1) {
    // Phrases ending on the last word (the thing itself) come first at each length.
    for (let i = words.length - n; i >= 0; i -= 1) out.push(words.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * [MEAL-24][MEAL-28] The category and store suggested for an item typed without one. The category:
 * the one it had last time; else the one the household's own words point to (learned from its
 * moves); else the starter list's; else Other. A starter category the household renamed is still
 * found by its key; one it removed gives Other. The store (D-142): the store it had last time; else
 * the household's preferred store; else Any store. An item last had with no store, or at a store
 * since removed (its store is cleared then), takes the preferred store.
 */
export function suggest(text: string, ctx: SuggestContext): Suggestion | null {
  const s = suggestCategory(text, ctx);
  if (!s) return null;
  const preferred = ctx.preferredStoreId ?? null;
  const brandId = lastBrand(text, ctx);
  return s.storeId
    ? { ...s, storeFrom: 'last', brandId }
    : { ...s, storeId: preferred, storeFrom: preferred ? 'preferred' : 'any', brandId };
}

/**
 * [MEAL-29] The brand an item had the last time it was on the list (D-148, as the store, D-142): the
 * latest item of the same thing, if it had a brand and that brand is not archived; else none. A
 * brand merged into another is that other one by then (the merge moved its items).
 */
export function lastBrand(text: string, ctx: Pick<SuggestContext, 'past' | 'brands'>): string | null {
  const key = itemKey(text);
  if (!key || !ctx.brands) return null;
  const last = ctx.past
    .filter((p) => p.key === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const brand = last?.brandId ? ctx.brands.find((b) => b.id === last.brandId) : undefined;
  return brand && !brand.archived ? brand.id : null;
}

function suggestCategory(
  text: string,
  ctx: SuggestContext,
): Omit<Suggestion, 'storeFrom' | 'brandId'> | null {
  const key = itemKey(text);
  const other = ctx.categories.find((c) => c.isOther);
  if (!key || !other) return null;
  const live = new Set(ctx.categories.map((c) => c.id));
  const last = ctx.past
    .filter((p) => p.key === key && live.has(p.categoryId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (last) return { categoryId: last.categoryId, storeId: last.storeId, from: 'last' };

  const words = key.split(' ');
  const score = new Map<string, number>();
  for (const w of ctx.learned) {
    if (!live.has(w.categoryId) || !words.includes(w.word)) continue;
    // The thing itself (the last word) counts most.
    const k = w.word === words[words.length - 1] ? 2 : 1;
    score.set(w.categoryId, (score.get(w.categoryId) ?? 0) + w.weight * k);
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return { categoryId: best[0], storeId: null, from: 'learned' };

  if (ctx.starter) {
    // A frozen or canned thing goes with the frozen or the pantry, whatever it is.
    const kind = words.includes('frozen')
      ? 'frozen'
      : words.includes('canned') || words.includes('tinned')
        ? 'pantry'
        : null;
    const aisle = kind && ctx.categories.find((x) => x.starterKey === kind);
    if (aisle) return { categoryId: aisle.id, storeId: null, from: 'starter' };
    for (const p of phrases(key)) {
      const starterKey = ctx.starter.get(p);
      if (!starterKey) continue;
      const c = ctx.categories.find((x) => x.starterKey === starterKey);
      if (c) return { categoryId: c.id, storeId: null, from: 'starter' };
      break;
    }
  }
  return { categoryId: other.id, storeId: null, from: 'other' };
}

// ---------------------------------------------------------------------------------------------
// [MEAL-27] Home's Groceries card (WP-112): its count and its lines
// ---------------------------------------------------------------------------------------------

/** [MEAL-27] How many are on the list, as Home's card says it: "8 on the list", "Nothing on the list". */
export function onTheList(n: number): string {
  return n === 0 ? 'Nothing on the list' : `${n} on the list`;
}

/**
 * [MEAL-27][MEAL-28] Where an item typed on Home goes: its category, then its store and why
 * ("Kroger, where it went last time", "Costco, your preferred store", "Any store").
 */
export function whereLine(
  s: Suggestion,
  categories: readonly GroceryCategory[],
  stores: readonly GroceryStore[],
): { category: string; store: string } {
  const category = categories.find((c) => c.id === s.categoryId)?.name ?? 'Other';
  const name = stores.find((x) => x.id === s.storeId)?.name;
  const store = !name
    ? 'Any store'
    : s.storeFrom === 'last'
      ? `${name}, where it went last time`
      : `${name}, your preferred store`;
  return { category, store };
}

/**
 * [MEAL-27] For something already on the list, what the card says before Add: the open item as the
 * list has it ("Onions ×3") and what adding makes, by the one merge ("×4"); null when adding
 * changes no amount. Null when it isn't on the list.
 */
export function alreadyLine(
  typed: string,
  open: readonly GroceryItem[],
  brands: readonly GroceryBrand[] = [],
): { item: GroceryItem; has: string; are: boolean; makes: string | null } | null {
  const key = itemKey(typed);
  if (!key) return null;
  const item = open.find((o) => o.status === 'open' && itemKey(o.name) === key);
  if (!item) return null;
  const now = itemAmount(item);
  const makes = combineAmounts([now, parseItem(typed).amount]);
  // [MEAL-29] With its brand: "Milk · Kirkland ×2".
  const named = withBrand(item.name, brandOf(item.brandId, brands));
  return {
    item,
    has: now ? `${named} ${now}` : named,
    // "Onions ×3 are"; "Ground beef 2 lb is", "Milk is".
    are: !!now && now.startsWith('×'),
    makes: makes !== now ? makes : null,
  };
}

/**
 * [MEAL-27][MEAL-29] After Add: "Added Ground beef 2 lb to Meat & Seafood.", the item as the list
 * now has it (`what`, said in bold), with its brand ("Milk · Kirkland ×2"), and its category.
 */
export function addedLine(
  name: string,
  amount: string | null,
  category: string,
  brand: string | null = null,
): { what: string; category: string; text: string } {
  const named = withBrand(name, brand);
  const what = amount ? `${named} ${amount}` : named;
  return { what, category, text: `Added ${what} to ${category}.` };
}
