import { describe, expect, it } from 'vitest';
import type { LunchDay, LunchPick } from './lunch';
import { lunchFromDb } from './lunch';
import {
  comingWeek,
  cutoffWords,
  dayLine,
  entreePickWords,
  lunchAnswerWords,
  lunchRequestSchema,
  menuChanged,
  missingPicks,
  picksWords,
  samePicks,
  shownDay,
  togglePick,
} from './lunch-picks';
import { menuSections } from './menu/sections';

// A made-up school's Tuesday: two entrees (the second with a side), three fruits and two milks.
const SECTIONS = menuSections([
  { name: 'Cheese pizza', section: 'Choice of Entree', option: 1 },
  { name: 'Chicken wrap', section: 'Choice of Entree', option: 2 },
  { name: 'Tortilla chips', section: 'Choice of Entree', option: 2 },
  { name: 'Apple slices', section: 'Fruits & Vegetables offered', option: 1 },
  { name: 'Baby carrots', section: 'Fruits & Vegetables offered', option: 2 },
  { name: 'Grapes', section: 'Fruits & Vegetables offered', option: 3 },
  { name: '1% milk', section: 'Choice of Milk', option: 1 },
  { name: 'Chocolate milk', section: 'Choice of Milk', option: 2 },
]);
const [ENTREE, FRUIT, MILK] = SECTIONS as [
  (typeof SECTIONS)[0],
  (typeof SECTIONS)[0],
  (typeof SECTIONS)[0],
];

const day = (over: Partial<LunchDay> = {}): LunchDay => ({
  date: '2026-10-20',
  dayType: 'school_day',
  mode: 'bring',
  changed: false,
  ...over,
});

describe('lunches picked on the board', () => {
  it('[MEAL-09][US-707] the coming week is Monday to Friday after a Sunday, this week on a weekday', () => {
    expect(comingWeek('2026-10-18')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(comingWeek('2026-10-17')[0]).toBe('2026-10-19');
    expect(comingWeek('2026-10-14')[0]).toBe('2026-10-12');
    expect(comingWeek('2026-10-14', 1)[4]).toBe('2026-10-23');
  });

  it('[MEAL-11] "Choice of" takes one option; the others any number', () => {
    let picks: LunchPick[] = [];
    picks = togglePick(picks, ENTREE, 1);
    picks = togglePick(picks, ENTREE, 2);
    expect(picks).toEqual([{ section: 'Choice of Entree', options: [2], names: ['Chicken wrap'] }]);
    picks = togglePick(picks, FRUIT, 3);
    picks = togglePick(picks, FRUIT, 1);
    expect(picks.find((p) => p.section === FRUIT.title)).toEqual({
      section: 'Fruits & Vegetables offered',
      options: [1, 3],
      names: ['Apple slices', 'Grapes'],
    });
    picks = togglePick(picks, FRUIT, 1);
    picks = togglePick(picks, FRUIT, 3);
    expect(picks.some((p) => p.section === FRUIT.title)).toBe(false);
    expect(togglePick(picks, ENTREE, 2)).toEqual([]);
    expect(togglePick(picks, ENTREE, 9)).toBe(picks);
  });

  it('[MEAL-11] says the picks in the menu order, and the entree with its sides on the home line', () => {
    const picks: LunchPick[] = [
      { section: 'Choice of Milk', options: [1], names: ['1% milk'] },
      {
        section: 'Fruits & Vegetables offered',
        options: [1, 2],
        names: ['Apple slices', 'Baby carrots'],
      },
      { section: 'Choice of Entree', options: [2], names: ['Chicken wrap'] },
    ];
    expect(picksWords(picks, SECTIONS)).toBe('Chicken wrap · Apple slices, Baby carrots · 1% milk');
    expect(entreePickWords(picks, SECTIONS)).toBe('Chicken wrap with Tortilla chips');
    expect(entreePickWords([], SECTIONS)).toBeNull();
    expect(entreePickWords(picks.slice(0, 1), SECTIONS)).toBe('1% milk');
  });

  it('[MEAL-11] a pick the menu no longer has is marked Menu changed', () => {
    const pick: LunchPick = { section: 'Choice of Entree', options: [1], names: ['Cheese pizza'] };
    expect(menuChanged([pick], SECTIONS)).toBe(false);
    expect(menuChanged([{ ...pick, names: ['Hot dog'] }], SECTIONS)).toBe(true);
    expect(menuChanged([{ ...pick, section: 'Choice of Dessert' }], SECTIONS)).toBe(true);
    expect(menuChanged([pick], null)).toBe(true);
    expect(menuChanged([], null)).toBe(false);
  });

  it('[MEAL-11] names a "Choice of" section still to pick', () => {
    expect(missingPicks([], SECTIONS)).toEqual(['Entree', 'Milk']);
    expect(missingPicks(togglePick([], MILK, 2), SECTIONS)).toEqual(['Entree']);
  });

  it('[MEAL-11] the same picks in any order are the same', () => {
    const a = togglePick(togglePick([], FRUIT, 1), FRUIT, 2);
    const b = togglePick(togglePick([], FRUIT, 2), FRUIT, 1);
    expect(samePicks(a, b)).toBe(true);
    expect(samePicks(a, togglePick(a, MILK, 1))).toBe(false);
  });

  it('[MEAL-09][US-707] a waiting change shows as asked; a kept one says who kept it', () => {
    const asked = day({
      request: {
        id: 'r1',
        mode: 'buy',
        choices: togglePick([], ENTREE, 1),
        status: 'waiting',
        requestedAt: '2026-10-18T19:04:00Z',
        decidedBy: null,
      },
    });
    expect(shownDay(asked).mode).toBe('buy');
    expect(shownDay(asked).picks).toHaveLength(1);
    expect(dayLine(asked)).toBe('Waiting for a parent');
    const kept = day({
      mode: 'buy',
      request: { ...asked.request!, status: 'kept', decidedBy: 'Sam' },
    });
    expect(shownDay(kept).mode).toBe('buy');
    expect(dayLine(kept)).toBe('Sam kept Buy');
    expect(dayLine(day())).toBeNull();
    expect(shownDay(day({ mode: 'bring', choices: null })).picks).toEqual([]);
  });

  it('[MEAL-09] reads the day from lunch_week(), anything malformed dropped', () => {
    const [c] = lunchFromDb([
      {
        member_id: 'maya',
        usual: {},
        days: [
          {
            date: '2026-10-20',
            day_type: 'school_day',
            mode: 'buy',
            changed: true,
            open: true,
            open_until: '2026-10-20T13:00:00+00:00',
            choices: [
              { section: 'Choice of Milk', options: [1], names: ['1% milk'] },
              { section: 'Bad', options: [1, 2], names: ['One'] },
            ],
            request: { id: 'r1', mode: 'buy', choices: [], status: 'waiting', requested_at: 'x' },
            by_board: true,
          },
        ],
      },
    ]);
    expect(c!.days[0]).toMatchObject({
      open: true,
      choices: [{ section: 'Choice of Milk', options: [1], names: ['1% milk'] }],
      request: { id: 'r1', status: 'waiting', decidedBy: null },
      byBoard: true,
    });
  });

  it('[MEAL-09] a board sends a day with its picks; anything else is refused', () => {
    expect(
      lunchRequestSchema.safeParse({
        member_id: '00000000-0000-4000-8000-000000000001',
        date: '2026-10-20',
        mode: 'buy',
        choices: [{ section: 'Choice of Milk', options: [1], names: ['1% milk'] }],
      }).success,
    ).toBe(true);
    expect(
      lunchRequestSchema.safeParse({
        member_id: '00000000-0000-4000-8000-000000000001',
        date: '2026-10-20',
        mode: 'buy',
        choices: [{ section: 'Choice of Milk', options: [1, 2], names: ['1% milk'] }],
      }).success,
    ).toBe(false);
    expect(
      lunchRequestSchema.safeParse({ member_id: 'x', date: 'today', mode: 'eat' }).success,
    ).toBe(false);
  });

  it('says the cut-off and a refusal in plain words', () => {
    expect(cutoffWords('08:00')).toBe('8:00 am');
    expect(cutoffWords('07:15')).toBe('7:15 am');
    expect(cutoffWords('12:30')).toBe('12:30 pm');
    expect(lunchAnswerWords('locked')).toBe('That day can’t change now.');
    expect(lunchAnswerWords('whatever')).toBe('That didn’t save. Ask a grown-up.');
  });
});
