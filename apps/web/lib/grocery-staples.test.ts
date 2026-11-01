import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  dueDay,
  gapWords,
  learn,
  notNowUntil,
  runningLowCount,
  runningLowLine,
  runningLowWords,
  statusWords,
  staples,
  staplesSummary,
  type Bought,
} from './grocery-staples';

// [MEAL-21] Staples by how often they run out (WP-106, D-138 (7), D-150), on made-up histories.
// Every date is a calendar date; nothing reads the clock.

const TODAY = '2026-10-18';

/** Buy days from a last day and the gaps before it, oldest first: (Oct 9, [9, 8]) → Sep 22, Oct 1, Oct 9. */
function history(last: string, gaps: number[]): string[] {
  const days = [last];
  for (const g of [...gaps].reverse()) days.unshift(addDays(days[0]!, -g));
  return days;
}
const thing = (
  key: string,
  days: string[],
  name = key[0]!.toUpperCase() + key.slice(1),
): Bought => ({
  key,
  name,
  buys: days.length,
  days,
});

describe('the gap', () => {
  it('[MEAL-21-a] with fewer than 4 buys a thing is still being learned', () => {
    expect(learn(history('2026-10-12', [7, 7]))).toEqual({ state: 'learning', buys: 3 });
    expect(learn([])).toEqual({ state: 'learning', buys: 0 });
  });

  it('[MEAL-21-a] a regular staple’s gap is the median of its last 8 buys’ gaps, to the day', () => {
    expect(learn(history('2026-10-09', [9, 8, 10, 9]))).toEqual({
      state: 'learned',
      buys: 5,
      gap: 9,
      last: '2026-10-09',
    });
    // Only the last 8 buys count: an old slow spell is forgotten.
    const days = history('2026-10-14', [30, 30, 5, 5, 6, 5, 4, 5, 5]);
    expect(learn(days)).toMatchObject({ state: 'learned', gap: 5 });
    // The database sends the latest 8 days with the count of every buy.
    expect(learn(days.slice(-8), 10)).toMatchObject({ state: 'learned', buys: 10, gap: 5 });
    // An even number of gaps: the middle two averaged, then rounded.
    expect(learn(history('2026-10-17', [14, 13, 15, 14]))).toMatchObject({ gap: 14 });
  });

  it('[MEAL-21-a] one bought irregularly is never suggested', () => {
    expect(learn(history('2026-10-15', [3, 11, 20, 4, 15]))).toEqual({
      state: 'irregular',
      buys: 6,
    });
    const v = staples(
      [thing('strawberries', history('2026-09-01', [3, 11, 20, 4, 15]))],
      [],
      TODAY,
      new Set(),
    );
    expect(v.runningLow).toEqual([]);
    expect(v.learning).toEqual([
      { key: 'strawberries', name: 'Strawberries', buys: 6, irregular: true },
    ]);
  });

  it('[MEAL-21-a] the gap in words', () => {
    expect([1, 5, 7, 9, 13, 14, 15, 21, 30].map(gapWords)).toEqual([
      'every day',
      'every 5 days',
      'every week',
      'every 9 days',
      'every 13 days',
      'every 2 weeks',
      'every 2 weeks',
      'every 3 weeks',
      'every 4 weeks',
    ]);
  });
});

describe('when it is suggested', () => {
  it('[MEAL-21-b] due a day early for a gap of a week or less, two days early for a longer one', () => {
    expect(dueDay('2026-10-12', 7)).toBe('2026-10-18');
    expect(dueDay('2026-10-14', 5)).toBe('2026-10-18');
    expect(dueDay('2026-10-09', 9)).toBe('2026-10-16');
    expect(dueDay('2026-09-27', 21)).toBe('2026-10-16');
  });

  it('[MEAL-21-b] a regular staple not on the list is running low from its due day, not the day before', () => {
    const cereal = thing('cereal', history('2026-10-12', [7, 7, 6, 8, 7]));
    expect(staples([cereal], [], '2026-10-17', new Set()).runningLow).toEqual([]);
    expect(staples([cereal], [], '2026-10-17', new Set()).learned[0]!.status).toEqual({
      kind: 'due',
      due: '2026-10-18',
    });
    expect(staples([cereal], [], TODAY, new Set()).runningLow.map((s) => s.key)).toEqual([
      'cereal',
    ]);
  });

  it('[MEAL-21-b] on the list, or asked for by a child waiting for a grown-up, it is not suggested', () => {
    const milk = thing('milk', history('2026-10-10', [5, 5, 5, 5]));
    expect(staples([milk], [], TODAY, new Set(['milk'])).learned[0]!.status).toEqual({
      kind: 'on-list',
    });
    expect(staples([milk], [], TODAY, new Set(), new Set(['milk'])).learned[0]!.status).toEqual({
      kind: 'asked',
    });
    expect(staples([milk], [], TODAY, new Set(), new Set(['milk'])).runningLow).toEqual([]);
  });

  it('[MEAL-21-b] one no longer bought stops after 3 gaps with no buy, and its next buy starts it again', () => {
    const days = history('2026-08-30', [6, 6, 6, 6]);
    // Aug 30 + 3 × 6 days = Sep 17.
    expect(staples([thing('lemonade', days)], [], '2026-09-16', new Set()).runningLow).toHaveLength(
      1,
    );
    const stopped = staples([thing('lemonade', days)], [], '2026-09-17', new Set());
    expect(stopped.runningLow).toEqual([]);
    expect(stopped.learned[0]!.status).toEqual({ kind: 'stopped' });
    const again = staples([thing('lemonade', [...days, '2026-10-14'])], [], TODAY, new Set());
    expect(again.learned[0]!.status.kind).not.toBe('stopped');
  });

  it('[MEAL-21-b] dates across the end of DST, a month and a year work by calendar days', () => {
    // Nov 1, 2026 is when Chicago leaves DST.
    expect(daysBetween('2026-10-28', '2026-11-04')).toBe(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    // Due across the change: last bought Oct 28, every week, due Nov 3.
    expect(dueDay('2026-10-28', 7)).toBe('2026-11-03');
  });
});

describe('Not now and Don’t suggest', () => {
  const butter = thing('butter', history('2026-10-09', [9, 8, 10, 9]));

  it('[MEAL-21-c] a dismissed suggestion: Not now hides it until one more gap has passed', () => {
    const until = notNowUntil(TODAY, 9);
    expect(until).toBe('2026-10-27');
    const choice = { key: 'butter', notNowUntil: until, offAt: null };
    expect(staples([butter], [choice], TODAY, new Set()).runningLow).toEqual([]);
    expect(staples([butter], [choice], '2026-10-26', new Set()).learned[0]!.status).toEqual({
      kind: 'not-now',
      until: '2026-10-27',
    });
    // Back on its day, unless it was bought meanwhile (then due again from that buy).
    expect(staples([butter], [choice], '2026-10-27', new Set()).runningLow).toHaveLength(1);
    const bought = thing('butter', [...butter.days, '2026-10-20']);
    expect(staples([bought], [choice], '2026-10-26', new Set()).learned[0]!.status).toEqual({
      kind: 'due',
      due: '2026-10-27',
    });
  });

  it('[MEAL-21-c] Don’t suggest stops it, in Staples’ Not suggested, until Suggest again', () => {
    const off = { key: 'butter', notNowUntil: null, offAt: '2026-09-12T15:00:00Z' };
    const v = staples([butter], [off], TODAY, new Set());
    expect(v.runningLow).toEqual([]);
    expect(v.learned).toEqual([]);
    expect(v.off).toEqual([{ key: 'butter', name: 'Butter', offAt: '2026-09-12T15:00:00Z' }]);
    const back = staples([butter], [{ ...off, offAt: null }], TODAY, new Set());
    expect(back.runningLow.map((s) => s.key)).toEqual(['butter']);
  });

  it('[MEAL-21-c] Running low? is most overdue first; Home’s line and Staples’ summary say how many', () => {
    const v = staples(
      [
        thing('cereal', history('2026-10-12', [7, 7, 6, 8, 7])),
        thing('butter', history('2026-10-09', [9, 8, 10, 9])),
        thing('trash bags', history('2026-09-27', [21, 21, 20, 22]), 'Trash bags'),
        thing('milk', history('2026-10-14', [5, 5, 5, 5])),
        thing('tortillas', history('2026-10-10', [7, 7])),
      ],
      [{ key: 'candles', notNowUntil: null, offAt: '2026-09-12T15:00:00Z' }],
      TODAY,
      new Set(['milk']),
    );
    expect(v.runningLow.map((s) => s.name)).toEqual(['Butter', 'Trash bags', 'Cereal']);
    expect(runningLowLine(v.runningLow.length)).toBe('3 running low');
    expect(runningLowLine(0)).toBeNull();
    expect(staplesSummary(v)).toBe('4 learned · 1 still learning');
    expect(
      staplesSummary({ ...v, off: [{ key: 'candles', name: 'Birthday candles', offAt: '' }] }),
    ).toBe('4 learned · 1 still learning · 1 not suggested');
  });
});

describe('the words', () => {
  it('[MEAL-21-c] a Running low? row and each staple’s state in Staples', () => {
    expect(runningLowWords({ gap: 9, last: '2026-10-09' }, 'Kroger')).toBe(
      'Usually every 9 days · last got Fri, Oct 9 · Kroger',
    );
    expect(runningLowWords({ gap: 7, last: '2026-10-12' }, null)).toBe(
      'Usually every week · last got Mon, Oct 12',
    );
    const last = '2026-08-30';
    expect(
      (
        [
          { kind: 'on-list' },
          { kind: 'asked' },
          { kind: 'running-low', due: '2026-10-16' },
          { kind: 'due', due: '2026-10-29' },
          { kind: 'not-now', until: '2026-10-27' },
          { kind: 'stopped' },
        ] as const
      ).map((status) => statusWords({ status, last })),
    ).toEqual([
      'On the list',
      'Asked for',
      'Running low',
      'Due Oct 29',
      'Not now, until Oct 27',
      'Not got since Aug 30, so not suggested',
    ]);
  });
});

describe('Home’s count', () => {
  it('[MEAL-21-c] counts the staples running low, leaving out what is open on the list or asked for', () => {
    const data = {
      items: [
        { name: 'Milk ×2', status: 'open' },
        { name: 'Cereal', status: 'ticked' },
      ],
      asks: [{ name: 'Butter' }],
      bought: [
        thing('milk', history('2026-10-10', [5, 5, 5, 5])),
        thing('butter', history('2026-10-09', [9, 8, 10, 9])),
        thing('cereal', history('2026-10-12', [7, 7, 6, 8, 7])),
      ],
    };
    expect(runningLowCount(data, TODAY)).toBe(1);
    expect(runningLowCount({ items: [] }, TODAY)).toBe(0);
  });
});
