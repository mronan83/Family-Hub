import { describe, expect, it } from 'vitest';
import type { BonusRule } from './bonus';
import {
  archivedBonusesLine,
  archivedWhen,
  bonusLine,
  bonusName,
  latelyLine,
  memberOpen,
  membersArchivedLine,
  pointsLine,
  rewardsOpen,
  type Settled,
  shopArchivedLine,
} from './reward-facts';
import type { FoldLine } from './setup-facts';

// [NFR-18][D-120] Rewards' and Members' folded headers (WP-95): what each says while folded, and
// which fold comes back open after a save.

/** A line as it reads, the bold parts in **. */
const read = (line: FoldLine) =>
  line.map((p) => (typeof p === 'string' ? p : `**${p.b}**`)).join('');

const NY = 'America/New_York';
/** Thursday, Oct 15, 2026 in New York. */
const TODAY = '2026-10-15';

const rule = (o: Partial<BonusRule>): BonusRule => ({
  id: 'b',
  ruleType: 'streak_bonus',
  streakDays: 7,
  bonusPoints: 20,
  countsFrom: '2026-10-01',
  active: true,
  archivedAt: null,
  ...o,
});

describe('Rewards', () => {
  it('[PTS-03-a] the shop’s Archived: its count, or none', () => {
    expect(read(shopArchivedLine(3))).toBe('**3 archived**');
    expect(read(shopArchivedLine(1))).toBe('**1 archived**');
    expect(read(shopArchivedLine(0))).toBe('None archived');
    // An archived reward's line says the month it left the shop, in the household's zone.
    expect(archivedWhen('2026-09-14T15:00:00Z', NY)).toBe('Archived in September');
    expect(archivedWhen('2026-10-01T02:00:00Z', NY)).toBe('Archived in September');
  });

  it('[PTS-03-a] which fold comes back open after a save', () => {
    const none = { archived: false, bonus: false, archivedBonuses: false };
    expect(rewardsOpen({})).toEqual(none);
    expect(rewardsOpen({ saved: 'Movie night' } as never)).toEqual(none);
    expect(rewardsOpen({ archived: '1' })).toEqual({ ...none, archived: true });
    expect(rewardsOpen({ restored: '1' })).toEqual({ ...none, archived: true });
    for (const bonus of ['added', 'on', 'off', 'paid'])
      expect(rewardsOpen({ bonus })).toEqual({ ...none, bonus: true });
    expect(rewardsOpen({ bonus: 'archive' })).toEqual({
      ...none,
      bonus: true,
      archivedBonuses: true,
    });
    expect(rewardsOpen({ error: 'bonus_gone' })).toEqual({ ...none, bonus: true });
    expect(rewardsOpen({ error: 'history' })).toEqual({ ...none, bonus: true });
    expect(rewardsOpen({ error: 'invalid', open: 'bonus' })).toEqual({ ...none, bonus: true });
    // A request decided, or refused, opens nothing: Asked for and To give are open already.
    expect(rewardsOpen({ error: 'not_requested' } as never)).toEqual(none);
  });

  it('[PTS-05-a] Bonus points: how many on and off, the ones on by name and points', () => {
    expect(bonusName(rule({}))).toBe('7 days in a row +20');
    expect(bonusName(rule({ ruleType: 'all_done_bonus', streakDays: null, bonusPoints: 5 }))).toBe(
      'Perfect day +5',
    );
    const perfect = rule({ ruleType: 'all_done_bonus', streakDays: null, bonusPoints: 5 });
    expect(read(bonusLine([rule({}), perfect]))).toBe(
      '**2 on** · 7 days in a row +20, Perfect day +5',
    );
    expect(
      read(
        bonusLine([
          rule({}),
          { ...perfect, active: false },
          rule({ streakDays: 3, archivedAt: '2026-09-30T00:00:00Z' }),
        ]),
      ),
    ).toBe('**1 on**, 1 off · 7 days in a row +20');
    expect(read(bonusLine([rule({ active: false })]))).toBe('**None on** · 1 off');
    expect(read(bonusLine([]))).toBe('No bonuses yet');
    expect(read(bonusLine([rule({ archivedAt: '2026-09-30T00:00:00Z' })]))).toBe('No bonuses yet');
    expect(read(archivedBonusesLine(1))).toBe('1 archived');
  });
});

describe('Lately', () => {
  const ask = (o: Partial<Settled>): Settled => ({
    status: 'fulfilled',
    memberId: 'maya',
    itemId: 'movie',
    requestedAt: '2026-10-10T20:10:00Z',
    decidedAt: '2026-10-11T14:00:00Z',
    fulfilledAt: '2026-10-15T14:00:00Z',
    cancelledAt: null,
    ...o,
  });
  const title = (id: string) => (id === 'movie' ? 'Movie night' : 'Ice cream trip');
  const name = (id: string) => (id === 'maya' ? 'Maya' : 'Leo');
  const line = (s: Settled[], today = TODAY) => read(latelyLine(s, title, name, NY, today));

  it('[PTS-04-b] the latest settled request in words, its day, and how many', () => {
    expect(line([ask({}), ask({ status: 'denied' })])).toBe(
      '**Last:** Movie night given to Maya, today · 2 settled',
    );
    expect(
      line([
        ask({
          status: 'denied',
          memberId: 'leo',
          itemId: 'ice',
          decidedAt: '2026-10-14T15:00:00Z',
        }),
      ]),
    ).toBe('**Last:** Ice cream trip not this time for Leo, yesterday · 1 settled');
    expect(line([ask({ status: 'cancelled', cancelledAt: '2026-10-12T15:00:00Z' })])).toBe(
      '**Last:** Movie night cancelled for Maya, Mon, Oct 12 · 1 settled',
    );
    expect(line([])).toBe('Nothing settled yet');
  });

  it('[PTS-04-b] its day is the household’s, across midnight UTC and the end of daylight saving', () => {
    // 11:30 pm Wednesday in New York is Thursday in UTC: yesterday, not today.
    expect(line([ask({ fulfilledAt: '2026-10-15T03:30:00Z' })])).toContain(', yesterday ·');
    // 12:30 am Thursday in New York is still Thursday: today.
    expect(line([ask({ fulfilledAt: '2026-10-15T04:30:00Z' })])).toContain(', today ·');
    // Daylight saving ends Sunday, Nov 1: 11:30 pm Saturday (EDT) and 11:30 pm Sunday (EST).
    expect(line([ask({ fulfilledAt: '2026-11-01T03:30:00Z' })], '2026-11-01')).toContain(
      ', yesterday ·',
    );
    expect(line([ask({ fulfilledAt: '2026-11-02T04:30:00Z' })], '2026-11-02')).toContain(
      ', yesterday ·',
    );
  });
});

describe('Members', () => {
  it('[PTS-01-a] Points: the balance and the last change, signed, what for and when', () => {
    expect(
      read(pointsLine(142, { amount: 5, at: '2026-10-15T11:10:00Z', what: 'Make bed' }, NY, TODAY)),
    ).toBe('**142 points** · last: +5 Make bed, today 7:10 am');
    expect(
      read(
        pointsLine(-5, { amount: -60, at: '2026-10-14T23:30:00Z', what: 'Movie night' }, NY, TODAY),
      ),
    ).toBe('**−5 points** · last: −60 Movie night, yesterday 7:30 pm');
    expect(
      read(
        pointsLine(1, { amount: 1, at: '2026-10-09T16:00:00Z', what: 'Feed the fish' }, NY, TODAY),
      ),
    ).toBe('**1 point** · last: +1 Feed the fish, Fri, Oct 9 12:00 pm');
    expect(read(pointsLine(0, null, NY, TODAY))).toBe('**0 points** · no points yet');
  });

  it('[PTS-01-a] Points is open again after a change of points, not otherwise', () => {
    expect(memberOpen({ adjusted: '5' })).toEqual({ points: true });
    expect(memberOpen({ adjusted: '-3' })).toEqual({ points: true });
    expect(memberOpen({ adjusted: '0' })).toEqual({ points: false });
    expect(memberOpen({ adjusted: 'x' })).toEqual({ points: false });
    expect(memberOpen({})).toEqual({ points: false });
  });

  it('[ACC-04-a] Members’ Archived: how many and who', () => {
    expect(read(membersArchivedLine(['Grandpa Joe']))).toBe('**1 archived:** Grandpa Joe');
    expect(read(membersArchivedLine(['Grandpa Joe', 'Nana']))).toBe(
      '**2 archived:** Grandpa Joe and Nana',
    );
    expect(read(membersArchivedLine(['A', 'B', 'C', 'D', 'E']))).toBe(
      '**5 archived:** A, B, C and 2 more',
    );
  });
});
