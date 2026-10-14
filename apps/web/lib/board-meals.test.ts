import { describe, expect, it } from 'vitest';
import { dayHead, hasMeals, mealDay, noLunchReason, readMeals, weekDates } from './board-meals';

// A made-up week from Sunday, Oct 11: Ava buys Monday (her school's menu has it) and Tuesday (it has
// nothing yet), and brings Wednesday; Ben brings Monday.
const raw = {
  week_from: '2026-10-11',
  entries: [
    {
      id: 'e1',
      date: '2026-10-12',
      slot: 'breakfast',
      member_id: null,
      name: 'Porridge',
      icon: null,
      notes: null,
    },
    {
      id: 'e2',
      date: '2026-10-12',
      slot: 'snack',
      member_id: 'ava',
      name: 'Crackers',
      icon: null,
      notes: null,
    },
    {
      id: 'e3',
      date: '2026-10-12',
      slot: 'dinner',
      member_id: null,
      name: 'Tacos',
      icon: 'utensils',
      notes: 'Make extra',
    },
    {
      id: 'e4',
      date: '2026-10-12',
      slot: 'lunch',
      member_id: 'ben',
      name: 'Leftover tacos',
      icon: null,
      notes: null,
    },
    {
      id: 'e5',
      date: '2026-10-12',
      slot: 'brunch',
      member_id: null,
      name: 'Not a meal of the day',
      icon: null,
      notes: null,
    },
    {
      id: 'e6',
      date: '2026-10-13',
      slot: 'dinner',
      member_id: null,
      name: '',
      icon: null,
      notes: null,
    },
  ],
  lunch: [
    {
      member_id: 'ava',
      usual: { mon: 'buy' },
      menu_source_id: 'm1',
      days: [
        { date: '2026-10-11', day_type: 'weekend', mode: null, changed: false },
        {
          date: '2026-10-12',
          day_type: 'school_day',
          mode: 'buy',
          changed: false,
          menu: {
            items: [{ name: 'Cheese Pizza' }, { name: 'Milk' }],
            no_service: false,
            note: null,
          },
        },
        { date: '2026-10-13', day_type: 'school_day', mode: 'buy', changed: false, menu: null },
        { date: '2026-10-14', day_type: 'school_day', mode: 'bring', changed: true },
        { date: '2026-10-15', day_type: 'no_school', mode: null, changed: false },
      ],
    },
    {
      member_id: 'ben',
      usual: {},
      menu_source_id: null,
      days: [
        { date: '2026-10-11', day_type: 'weekend', mode: null, changed: false },
        { date: '2026-10-12', day_type: 'school_day', mode: 'bring', changed: false },
        { date: '2026-10-15', day_type: 'school_day', mode: 'bring', changed: false },
      ],
    },
  ],
};

describe('meals on the board', () => {
  it('[MEAL-06] reads the snapshot’s week, leaving out what it doesn’t understand', () => {
    const meals = readMeals(raw)!;
    expect(meals.weekFrom).toBe('2026-10-11');
    expect(meals.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(meals.entries[2]).toEqual({
      id: 'e3',
      date: '2026-10-12',
      slot: 'dinner',
      memberIds: [],
      name: 'Tacos',
      icon: 'utensils',
      notes: 'Make extra',
    });
    expect(meals.lunch.map((c) => c.memberId)).toEqual(['ava', 'ben']);
    // A snapshot from before WP-28 has none.
    expect(readMeals(undefined)).toBeNull();
    expect(readMeals({ entries: [] })).toBeNull();
  });

  it('[MEAL-06][US-705] a day: each meal’s entries, and each child’s lunch with the school’s menu', () => {
    const day = mealDay(readMeals(raw), '2026-10-12');
    expect(day.slots.breakfast.map((e) => e.name)).toEqual(['Porridge']);
    expect(day.slots.snack.map((e) => e.name)).toEqual(['Crackers']);
    expect(day.slots.dinner.map((e) => e.name)).toEqual(['Tacos']);
    // Ben brings his lunch: what's planned for his lunch is what he brings.
    expect(day.slots.lunch).toEqual([]);
    expect(day.lunch).toEqual([
      { memberId: 'ava', mode: 'buy', menu: 'Cheese Pizza, Milk', noMenu: false, packed: [] },
      { memberId: 'ben', mode: 'bring', menu: null, noMenu: false, packed: ['Leftover tacos'] },
    ]);
    expect(hasMeals(day)).toBe(true);
  });

  it('[MEAL-10][US-708] an entry for any mix of people; one from before WP-62 names one person', () => {
    const old = readMeals(raw)!;
    expect(old.entries.find((e) => e.name === 'Leftover tacos')!.memberIds).toEqual(['ben']);
    const lunch = (id: string, name: string, ids: unknown) => ({
      id,
      date: '2026-10-12',
      slot: 'lunch',
      member_id: null,
      member_ids: ids,
      name,
      icon: null,
      notes: null,
    });
    const meals = readMeals({
      ...raw,
      entries: [
        lunch('m1', 'Ham sandwiches', ['ben', 'dad']),
        lunch('m2', 'Soup', ['ava', 'ben']),
        lunch('m3', 'Wraps', ['ben']),
        lunch('m4', 'Salad', []),
        lunch('m5', 'Odd', ['dad', 7]),
      ],
    })!;
    expect(meals.entries.map((e) => e.memberIds)).toEqual([
      ['ben', 'dad'],
      ['ava', 'ben'],
      ['ben'],
      [],
      ['dad'],
    ]);
    // Ben brings his lunch: each one with him on it is what he brings. It stays under Lunch for the
    // others on it (Dad's sandwiches; Ava buys, but the soup names her), and goes when only he is.
    const day = mealDay(meals, '2026-10-12');
    expect(day.lunch.find((l) => l.memberId === 'ben')!.packed).toEqual([
      'Ham sandwiches',
      'Soup',
      'Wraps',
    ]);
    expect(day.slots.lunch.map((e) => [e.name, e.memberIds])).toEqual([
      ['Ham sandwiches', ['dad']],
      ['Soup', ['ava']],
      ['Salad', []],
      ['Odd', ['dad']],
    ]);
  });

  it('[MEAL-05] a buy day her school’s menu has nothing for says so; a bring day has no menu', () => {
    const meals = readMeals(raw);
    expect(mealDay(meals, '2026-10-13').lunch).toEqual([
      { memberId: 'ava', mode: 'buy', menu: null, noMenu: true, packed: [] },
    ]);
    expect(mealDay(meals, '2026-10-14').lunch[0]).toMatchObject({ mode: 'bring', noMenu: false });
  });

  it('[MEAL-06] a day with nothing planned and no school lunch shows nothing', () => {
    const day = mealDay(readMeals(raw), '2026-10-11');
    expect(hasMeals(day)).toBe(false);
    expect(hasMeals(mealDay(null, '2026-10-12'))).toBe(false);
  });

  it('[MEAL-06] why a day has no school lunch: the weekend, or no school', () => {
    const meals = readMeals(raw);
    expect(noLunchReason(meals, '2026-10-11')).toBe('Weekend');
    // Ava has no school Thursday, Ben does: someone has lunch, so no reason.
    expect(noLunchReason(meals, '2026-10-15')).toBeNull();
    expect(noLunchReason(meals, '2026-10-12')).toBeNull();
    expect(noLunchReason(null, '2026-10-12')).toBeNull();
  });

  it('[MEAL-06] the week’s days and their headings', () => {
    expect(weekDates('2026-10-11')).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
    // Over the end of daylight saving time, still a day a column.
    expect(weekDates('2026-10-31').at(-1)).toBe('2026-11-06');
    expect(dayHead('2026-10-12')).toBe('Mon 12');
    expect(dayHead('2026-10-12', true)).toBe('Mon, Oct 12');
  });
});
