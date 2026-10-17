import { describe, expect, it } from 'vitest';
import {
  fetchStatus,
  itemsFrom,
  itemsText,
  menuFacts,
  menuRefusal,
  menuWords,
  parseDayForm,
  parseSourceForm,
  sourceWords,
} from './menus';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('school menus in the admin portal', () => {
  it('[MENU-01] says where a menu comes from', () => {
    expect(
      sourceWords({
        adapter: 'nutrislice',
        config: {
          school: 'maple',
          school_name: 'Maple Elementary',
          menu_type: 'lunch',
          menu_type_name: 'Lunch',
        },
      }),
    ).toBe('From Nutrislice · Maple Elementary · Lunch');
    expect(sourceWords({ adapter: 'csv', config: {} })).toBe('From a file');
  });

  it('[MENU-04][US-803] says how a feed is going: a failure keeps its menus and says so', () => {
    const base = {
      adapter: 'nutrislice' as const,
      lastFetchAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
    expect(fetchStatus({ ...base, status: 'pending' }, 'America/New_York')?.label).toBe(
      'Not fetched yet',
    );
    const failed = fetchStatus(
      {
        ...base,
        status: 'error',
        lastError: 'Nutrislice answered 503. FamilyWise tries again tomorrow.',
        lastSuccessAt: '2027-02-01T11:00:00Z',
      },
      'America/New_York',
    );
    expect(failed?.label).toBe('Can’t fetch');
    expect(failed?.detail).toMatch(
      /^Nutrislice answered 503\. .* Last fetched .*: the menus below are kept/,
    );
    expect(fetchStatus({ ...base, adapter: 'csv', status: 'ok' }, 'UTC')).toBeNull();
  });

  it('[MEAL-05] says a day’s lunch in words', () => {
    expect(
      menuWords({
        items: [{ name: 'Pizza' }, { name: 'Milk', section: 'Beverages' }],
        noService: false,
      }),
    ).toBe('Pizza · Beverages: Milk');
    // [MENU-06] By section, the sections' names shortened, a choice's options joined with "or".
    expect(
      menuWords({
        items: [
          { name: 'Beef tacos', section: 'Choice of Entree', option: 1 },
          { name: 'Chicken wrap', section: 'Choice of Entree', option: 2 },
          { name: 'Tortilla chips', section: 'Choice of Entree', option: 2 },
          { name: 'Corn', section: 'Fruits & Vegetables offered', option: 1 },
          { name: 'Orange', section: 'Fruits & Vegetables offered', option: 2 },
          { name: '1% milk', section: 'Choice of Milk', option: 1 },
          { name: 'Chocolate milk', section: 'Choice of Milk', option: 2 },
        ],
        noService: false,
      }),
    ).toBe(
      'Entree: Beef tacos or Chicken wrap with Tortilla chips · Fruits & Vegetables: Corn, Orange · Milk: 1% milk or Chocolate milk',
    );
    expect(menuWords({ items: [], noService: true, note: 'Teacher day' })).toBe(
      'No lunch: Teacher day',
    );
  });

  it('[US-802] writes items a line each and reads them back, sections and all', () => {
    const items = [
      { name: 'Pizza', section: 'Main Line', option: 1 },
      { name: 'Apple', option: 1 },
    ];
    expect(itemsText(items)).toBe('Main Line: Pizza\nApple');
    expect(itemsFrom('Main Line: Pizza\n\n  Apple  \n')).toEqual(items);
    // [MENU-06] "or" and "with" in a line: options and sides, written back the same way (WP-64).
    const typed =
      'Choice of Entree: Beef tacos or Chicken wrap with tortilla chips\nChoice of Milk: 1% milk or Chocolate milk';
    expect(itemsFrom(typed)).toEqual([
      { name: 'Beef tacos', section: 'Choice of Entree', option: 1 },
      { name: 'Chicken wrap', section: 'Choice of Entree', option: 2 },
      { name: 'tortilla chips', section: 'Choice of Entree', option: 2 },
      { name: '1% milk', section: 'Choice of Milk', option: 1 },
      { name: 'Chocolate milk', section: 'Choice of Milk', option: 2 },
    ]);
    expect(itemsText(itemsFrom(typed))).toBe(typed);
    // A section over several lines keeps counting its options.
    expect(itemsFrom('Sides: Corn\nSides: Peas').map((i) => i.option)).toEqual([1, 2]);
  });

  it('[MENU-03][US-802] reads a day typed in: items, or no lunch with a note', () => {
    expect(parseDayForm(form({ date: '2027-02-01', items: 'Pizza\nMilk' }))).toEqual({
      ok: true,
      value: {
        date: '2027-02-01',
        items: [
          { name: 'Pizza', option: 1 },
          { name: 'Milk', option: 2 },
        ],
        noService: false,
      },
    });
    expect(
      parseDayForm(form({ date: '2027-02-15', noService: 'on', note: 'Presidents’ Day' })),
    ).toEqual({
      ok: true,
      value: { date: '2027-02-15', items: [], noService: true, note: 'Presidents’ Day' },
    });
    expect(parseDayForm(form({ date: '2027-02-01', items: ' ' })).ok).toBe(false);
    expect(parseDayForm(form({ items: 'Pizza' })).ok).toBe(false);
  });

  it('[MENU-01][US-801] reads a new menu: a feed needs its district, school and menu picked', () => {
    expect(
      parseSourceForm(
        form({
          name: 'Maple',
          adapter: 'nutrislice',
          district: 'example-district',
          feed: 'maple-elementary/lunch',
          schoolName: 'Maple Elementary',
          menuName: 'Lunch',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        name: 'Maple',
        adapter: 'nutrislice',
        config: {
          district: 'example-district',
          school: 'maple-elementary',
          menu_type: 'lunch',
          school_name: 'Maple Elementary',
          menu_type_name: 'Lunch',
        },
      },
    });
    expect(parseSourceForm(form({ name: 'Maple', adapter: 'nutrislice', district: 'x' })).ok).toBe(
      false,
    );
    expect(parseSourceForm(form({ name: 'Maple', adapter: 'csv' }))).toEqual({
      ok: true,
      value: { name: 'Maple', adapter: 'csv', config: {} },
    });
    expect(parseSourceForm(form({ name: '', adapter: 'csv' })).ok).toBe(false);
  });

  it('says a refusal in a parent’s words', () => {
    expect(menuRefusal({ hint: 'not_a_child' })).toBe('School lunch is for children.');
    expect(menuRefusal({ hint: 'whatever' })).toBe('That didn’t save. Try again in a moment.');
  });
});

// [NFR-18][D-120] A school menu's folded header on School menus (WP-93).
describe('a school menu’s folded header', () => {
  const NY = 'America/New_York';
  const names = new Map([
    ['maya', 'Maya'],
    ['leo', 'Leo'],
  ]);
  /** Mon, Oct 12, 2026, 9:15 am in New York. */
  const NOW = Date.parse('2026-10-12T13:15:00Z');
  const day = (date: string, noService = false) => ({
    date,
    items: noService ? [] : [{ name: 'Pizza' }],
    noService,
    origin: 'adapter' as const,
    own: false,
  });
  const feed = {
    adapter: 'nutrislice' as const,
    status: 'ok' as const,
    lastFetchAt: '2026-10-12T10:29:04Z',
    lastSuccessAt: '2026-10-12T10:29:04Z',
    childIds: ['maya', 'leo'],
    days: [day('2026-10-12'), day('2026-10-13'), day('2026-10-16', true)],
  };

  it('[NFR-18-c][MENU-01][MENU-04] where it comes from, whose lunch, its fetch and its days', () => {
    expect(menuFacts(feed, names, NOW, NY)).toEqual({
      meta: 'From Nutrislice · Maya and Leo · Fetched 6:29 am · 2 days in the next four weeks',
      warning: null,
    });
    // Fetched yesterday: its day and time.
    expect(menuFacts({ ...feed, lastFetchAt: '2026-10-11T10:29:04Z' }, names, NOW, NY).meta).toBe(
      'From Nutrislice · Maya and Leo · Fetched Sun, Oct 11 at 6:29 am · 2 days in the next four weeks',
    );
  });

  it('[NFR-18-c][MENU-03] a file or typed-in menu has nothing to fetch; nobody yet, one day, none', () => {
    expect(
      menuFacts(
        { ...feed, adapter: 'csv', childIds: [], days: [day('2026-10-12')] },
        names,
        NOW,
        NY,
      ),
    ).toEqual({ meta: 'From a file · nobody yet · 1 day in the next four weeks', warning: null });
    expect(
      menuFacts({ ...feed, adapter: 'manual', childIds: ['leo'], days: [] }, names, NOW, NY).meta,
    ).toBe('Typed in · Leo · no days in the next four weeks');
  });

  it('[NFR-18-d][MENU-04][US-803] a feed that can’t fetch has the warning and says when it last fetched', () => {
    expect(
      menuFacts(
        { ...feed, status: 'error', lastSuccessAt: '2026-10-11T10:29:05Z', childIds: [] },
        names,
        NOW,
        NY,
      ),
    ).toEqual({
      meta: 'From Nutrislice · nobody yet · last fetched Sun, Oct 11 at 6:29 am · 2 days in the next four weeks',
      warning: 'Can’t fetch',
    });
    expect(
      menuFacts({ ...feed, status: 'error', lastSuccessAt: null, days: [] }, names, NOW, NY),
    ).toEqual({
      meta: 'From Nutrislice · Maya and Leo · never fetched · no days in the next four weeks',
      warning: 'Can’t fetch',
    });
    expect(
      menuFacts({ ...feed, status: 'pending', lastFetchAt: null, days: [] }, names, NOW, NY).meta,
    ).toBe('From Nutrislice · Maya and Leo · Not fetched yet · no days in the next four weeks');
  });

  it('[NFR-18-e] "today" is the household’s day, across midnight UTC and the end of daylight saving', () => {
    // 7:30 pm and 9:00 pm on Monday in New York are on different days in UTC: still today.
    expect(
      menuFacts(
        { ...feed, lastFetchAt: '2026-10-12T23:30:00Z' },
        names,
        Date.parse('2026-10-13T01:00:00Z'),
        NY,
      ).meta,
    ).toContain('Fetched 7:30 pm');
    // 11:30 pm Monday and 12:30 am Tuesday in New York share a UTC day: yesterday's, by its day.
    expect(
      menuFacts(
        { ...feed, lastFetchAt: '2026-10-13T03:30:00Z' },
        names,
        Date.parse('2026-10-13T04:30:00Z'),
        NY,
      ).meta,
    ).toContain('Fetched Mon, Oct 12 at 11:30 pm');
    // Sunday, Nov 1, 2026, when daylight saving ends: 1:30 am EDT is today at 7 am EST.
    expect(
      menuFacts(
        { ...feed, lastFetchAt: '2026-11-01T05:30:00Z' },
        names,
        Date.parse('2026-11-01T12:00:00Z'),
        NY,
      ).meta,
    ).toContain('Fetched 1:30 am');
  });
});
