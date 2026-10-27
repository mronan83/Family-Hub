import { describe, expect, it } from 'vitest';
import {
  byDay,
  entryWords,
  moreLine,
  parseRegisterQuery,
  payoutLine,
  readParts,
  type RegisterEntry,
  registerHref,
  seeWords,
  shownCount,
  shownLine,
  toggleType,
  toggleWho,
  totalLine,
} from './points-register';
import type { FoldLine } from './setup-facts';

// [PTS-08] The household points register (WP-115, D-147): each entry's words, the address, day
// headings in the household's zone, the total and payouts lines, and reading past 1,000 rows a call.

/** A line as it reads, the bold parts in **. */
const read = (line: FoldLine) =>
  line.map((p) => (typeof p === 'string' ? p : `**${p.b}**`)).join('');

const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const RULE = 'f3000000-0000-4000-8000-000000000001';
const SAM = 'f2000000-0000-4000-8000-0000000000a2';
const names: Record<string, string> = { [MAYA]: 'Maya', [LEO]: 'Leo', [SAM]: 'Sam' };
const adminName = (id: string) => names[id] ?? 'a parent';

const entry = (
  o: Partial<RegisterEntry> & Pick<RegisterEntry, 'kind' | 'amount'>,
): RegisterEntry => ({
  id: 'e',
  memberId: MAYA,
  at: '2026-10-27T12:00:00Z',
  reason: null,
  forItem: false,
  itemTitle: null,
  goalId: null,
  goalTitle: null,
  ruleId: null,
  byType: 'system',
  by: null,
  ...o,
});

describe('[PTS-08] an entry in words', () => {
  it('[PTS-08-c] an earn on an item the parent may not see stays "A private item" (D-34)', () => {
    expect(entryWords(entry({ kind: 'earn', amount: 3, forItem: true }), adminName)).toEqual({
      what: 'A private item',
      by: 'done',
    });
    expect(entryWords(entry({ kind: 'reversal', amount: -3, forItem: true }), adminName).what).toBe(
      'A private item',
    );
  });

  it('[PTS-08-g] what each entry was for, and who or what issued it', () => {
    const words = (o: Parameters<typeof entry>[0]) => entryWords(entry(o), adminName);
    expect(words({ kind: 'earn', amount: 5, forItem: true, itemTitle: 'Feed the dog' })).toEqual({
      what: 'Feed the dog',
      by: 'done',
    });
    expect(words({ kind: 'reversal', amount: -5, forItem: true, itemTitle: 'Make bed' })).toEqual({
      what: 'Make bed',
      by: 'unchecked',
    });
    expect(words({ kind: 'bonus', amount: 5, reason: 'Everything done', ruleId: RULE })).toEqual({
      what: 'Everything done',
      by: 'paid automatically',
    });
    expect(
      words({
        kind: 'goal',
        amount: 25,
        reason: 'Read 5 books',
        goalId: 'g',
        goalTitle: 'Read 5 books',
      }),
    ).toEqual({ what: 'Reached Read 5 books', by: 'goal Read 5 books' });
    expect(
      words({ kind: 'reversal', amount: -25, goalId: 'g', goalTitle: 'Read 5 books' }),
    ).toEqual({ what: 'Read 5 books', by: 'goal taken back' });
    expect(
      words({ kind: 'adjustment', amount: 10, reason: 'Helped', byType: 'admin', by: SAM }),
    ).toEqual({ what: 'Helped', by: 'by Sam' });
    expect(
      words({ kind: 'spend', amount: -100, reason: 'Movie night', byType: 'admin', by: SAM }),
    ).toEqual({ what: 'Movie night', by: 'approved by Sam' });
    expect(
      words({ kind: 'refund', amount: 30, reason: 'Pick the dinner', byType: 'admin', by: SAM }),
    ).toEqual({ what: 'Pick the dinner', by: 'cancelled by Sam' });
    // A parent no longer in the household is still "a parent".
    expect(
      words({ kind: 'adjustment', amount: 1, reason: 'x', byType: 'admin', by: 'gone' }).by,
    ).toBe('by a parent');
  });
});

describe('[PTS-08] the register’s address', () => {
  it('[PTS-08-h] reads every filter and writes it back', () => {
    const f = parseRegisterQuery({
      who: `${MAYA},${LEO}`,
      type: 'spend,adjustment',
      rule: RULE,
      from: '2026-10-01',
      to: '2026-10-31',
      older: '2',
    });
    expect(f).toEqual({
      who: [MAYA, LEO],
      types: ['adjustment', 'spend'],
      rule: RULE,
      from: '2026-10-01',
      to: '2026-10-31',
      older: 2,
    });
    expect(registerHref(f)).toBe(
      `/admin/rewards/points?who=${MAYA},${LEO}&type=adjustment,spend&rule=${RULE}&from=2026-10-01&to=2026-10-31&older=2`,
    );
    expect(
      parseRegisterQuery(Object.fromEntries(new URL(registerHref(f), 'http://x').searchParams)),
    ).toEqual(f);
    expect(registerHref()).toBe('/admin/rewards/points');
    expect(registerHref({ rule: RULE }, '/dev/rewards/points')).toBe(
      `/dev/rewards/points?rule=${RULE}`,
    );
  });

  it('[PTS-08-h] leaves out what is not valid, and swaps dates the wrong way round', () => {
    expect(
      parseRegisterQuery({
        who: 'maya,,' + LEO,
        type: 'gift,bonus',
        rule: 'x',
        from: '2026-02-30',
        to: 'soon',
        older: '-1',
      }),
    ).toEqual({ who: [LEO], types: ['bonus'], rule: null, from: null, to: null, older: 0 });
    const f = parseRegisterQuery({ from: '2026-10-31', to: '2026-10-01' });
    expect([f.from, f.to]).toEqual(['2026-10-01', '2026-10-31']);
    expect(parseRegisterQuery({ older: '99999' }).older).toBe(200);
    expect(parseRegisterQuery({ older: '1.5' }).older).toBe(0);
    expect(parseRegisterQuery({ from: '2026-13-01', to: '2026-00-10' })).toMatchObject({
      from: null,
      to: null,
    });
  });

  it('[PTS-08-h] a chip toggles and starts from the newest again', () => {
    const f = parseRegisterQuery({ who: MAYA, older: '3' });
    expect(toggleWho(f, LEO)).toMatchObject({ who: [MAYA, LEO], older: 0 });
    expect(toggleWho(f, MAYA)).toMatchObject({ who: [], older: 0 });
    // Types keep the filter's order, whichever is tapped first.
    expect(toggleType(toggleType(f, 'spend'), 'earn').types).toEqual(['earn', 'spend']);
    expect(toggleType(parseRegisterQuery({ type: 'spend' }), 'spend').types).toEqual([]);
  });

  it('[PTS-08-h] More filters says the types and the days chosen', () => {
    const words = (d: string) => `<${d}>`;
    expect(read(moreLine(parseRegisterQuery({}), words))).toBe('**Any type** · any day');
    expect(
      read(moreLine(parseRegisterQuery({ type: 'adjustment,spend', from: '2026-10-01' }), words)),
    ).toBe('**By hand, Spent** · <2026-10-01> to today');
    expect(read(moreLine(parseRegisterQuery({ to: '2026-10-31', type: 'goal' }), words))).toBe(
      '**Goal payout** · the start to <2026-10-31>',
    );
  });
});

describe('[PTS-08] day headings in the household’s zone', () => {
  const at = (iso: string) => ({ at: iso });

  it('[PTS-08-i] an entry late in the evening there is that day, not the next UTC day', () => {
    // 04:30Z on Oct 27 is 23:30 on Oct 26 in Chicago (CDT).
    const groups = byDay(
      [
        at('2026-10-27T07:05:00Z'),
        at('2026-10-27T04:30:00Z'),
        at('2026-10-26T05:30:00Z'),
        at('2026-10-25T12:00:00Z'),
      ],
      'America/Chicago',
      '2026-10-27',
    );
    expect(groups.map((g) => [g.heading, g.entries.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 2],
      ['Sun, Oct 25', 1],
    ]);
  });

  it('[PTS-08-i] across a DST change, and on a day east of UTC', () => {
    // Sunday Nov 1, 2026: Chicago goes back from UTC−5 to UTC−6 at 07:00Z. 07:30Z is 01:30 CST and
    // 05:30Z 00:30 CDT, both Nov 1; 04:59Z is 23:59 CDT on Oct 31.
    const chicago = byDay(
      [at('2026-11-01T07:30:00Z'), at('2026-11-01T05:30:00Z'), at('2026-11-01T04:59:00Z')],
      'America/Chicago',
      '2026-11-01',
    );
    expect(chicago.map((g) => g.heading)).toEqual(['Today', 'Yesterday']);
    expect(chicago[0]!.entries).toHaveLength(2);
    // Auckland is UTC+13: 11:30Z on Oct 26 is already Oct 27 there.
    expect(
      byDay([at('2026-10-26T11:30:00Z')], 'Pacific/Auckland', '2026-10-27').map((g) => g.heading),
    ).toEqual(['Today']);
  });
});

describe('[PTS-08] the total line and a bonus’s payouts', () => {
  const o = {
    rule: false,
    name: (id: string) => names[id] ?? '?',
    timeZone: 'America/Chicago',
    today: '2026-10-27',
  };

  it('[PTS-08-j] how many match and what they add up to', () => {
    expect(
      read(
        totalLine(
          [
            {
              memberId: MAYA,
              entries: 150,
              added: 1000,
              taken: -400,
              latest: '2026-10-27T12:00:00Z',
            },
            { memberId: LEO, entries: 64, added: 380, taken: -55, latest: '2026-10-27T12:00:00Z' },
          ],
          o,
        ),
      ),
    ).toBe('**214 entries** · +1,380 · −455 · net **+925**');
    expect(
      read(
        totalLine(
          [{ memberId: MAYA, entries: 1, added: 0, taken: -40, latest: '2026-10-22T12:00:00Z' }],
          o,
        ),
      ),
    ).toBe('**1 entry** · −40');
    expect(read(totalLine([], o))).toBe('**No entries**');
  });

  it('[PTS-08-j] filtered to a bonus: how many times it paid, to whom, and the latest', () => {
    expect(
      read(
        totalLine(
          [
            { memberId: LEO, entries: 6, added: 30, taken: 0, latest: '2026-10-27T07:05:00Z' },
            { memberId: MAYA, entries: 8, added: 40, taken: 0, latest: '2026-10-25T07:05:00Z' },
          ],
          { ...o, rule: true },
        ),
      ),
    ).toBe('**Paid 14 times** · **+70** · Maya 8 times, Leo 6 · latest today');
    expect(
      read(
        totalLine(
          [{ memberId: MAYA, entries: 1, added: 20, taken: 0, latest: '2026-10-26T07:05:00Z' }],
          {
            ...o,
            rule: true,
          },
        ),
      ),
    ).toBe('**Paid once** · **+20** · Maya · latest yesterday');
  });

  it('[PTS-08-j] a bonus’s payouts beside it on Bonus points', () => {
    const z = 'America/Chicago';
    expect(read(payoutLine({ times: 14, latest: '2026-10-27T07:05:00Z' }, z, '2026-10-27'))).toBe(
      'Paid **14 times**, latest today',
    );
    expect(read(payoutLine({ times: 1, latest: '2026-10-25T07:05:00Z' }, z, '2026-10-27'))).toBe(
      'Paid **once**, Sun, Oct 25',
    );
    expect(read(payoutLine({ times: 2, latest: '2026-10-26T07:05:00Z' }, z, '2026-10-27'))).toBe(
      'Paid **twice**, latest yesterday',
    );
    expect(read(payoutLine(undefined, z, '2026-10-27'))).toBe('Not paid yet');
    expect([seeWords(1), seeWords(14)]).toEqual(['See it', 'See them']);
  });
});

describe('[PTS-08] Show older', () => {
  it('[PTS-08-k] each tap adds 50, read in parts the database answers whole', () => {
    expect(shownCount({ older: 0 })).toBe(50);
    expect(shownCount({ older: 2 })).toBe(150);
    expect(readParts(150)).toEqual([{ offset: 0, limit: 150 }]);
    expect(readParts(shownCount({ older: 40 }))).toEqual([
      { offset: 0, limit: 1000 },
      { offset: 1000, limit: 1000 },
      { offset: 2000, limit: 50 },
    ]);
    expect(shownLine(50, 214)).toBe('Showing the newest 50 of 214.');
    expect(shownLine(1050, 2140)).toBe('Showing the newest 1,050 of 2,140.');
    expect(shownLine(14, 14)).toBe('');
  });
});
