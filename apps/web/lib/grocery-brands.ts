// [MEAL-29] Grocery brands (WP-116, D-148): the household's own list of brands, the type-ahead that
// finds one as it is typed, the brand an item had last time, and how an item reads with its brand
// ("Milk · Kirkland"). Pure: no I/O.

export interface GroceryBrand {
  id: string;
  name: string;
  /** Archived: kept on the items that have it, never offered or pre-filled. */
  archived: boolean;
}

/**
 * [MEAL-29] A brand's key, as the database's `grocery_brand_key()`: its name ignoring case and
 * spacing, so "Kirkland", "kirkland" and "Kirk land" are one brand.
 */
export function brandKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** A brand name as typed, tidied: spaces trimmed and runs of them made one. */
export function brandName(typed: string): string {
  return typed.replace(/\s+/g, ' ').trim();
}

export const BRAND_MAX = 40;
export const BRAND_OFFERS = 6;

export interface BrandOffers {
  /** The household's brands that match, the closest first. */
  matches: GroceryBrand[];
  /** The brand typed exactly (ignoring case and spacing), if there is one. */
  exact: GroceryBrand | null;
  /** What "Add "…"" would save, when nothing matches exactly; null otherwise. */
  add: string | null;
}

/**
 * [MEAL-29] The type-ahead's offers for what is typed: the household's brands (not archived) whose
 * key starts with the typed key, then those that hold it, each A to Z, up to six; and, when none is
 * the typed brand exactly, Add "<typed>". Nothing typed offers nothing (no brand).
 */
export function brandOffers(
  typed: string,
  brands: readonly GroceryBrand[],
  limit = BRAND_OFFERS,
): BrandOffers {
  const key = brandKey(typed);
  if (!key) return { matches: [], exact: null, add: null };
  const live = brands.filter((b) => !b.archived);
  const byName = (a: GroceryBrand, b: GroceryBrand) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const exact = live.find((b) => brandKey(b.name) === key) ?? null;
  const starts = live.filter((b) => brandKey(b.name).startsWith(key)).sort(byName);
  const holds = live
    .filter((b) => !brandKey(b.name).startsWith(key) && brandKey(b.name).includes(key))
    .sort(byName);
  const matches = [...(exact ? [exact] : []), ...starts, ...holds]
    .filter((b, i, all) => all.indexOf(b) === i)
    .slice(0, limit);
  const name = brandName(typed).slice(0, BRAND_MAX);
  return { matches, exact, add: exact ? null : name };
}

/**
 * [MEAL-29] The brand typed, as a saved brand of the household when it is one (an archived one
 * too: adding it again brings it back, D-148), or a new name to save.
 */
export function resolveBrand(
  typed: string,
  brands: readonly GroceryBrand[],
): { id: string | null; name: string | null } {
  const key = brandKey(typed);
  if (!key) return { id: null, name: null };
  const known = brands.find((b) => brandKey(b.name) === key);
  return known ? { id: known.id, name: known.name } : { id: null, name: brandName(typed) };
}

/** [MEAL-29] An item's name with its brand, as every list shows it: "Milk · Kirkland". */
export function withBrand(name: string, brand: string | null | undefined): string {
  return brand ? `${name} · ${brand}` : name;
}

/** The name of an item's brand, archived ones too (an item keeps its brand). */
export function brandOf(
  brandId: string | null | undefined,
  brands: readonly GroceryBrand[],
): string | null {
  return brandId ? (brands.find((b) => b.id === brandId)?.name ?? null) : null;
}

/** [MEAL-29] How many items a brand is on, in words, for the Brands list. */
export function brandUse(open: number): string {
  return open === 0 ? 'None on the list' : `${open} on the list`;
}

/**
 * [MEAL-29] The brand Merge into… picks first for a brand: the closest by name, one whose key starts
 * the other's ("Kirkland" for "Kirkland Signature"), the longest such; else the first A to Z.
 */
export function mergeTarget(from: GroceryBrand, brands: readonly GroceryBrand[]): string | null {
  const key = brandKey(from.name);
  const others = brands
    .filter((b) => !b.archived && b.id !== from.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const near = others
    .filter((b) => key.startsWith(brandKey(b.name)) || brandKey(b.name).startsWith(key))
    .sort((a, b) => brandKey(b.name).length - brandKey(a.name).length);
  return (near[0] ?? others[0])?.id ?? null;
}
