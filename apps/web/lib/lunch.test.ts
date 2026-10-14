import { describe, expect, it } from 'vitest';
import { lunchFromDb, lunchRefusal, noLunchWords, parseUsualLunch } from './lunch';

describe('school lunch', () => {
  it('[MEAL-04] reads lunch_week(): the usual week and each day, anything unknown dropped', () => {
    expect(
      lunchFromDb([
        {
          member_id: 'maya',
          usual: { fri: 'buy', sat: 'buy', mon: 'soup' },
          days: [
            { date: '2026-10-11', day_type: 'weekend', mode: null, changed: false },
            { date: '2026-10-12', day_type: 'school_day', mode: 'buy', changed: true },
            { date: '2026-10-13', day_type: 'school_day', mode: 'nonsense', changed: false },
          ],
        },
      ]),
    ).toEqual([
      {
        memberId: 'maya',
        usual: { fri: 'buy' },
        menuSourceId: null,
        menuName: null,
        days: [
          { date: '2026-10-11', dayType: 'weekend', mode: null, changed: false, menu: null },
          { date: '2026-10-12', dayType: 'school_day', mode: 'buy', changed: true, menu: null },
          { date: '2026-10-13', dayType: 'school_day', mode: null, changed: false, menu: null },
        ],
      },
    ]);
  });

  it('[MEAL-05][US-704] reads the school menu on a buy day, and which menu the child has', () => {
    const [maya] = lunchFromDb([
      {
        member_id: 'maya',
        usual: { mon: 'buy' },
        menu_source_id: 'maple',
        days: [
          {
            date: '2027-02-01',
            day_type: 'school_day',
            mode: 'buy',
            changed: false,
            menu: {
              items: [{ name: 'Cheese Pizza', section: 'Main Line' }],
              no_service: false,
              note: null,
            },
          },
          {
            date: '2027-02-15',
            day_type: 'school_day',
            mode: 'buy',
            changed: false,
            menu: { items: [], no_service: true, note: 'Presidents’ Day' },
          },
        ],
      },
    ]);
    expect(maya!.menuSourceId).toBe('maple');
    expect(maya!.days.map((d) => d.menu)).toEqual([
      { items: [{ name: 'Cheese Pizza', section: 'Main Line' }], noService: false, note: null },
      { items: [], noService: true, note: 'Presidents’ Day' },
    ]);
  });

  it('[MEAL-04][US-703] says why a day has no school lunch', () => {
    expect(noLunchWords('weekend')).toBe('Weekend');
    expect(noLunchWords('break')).toBe('Break');
    expect(noLunchWords('no_school')).toBe('No school');
    expect(noLunchWords('summer')).toBe('No school year');
  });

  it('[MEAL-04][US-703] reads the usual week: buy where chosen, bring otherwise', () => {
    const f = new FormData();
    f.set('usual-fri', 'buy');
    f.set('usual-mon', 'bring');
    f.set('usual-tue', 'soup');
    expect(parseUsualLunch(f)).toEqual({
      mon: 'bring',
      tue: 'bring',
      wed: 'bring',
      thu: 'bring',
      fri: 'buy',
    });
  });

  it('puts the database’s refusals in a parent’s words', () => {
    expect(lunchRefusal({ hint: 'not_school_day' })).toBe('That day has no school lunch.');
    expect(lunchRefusal({ hint: 'not_a_child' })).toBe('School lunch is for children.');
    expect(lunchRefusal({})).toBe('That didn’t save. Try again in a moment.');
  });
});
