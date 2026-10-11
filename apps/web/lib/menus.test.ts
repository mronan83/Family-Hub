import { describe, expect, it } from 'vitest';
import {
  fetchStatus,
  itemsFrom,
  itemsText,
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
    ).toBe('Pizza, Milk');
    expect(menuWords({ items: [], noService: true, note: 'Teacher day' })).toBe(
      'No lunch: Teacher day',
    );
  });

  it('[US-802] writes items a line each and reads them back, sections and all', () => {
    const items = [{ name: 'Pizza', section: 'Main Line' }, { name: 'Apple' }];
    expect(itemsText(items)).toBe('Main Line: Pizza\nApple');
    expect(itemsFrom('Main Line: Pizza\n\n  Apple  \n')).toEqual(items);
  });

  it('[MENU-03][US-802] reads a day typed in: items, or no lunch with a note', () => {
    expect(parseDayForm(form({ date: '2027-02-01', items: 'Pizza\nMilk' }))).toEqual({
      ok: true,
      value: { date: '2027-02-01', items: [{ name: 'Pizza' }, { name: 'Milk' }], noService: false },
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
