import { describe, expect, it } from 'vitest';
import { amountOf, combineAmounts, itemKey, makeItOne, parseItem, singular } from './grocery-merge';

describe('the one merge', () => {
  it('[MEAL-20-a] "Onions", "onion", "2 onions" and "ONIONS ×2" are one thing', () => {
    const keys = ['Onions', 'onion', '2 onions', 'ONIONS ×2', '  onions  x 2 '].map(itemKey);
    expect(new Set(keys)).toEqual(new Set(['onion']));
    expect(itemKey('Paper   towels')).toBe('paper towel');
    expect(itemKey('Tomatoes')).toBe(itemKey('tomato'));
    expect(itemKey('Strawberries')).toBe(itemKey('strawberry'));
    expect(itemKey('Cookies')).toBe('cookie');
  });

  it('[MEAL-20-a] hummus, couscous and asparagus keep their s', () => {
    expect(['hummus', 'couscous', 'asparagus', 'Swiss', 'molasses'].map(singular)).toEqual([
      'hummus',
      'couscous',
      'asparagus',
      'swiss',
      'molasses',
    ]);
    expect(itemKey('Hummus')).not.toBe(itemKey('Hummu'));
  });

  it('[MEAL-20-b] counts add, the same unit adds, different units sit side by side', () => {
    expect(combineAmounts(['2', '1'])).toBe('×3');
    expect(combineAmounts(['×2', '1'])).toBe('×3');
    expect(combineAmounts(['1 lb', '1 lb'])).toBe('2 lb');
    expect(combineAmounts(['1 lb', '1 pound'])).toBe('2 lb');
    expect(combineAmounts(['1 lb', '500 g'])).toBe('1 lb + 500 g');
    expect(combineAmounts(['1 can', '1 can'])).toBe('2 cans');
    expect(combineAmounts(['1 dozen', '×6'])).toBe('1 dozen + ×6');
  });

  it('[MEAL-20-b] no amount takes the other’s, and a lone one says nothing', () => {
    expect(combineAmounts([null, '×2'])).toBe('×2');
    expect(combineAmounts([null, null])).toBeNull();
    expect(combineAmounts(['1'])).toBeNull();
    expect(combineAmounts(['some', 'Some', '×2'])).toBe('some + ×2');
  });

  it('[MEAL-20-c] "Milk", "milk 2%" and "oat milk" are never merged by themselves', () => {
    expect(new Set(['Milk', 'milk 2%', 'oat milk'].map(itemKey)).size).toBe(3);
  });

  it('[MEAL-20-c] a name that contains an open one, or is contained by it, offers Make it one', () => {
    const open = [{ name: 'Milk' }, { name: 'Greek yogurt' }, { name: 'Oat milk' }];
    expect(makeItOne('milk 2%', open).map((o) => o.name)).toEqual(['Milk']);
    expect(makeItOne('greek yog', open)).toEqual([]);
    expect(makeItOne('yogurt', open).map((o) => o.name)).toEqual(['Greek yogurt']);
    expect(makeItOne('Milk', open).map((o) => o.name)).toEqual(['Oat milk']);
    expect(makeItOne('milk', [{ name: 'Milk' }])).toEqual([]);
  });

  it('[MEAL-19-d] taking a meal’s share off recomputes the amount from the reasons left', () => {
    const reasons = [
      { meal: 'Tacos', amount: '1' },
      { meal: 'Chili', amount: '2' },
    ];
    expect(combineAmounts(reasons.map((r) => r.amount))).toBe('×3');
    expect(combineAmounts(reasons.filter((r) => r.meal !== 'Tacos').map((r) => r.amount))).toBe(
      '×2',
    );
    expect(combineAmounts(['1 lb', '1 lb'].slice(1))).toBe('1 lb');
  });
});

describe('reading an item as typed', () => {
  it('[MEAL-20-b] takes the amount off before or after the name', () => {
    expect(parseItem('2 lb ground beef')).toEqual({ name: 'Ground beef', amount: '2 lb' });
    expect(parseItem('8 tortillas')).toEqual({ name: 'Tortillas', amount: '×8' });
    expect(parseItem('Onions ×3')).toEqual({ name: 'Onions', amount: '×3' });
    expect(parseItem('onions x3')).toEqual({ name: 'Onions', amount: '×3' });
    expect(parseItem('Ground beef 2 lb')).toEqual({ name: 'Ground beef', amount: '2 lb' });
    expect(parseItem('1 dozen eggs')).toEqual({ name: 'Eggs', amount: '1 dozen' });
    expect(parseItem('2 cans of kidney beans')).toEqual({ name: 'Kidney beans', amount: '2 cans' });
    expect(parseItem('1 1/2 lb ham')).toEqual({ name: 'Ham', amount: '1.5 lb' });
    expect(parseItem('milk 2%')).toEqual({ name: 'Milk 2%', amount: null });
    expect(parseItem('greek yogurt')).toEqual({ name: 'Greek yogurt', amount: null });
    expect(parseItem('7up')).toEqual({ name: '7up', amount: null });
  });

  it('[MEAL-20-b] reads amounts as counts, units or words', () => {
    expect(amountOf('×3')).toEqual({ qty: 3, unit: null, text: null });
    expect(amountOf('2 lbs')).toEqual({ qty: 2, unit: 'lb', text: null });
    expect(amountOf('½ gallon')).toEqual({ qty: 0.5, unit: 'gal', text: null });
    expect(amountOf('a few')).toEqual({ qty: null, unit: null, text: 'a few' });
    expect(amountOf('  ')).toBeNull();
  });
});
