import { describe, expect, it } from 'vitest';
import type { LunchChild, LunchDay, LunchPick } from './lunch';
import { hasDaysToPick, lunchDayStatus, openOn, schoolWeek } from './lunch-list';

// [MEAL-13][US-710] A day's completeness on the lunch list (WP-74, D-98), on a made-up menu.

const MENU = {
  items: [
    { name: 'Cheese Pizza', section: 'Choice of Entree', option: 1 },
    { name: 'Turkey sandwich', section: 'Choice of Entree', option: 2 },
    { name: 'Pretzels', section: 'Choice of Entree', option: 2 },
    { name: 'Green Beans', section: 'Fruits & Vegetables offered', option: 1 },
    { name: '1% milk', section: 'Choice of Milk', option: 1 },
    { name: 'Chocolate milk', section: 'Choice of Milk', option: 2 },
  ],
  noService: false,
  note: null,
};
const ENTREE: LunchPick = { section: 'Choice of Entree', options: [2], names: ['Turkey sandwich'] };
const MILK: LunchPick = { section: 'Choice of Milk', options: [1], names: ['1% milk'] };
const FRUIT: LunchPick = {
  section: 'Fruits & Vegetables offered',
  options: [1],
  names: ['Green Beans'],
};

const day = (o: Partial<LunchDay> = {}): LunchDay => ({
  date: '2026-10-14',
  dayType: 'school_day',
  mode: 'buy',
  changed: false,
  menu: MENU,
  choices: [],
  ...o,
});

describe('[MEAL-13] lunchDayStatus', () => {
  it('a Buy day is complete with a pick in every “Choice of” section', () => {
    expect(lunchDayStatus(day({ choices: [ENTREE, MILK] }))).toBe('complete');
    expect(lunchDayStatus(day({ choices: [ENTREE, FRUIT, MILK] }))).toBe('complete');
  });

  it('a Buy day without the entree, or without the milk, is still to pick', () => {
    expect(lunchDayStatus(day({ choices: [MILK] }))).toBe('to-pick');
    expect(lunchDayStatus(day({ choices: [ENTREE] }))).toBe('to-pick');
    expect(lunchDayStatus(day({ choices: [FRUIT] }))).toBe('to-pick');
    expect(lunchDayStatus(day({ choices: [] }))).toBe('to-pick');
    expect(lunchDayStatus(day({ choices: null }))).toBe('to-pick');
    expect(lunchDayStatus(day({ choices: undefined }))).toBe('to-pick');
  });

  it('a pick the menu no longer has doesn’t count', () => {
    const gone = { ...ENTREE, names: ['Fish tacos'] };
    expect(lunchDayStatus(day({ choices: [gone, MILK] }))).toBe('to-pick');
    const past = { ...MILK, options: [3], names: ['Oat milk'] };
    expect(lunchDayStatus(day({ choices: [ENTREE, past] }))).toBe('to-pick');
  });

  it('a Buy day whose menu has no “Choice of” section, or no menu, asks for no pick', () => {
    const plain = {
      items: [{ name: 'Fish Tacos' }, { name: 'Corn' }],
      noService: false,
      note: null,
    };
    expect(lunchDayStatus(day({ menu: plain }))).toBe('complete');
    expect(lunchDayStatus(day({ menu: null }))).toBe('complete');
    expect(lunchDayStatus(day({ menu: { ...MENU, noService: true } }))).toBe('complete');
  });

  it('a Bring day is complete as soon as it is Bring', () => {
    expect(lunchDayStatus(day({ mode: 'bring', choices: null }))).toBe('complete');
  });

  it('a day with no school lunch is no school', () => {
    expect(lunchDayStatus(day({ mode: null, dayType: 'no_school' }))).toBe('no-school');
    expect(lunchDayStatus(day({ mode: null, dayType: 'break' }))).toBe('no-school');
  });
});

describe('[MEAL-13] the list', () => {
  // Sunday 11 to Saturday 17 October 2026.
  const week = ['11', '12', '13', '14', '15', '16', '17'].map((d) =>
    day({ date: `2026-10-${d}`, mode: 'bring' }),
  );

  it('lists Monday to Friday, in order, whichever day the week starts on', () => {
    expect(schoolWeek(week).map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ]);
    expect(schoolWeek([...week].reverse()).map((d) => d.date)[0]).toBe('2026-10-12');
  });

  it('a dot on a child with a day to pick today or later, not on one already gone', () => {
    const child = (days: LunchDay[]): LunchChild => ({ memberId: 'm', usual: {}, days });
    const tue = week.map((d) => (d.date === '2026-10-13' ? day({ date: d.date }) : d));
    expect(hasDaysToPick(child(tue), '2026-10-13')).toBe(true);
    expect(hasDaysToPick(child(tue), '2026-10-14')).toBe(false);
    expect(hasDaysToPick(child(week), '2026-10-12')).toBe(false);
    // A Saturday's "day to pick" isn't a school day of the list.
    const sat = week.map((d) => (d.date === '2026-10-17' ? day({ date: d.date }) : d));
    expect(hasDaysToPick(child(sat), '2026-10-12')).toBe(false);
  });

  it('opens on the child chosen last, else the first', () => {
    const kids = ['a', 'b'].map((memberId): LunchChild => ({ memberId, usual: {}, days: [] }));
    expect(openOn(kids, 'b')).toBe('b');
    expect(openOn(kids, null)).toBe('a');
    expect(openOn(kids, 'gone')).toBe('a');
    expect(openOn([], 'b')).toBeNull();
  });
});
