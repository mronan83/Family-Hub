import { describe, expect, it } from 'vitest';
import {
  brandKey,
  brandOffers,
  type GroceryBrand,
  mergeTarget,
  resolveBrand,
  withBrand,
} from './grocery-brands';
import { addedLine, alreadyLine, type GroceryItem, lastBrand, suggest } from './groceries';

// [MEAL-29] Grocery brands (WP-116, D-148): the type-ahead, the brand filled in, and the words.

const b = (id: string, name: string, archived = false): GroceryBrand => ({ id, name, archived });
const BRANDS = [
  b('kirk', 'Kirkland'),
  b('sig', 'Kirkland Signature'),
  b('fair', 'Fairlife'),
  b('jif', 'Jif'),
  b('dave', "Dave's Killer Bread"),
  b('hor', 'Horizon', true),
];
const names = (x: GroceryBrand[]) => x.map((y) => y.name);

describe('the type-ahead', () => {
  it('[MEAL-29-f] matches ignoring case and spacing, those starting with it first, then those holding it', () => {
    expect(brandKey('  Kirk  Land ')).toBe('kirkland');
    expect(names(brandOffers('kirk', BRANDS).matches)).toEqual(['Kirkland', 'Kirkland Signature']);
    expect(names(brandOffers('KIRK LAND', BRANDS).matches)).toEqual([
      'Kirkland',
      'Kirkland Signature',
    ]);
    // "life" is held by Fairlife, not at its start; "ki" starts two and is held by one, after them.
    expect(names(brandOffers('life', BRANDS).matches)).toEqual(['Fairlife']);
    expect(names(brandOffers('ki', BRANDS).matches)).toEqual([
      'Kirkland',
      'Kirkland Signature',
      "Dave's Killer Bread",
    ]);
  });

  it('[MEAL-29-f] the exact brand comes first, and up to six are offered', () => {
    const many = Array.from({ length: 9 }, (_, i) => b(`k${i}`, `Kirkland ${i}`));
    const o = brandOffers('kirkland', [...many, ...BRANDS]);
    expect(o.matches).toHaveLength(6);
    expect(o.matches[0]!.name).toBe('Kirkland');
    expect(o.exact?.id).toBe('kirk');
  });

  it('[MEAL-29-f] archived brands are never offered', () => {
    expect(brandOffers('hor', BRANDS).matches).toEqual([]);
  });

  it('[MEAL-29-f] Add "<typed>" only when no brand is the one typed, tidied; nothing typed offers nothing', () => {
    expect(brandOffers('kirk', BRANDS).add).toBe('kirk');
    expect(brandOffers('  La   Croix ', BRANDS).add).toBe('La Croix');
    expect(brandOffers('kirk land', BRANDS).add).toBeNull();
    expect(brandOffers('   ', BRANDS)).toEqual({ matches: [], exact: null, add: null });
  });

  it('[MEAL-29-f] the brand typed is a saved one (archived too) or a new name; empty is none', () => {
    expect(resolveBrand('KIRKLAND', BRANDS)).toEqual({ id: 'kirk', name: 'Kirkland' });
    expect(resolveBrand('horizon', BRANDS)).toEqual({ id: 'hor', name: 'Horizon' });
    expect(resolveBrand(' La  Croix', BRANDS)).toEqual({ id: null, name: 'La Croix' });
    expect(resolveBrand('', BRANDS)).toEqual({ id: null, name: null });
  });
});

const ctx = {
  categories: [
    { id: 'o', name: 'Other', icon: 'package', starterKey: 'other', isOther: true, sortOrder: 9 },
  ],
  learned: [],
  brands: BRANDS,
};

describe('the brand filled in', () => {
  it('[MEAL-29-g] the brand the item had the last time it was on the list', () => {
    const past = [
      { key: 'milk', categoryId: 'o', storeId: null, brandId: 'fair', createdAt: '2026-10-01' },
      { key: 'milk', categoryId: 'o', storeId: null, brandId: 'kirk', createdAt: '2026-10-20' },
    ];
    expect(lastBrand('2 milk', { ...ctx, past })).toBe('kirk');
    expect(suggest('milk', { ...ctx, past })?.brandId).toBe('kirk');
  });

  it('[MEAL-29-g] none when that time had none, its brand is archived, or it is new', () => {
    const past = [
      { key: 'milk', categoryId: 'o', storeId: null, brandId: 'kirk', createdAt: '2026-10-01' },
      { key: 'milk', categoryId: 'o', storeId: null, brandId: null, createdAt: '2026-10-20' },
      { key: 'eggs', categoryId: 'o', storeId: null, brandId: 'hor', createdAt: '2026-10-20' },
    ];
    expect(lastBrand('milk', { ...ctx, past })).toBeNull();
    expect(lastBrand('eggs', { ...ctx, past })).toBeNull();
    expect(lastBrand('kombucha', { ...ctx, past })).toBeNull();
    expect(suggest('kombucha', { ...ctx, past })?.brandId).toBeNull();
  });
});

describe('an item with its brand', () => {
  const milk: GroceryItem = {
    id: 'm',
    name: 'Milk',
    amount: null,
    categoryId: 'o',
    storeId: null,
    brandId: 'kirk',
    status: 'open',
    tickedAt: null,
    tickedBy: null,
    createdAt: '',
    reasons: [
      {
        kind: 'added',
        byUser: null,
        memberId: null,
        mealPlanEntryId: null,
        label: null,
        amount: '×2',
        createdAt: '',
      },
    ],
  };

  it('[MEAL-29-h] reads "Milk · Kirkland", and alone when it has none', () => {
    expect(withBrand('Milk', 'Kirkland')).toBe('Milk · Kirkland');
    expect(withBrand('Milk', null)).toBe('Milk');
  });

  it('[MEAL-29-h] Home’s lines name the brand', () => {
    expect(alreadyLine('1 milk', [milk], BRANDS)?.has).toBe('Milk · Kirkland ×2');
    expect(addedLine('Milk', '×3', 'Dairy & Eggs', 'Kirkland').text).toBe(
      'Added Milk · Kirkland ×3 to Dairy & Eggs.',
    );
    expect(addedLine('Milk', null, 'Dairy & Eggs').text).toBe('Added Milk to Dairy & Eggs.');
  });

  it('[MEAL-29-h] Merge into… picks the closest name first, else the first A to Z', () => {
    expect(mergeTarget(BRANDS[1]!, BRANDS)).toBe('kirk');
    expect(mergeTarget(BRANDS[0]!, BRANDS)).toBe('sig');
    expect(mergeTarget(BRANDS[3]!, BRANDS)).toBe('dave');
    expect(mergeTarget(BRANDS[0]!, [BRANDS[0]!])).toBeNull();
  });
});
