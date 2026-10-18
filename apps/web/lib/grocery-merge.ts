// [MEAL-20] The one merge (WP-105, D-138 (5)): every way onto the grocery list reads an item the same
// way, gives it the same key, and adds amounts the same way. Pure: no I/O, no clock. The database's
// one way in (add_groceries()) joins an add to the open item with the same key; the amount shown is
// the item's own amount and its reasons' amounts, combined here.

/** An amount as read: a count ("×3", "3"), a quantity of a unit ("2 lb", "1 dozen"), or words. */
export interface Amount {
  qty: number | null;
  /** Its unit, as written once (lb, oz, can, dozen, …); null for a count. */
  unit: string | null;
  /** What was typed, for an amount that isn't a number ("some", "a few"). */
  text: string | null;
}

// Units an amount to buy is counted in, each with the words that mean it.
const UNITS: Record<string, readonly string[]> = {
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  oz: ['oz', 'ounce', 'ounces'],
  g: ['g', 'gram', 'grams'],
  kg: ['kg', 'kgs', 'kilo', 'kilos'],
  ml: ['ml'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  gal: ['gal', 'gallon', 'gallons'],
  qt: ['qt', 'quart', 'quarts'],
  pt: ['pt', 'pint', 'pints'],
  dozen: ['dozen', 'doz'],
  can: ['can', 'cans', 'tin', 'tins'],
  jar: ['jar', 'jars'],
  bag: ['bag', 'bags'],
  box: ['box', 'boxes'],
  bottle: ['bottle', 'bottles'],
  pack: ['pack', 'packs', 'package', 'packages', 'pkg'],
  bunch: ['bunch', 'bunches'],
  head: ['head', 'heads'],
  loaf: ['loaf', 'loaves'],
  carton: ['carton', 'cartons'],
  tub: ['tub', 'tubs'],
};
const UNIT_OF = new Map(Object.entries(UNITS).flatMap(([u, words]) => words.map((w) => [w, u])));
// Units said with an s when there is more than one.
const PLURAL: Record<string, string> = {
  can: 'cans',
  jar: 'jars',
  bag: 'bags',
  box: 'boxes',
  bottle: 'bottles',
  pack: 'packs',
  bunch: 'bunches',
  head: 'heads',
  loaf: 'loaves',
  carton: 'cartons',
  tub: 'tubs',
};

const NUMBER = String.raw`\d+\s+\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d+(?:[.,]\d+)?|½|¼|¾`;

/** "1/2", "1 1/2", "1.5", "½" as a number; null when it isn't one. */
export function numberOf(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '½') return 0.5;
  if (t === '¼') return 0.25;
  if (t === '¾') return 0.75;
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** An amount as typed ("×3", "x 3", "3", "2 lb", "2 cans", "some"); null when empty. */
export function amountOf(text: string | null | undefined): Amount | null {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const count = new RegExp(`^(?:[×x]\\s*)?(${NUMBER})$`, 'i').exec(t);
  if (count) {
    const q = numberOf(count[1]!);
    if (q !== null) return { qty: q, unit: null, text: null };
  }
  const withUnit = new RegExp(`^(${NUMBER})\\s*([a-z]+)\\.?$`, 'i').exec(t);
  if (withUnit) {
    const q = numberOf(withUnit[1]!);
    const unit = UNIT_OF.get(withUnit[2]!.toLowerCase());
    if (q !== null && unit) return { qty: q, unit, text: null };
  }
  return { qty: null, unit: null, text: t };
}

const show = (n: number) => String(Math.round(n * 100) / 100);

/** An amount as it reads: "×3", "2 lb", "2 cans", "1 dozen", or its words. */
export function amountWords(a: Amount): string {
  if (a.qty === null) return a.text ?? '';
  if (a.unit === null) return `×${show(a.qty)}`;
  const unit = a.qty > 1 ? (PLURAL[a.unit] ?? a.unit) : a.unit;
  return `${show(a.qty)} ${unit}`;
}

/**
 * [MEAL-20] Amounts combined: counts add, the same unit adds, different units sit side by side
 * ("1 lb + 500 g"), words are kept once each, and no amount takes the others'. A lone count of one
 * says nothing ("Lettuce", not "Lettuce ×1"). Null when there is none.
 */
export function combineAmounts(amounts: readonly (string | null | undefined)[]): string | null {
  const totals = new Map<string, Amount>();
  for (const raw of amounts) {
    const a = amountOf(raw);
    if (!a) continue;
    const k = a.qty === null ? `text:${a.text!.toLowerCase()}` : `unit:${a.unit ?? ''}`;
    const had = totals.get(k);
    if (!had) totals.set(k, { ...a });
    else if (had.qty !== null && a.qty !== null) had.qty += a.qty;
  }
  const parts = [...totals.values()];
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0]!.unit === null && parts[0]!.qty === 1) return null;
  return parts.map(amountWords).join(' + ');
}

/**
 * [MEAL-20] An item as typed: its name, and the amount before or after it ("2 lb ground beef",
 * "8 tortillas", "Onions ×3", "Ground beef 2 lb"). The name's first letter is made a capital.
 */
export function parseItem(text: string): { name: string; amount: string | null } {
  let t = text.trim().replace(/\s+/g, ' ');
  let amount: string | null = null;
  const unitWords = [...UNIT_OF.keys()].sort((a, b) => b.length - a.length).join('|');
  const before = new RegExp(
    `^(${NUMBER})(?:\\s*(${unitWords})\\.?\\s+(?:of\\s+)?|\\s+)(.+)$`,
    'i',
  ).exec(t);
  const after = new RegExp(
    `^(.+?)\\s+(?:[×x]\\s*(${NUMBER})|(${NUMBER})\\s*(${unitWords})?\\.?)$`,
    'i',
  ).exec(t);
  if (before && numberOf(before[1]!) !== null && /[a-z]/i.test(before[3]!)) {
    amount = before[2] ? `${before[1]} ${before[2]}` : before[1]!;
    t = before[3]!;
  } else if (after && /[a-z]/i.test(after[1]!) && !/%$/.test(t)) {
    amount = after[2] ? `×${after[2]}` : after[4] ? `${after[3]} ${after[4]}` : after[3]!;
    t = after[1]!;
  }
  const a = amountOf(amount);
  const name = t.replace(/^[-–•*]\s*/, '').trim();
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    amount: a ? amountWords(a) : null,
  };
}

// Words that keep their s, and words whose "ies" is "ie".
const KEEP_S = new Set([
  'hummus',
  'couscous',
  'asparagus',
  'molasses',
  'swiss',
  'grits',
  'citrus',
  'bus',
]);
const IE = new Set(['cookie', 'brownie', 'smoothie', 'veggie', 'pie', 'calorie', 'movie']);

/** A word with its plural set aside: onions → onion, tomatoes → tomato, berries → berry. */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3 || KEEP_S.has(w) || /(ss|us|is)$/.test(w) || !w.endsWith('s')) return w;
  if (w.endsWith('ies')) return IE.has(w.slice(0, -1)) ? w.slice(0, -1) : `${w.slice(0, -3)}y`;
  if (w.endsWith('es') && /(s|x|z|ch|sh|o)$/.test(w.slice(0, -2))) return w.slice(0, -2);
  return w.slice(0, -1);
}

/**
 * [MEAL-20] The key two names merge by: the same once capitals, spaces, a trailing plural and the
 * amount are set aside. "Onions", "onion", "2 onions" and "ONIONS ×2" share one; "milk 2%" and
 * "oat milk" are other things.
 */
export function itemKey(text: string): string {
  const words = parseItem(text)
    .name.toLowerCase()
    .replace(/[^\p{L}\p{N}%&' ]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return '';
  words[words.length - 1] = singular(words[words.length - 1]!);
  return words.join(' ');
}

/**
 * [MEAL-20] "Make it one": open items a new name contains, or that contain it ("milk 2%" while
 * "Milk" is on). Never the same key: that one merges by itself.
 */
export function makeItOne<T extends { name: string }>(name: string, open: readonly T[]): T[] {
  const key = itemKey(name);
  if (!key) return [];
  const mine = key.split(' ');
  const has = (outer: string[], inner: string[]) =>
    outer.length > inner.length && outer.some((_, i) => inner.every((w, j) => outer[i + j] === w));
  return open.filter((o) => {
    const k = itemKey(o.name);
    if (!k || k === key) return false;
    const theirs = k.split(' ');
    return has(mine, theirs) || has(theirs, mine);
  });
}
