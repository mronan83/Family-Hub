import { describe, expect, it } from 'vitest';
import { pictureOf, readGroceries, withGroceries } from './board-groceries';
import { readIngredients } from './meals';

describe('groceries on the board', () => {
  it('[MEAL-18] reads board_groceries(), skipping what it can’t read', () => {
    const g = readGroceries({
      ever: true,
      categories: [
        {
          id: 'c1',
          name: 'Produce',
          icon: 'carrot',
          starter_key: 'produce',
          is_other: false,
          sort_order: 1,
        },
        { name: 'no id' },
      ],
      stores: [{ id: 's1', name: 'Aldi', sort_order: 3 }],
      items: [
        {
          id: 'i1',
          name: 'Onions',
          amount: null,
          category_id: 'c1',
          store_id: null,
          reasons: [{ kind: 'meal', label: 'Tacos, Tue', amount: '1' }, { kind: 'weird' }],
        },
        { id: 'i2' },
      ],
    });
    expect(g?.categories.map((c) => c.name)).toEqual(['Produce']);
    expect(g?.items).toHaveLength(1);
    expect(g?.items[0]!.reasons.map((r) => r.kind)).toEqual(['meal', 'added']);
    expect(readGroceries(null)).toBeNull();
    expect(readGroceries({ ever: false, items: [] })?.ever).toBe(false);
  });

  it('[MEAL-18] rides with the snapshot, and only beside one', () => {
    expect(withGroceries({ v: 1 }, { ever: true })).toEqual({ v: 1, groceries: { ever: true } });
    expect(withGroceries({ v: 1 }, null)).toEqual({ v: 1 });
    expect(withGroceries(null, { ever: true })).toBeNull();
  });

  it('[MEAL-18] a picture where one fits, else the category’s', () => {
    const produce = {
      id: 'c1',
      name: 'Produce',
      icon: 'carrot',
      starterKey: 'produce',
      isOther: false,
      sortOrder: 1,
    };
    expect(pictureOf('Apples', produce)).toBe('apple');
    expect(pictureOf('Greek yogurt', produce)).toBe('milk');
    expect(pictureOf('Kohlrabi', produce)).toBe('carrot');
    expect(pictureOf('Mystery', undefined)).toBe('shopping-cart');
  });

  it('[MEAL-07] a meal’s ingredients read safely: named rows, an amount or none, at most 60', () => {
    expect(
      readIngredients([
        { name: ' Onion ', amount: ' 1 ' },
        { name: '' },
        'x',
        { name: 'Salt', have: true },
      ]),
    ).toEqual([
      { name: 'Onion', amount: '1', have: false },
      { name: 'Salt', amount: null, have: true },
    ]);
    expect(readIngredients(Array.from({ length: 70 }, (_, i) => ({ name: `T${i}` })))).toHaveLength(
      60,
    );
    expect(readIngredients(null)).toEqual([]);
  });
});
