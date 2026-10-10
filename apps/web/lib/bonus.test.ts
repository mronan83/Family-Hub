import { describe, expect, it } from 'vitest';
import { bonusFacts, describeBonus, parseBonusRule, resumedFrom } from './bonus';

const TODAY = '2026-10-10';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('adding a bonus', () => {
  it('[PTS-05][US-1107] a streak bonus: a run length, points, and the day it counts from', () => {
    expect(
      parseBonusRule(
        form({
          ruleType: 'streak_bonus',
          streakDays: '7',
          bonusPoints: '20',
          countsFrom: '2026-10-01',
        }),
        TODAY,
      ),
    ).toEqual({
      ok: true,
      value: {
        ruleType: 'streak_bonus',
        streakDays: 7,
        bonusPoints: 20,
        countsFrom: '2026-10-01',
      },
    });
  });

  it('[PTS-05] a perfect-day bonus has no run length, and counts from today when left blank', () => {
    expect(
      parseBonusRule(
        form({ ruleType: 'all_done_bonus', streakDays: '7', bonusPoints: '5', countsFrom: '' }),
        TODAY,
      ),
    ).toEqual({
      ok: true,
      value: { ruleType: 'all_done_bonus', streakDays: null, bonusPoints: 5, countsFrom: TODAY },
    });
  });

  it('[PTS-05] says what to fix: the kind, the run, the points or the date', () => {
    const msg = (f: Record<string, string>) => {
      const r = parseBonusRule(form(f), TODAY);
      return r.ok ? null : r.message;
    };
    const ok = { ruleType: 'streak_bonus', streakDays: '7', bonusPoints: '20', countsFrom: TODAY };
    expect(msg({ ...ok, ruleType: 'weekly' })).toBe('Choose a streak or a perfect day.');
    for (const streakDays of ['1', '366', '2.5', '', 'seven']) {
      expect(msg({ ...ok, streakDays })).toBe('A streak is 2 to 365 good days in a row.');
    }
    for (const bonusPoints of ['0', '1001', '-5', '']) {
      expect(msg({ ...ok, bonusPoints })).toBe('Give a bonus of 1 to 1,000 points.');
    }
    for (const countsFrom of ['10/10/2026', '2026-13-45']) {
      expect(msg({ ...ok, countsFrom })).toBe('Choose the day it counts from.');
    }
    expect(msg({ ...ok, streakDays: '2' })).toBeNull();
    expect(msg({ ...ok, streakDays: '365', bonusPoints: '1000' })).toBeNull();
  });
});

describe('a bonus in words', () => {
  it('[PTS-05] reads as the parent set it', () => {
    expect(describeBonus({ ruleType: 'streak_bonus', streakDays: 7, bonusPoints: 20 })).toBe(
      '20 points for 7 good days in a row',
    );
    expect(describeBonus({ ruleType: 'all_done_bonus', streakDays: null, bonusPoints: 1 })).toBe(
      '1 point for each day with everything done',
    );
  });

  it('[PTS-05] says from when it counts, or when it starts, and whether it is off', () => {
    expect(bonusFacts({ countsFrom: '2026-10-01', active: true }, TODAY)).toBe(
      'counts from Thu, Oct 1',
    );
    expect(bonusFacts({ countsFrom: '2026-10-12', active: true }, TODAY)).toBe(
      'starts Mon, Oct 12',
    );
    expect(bonusFacts({ countsFrom: TODAY, active: false }, TODAY)).toBe(
      'counts from Sat, Oct 10 · off',
    );
  });

  it('[PTS-05] back on, a rule counts from today: days while it was off never pay', () => {
    expect(resumedFrom('2026-10-01', TODAY)).toBe(TODAY);
    expect(resumedFrom('2026-10-20', TODAY)).toBe('2026-10-20');
  });
});
