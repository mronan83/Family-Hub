import { describe, expect, it } from 'vitest';
import {
  amountInput,
  money,
  owedTotal,
  parseGivePenalty,
  parseMoney,
  parsePaid,
  parseReason,
  penaltyAmount,
  penaltyHistory,
  penaltyMessage,
  type PenaltyReason,
  withOwed,
} from './penalties';
import { ledgerLine } from './points';
import { entryWords, KIND_LABEL } from './points-register';
import { boardActivity } from './today';

const MAYA = '0de00000-0000-4000-8000-0000000000c1';
const REQ = '0de00000-0000-4000-8000-0000000000f1';
const RUDE: PenaltyReason = {
  id: '0de00000-0000-4000-8000-0000000000e1',
  name: 'Rude to a sibling',
  unit: 'points',
  amount: 10,
};
const BIKE: PenaltyReason = {
  id: '0de00000-0000-4000-8000-0000000000e2',
  name: 'Left bike in the driveway',
  unit: 'money',
  amount: 100,
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('[PTS-09] penalties in words and money', () => {
  it('[PTS-09-j] says money in dollars and points as points', () => {
    expect(money(100)).toBe('$1');
    expect(money(250)).toBe('$2.50');
    expect(money(5)).toBe('$0.05');
    expect(money(100_000)).toBe('$1,000');
    expect(penaltyAmount('points', 1)).toBe('1 point');
    expect(penaltyAmount('points', 20)).toBe('20 points');
    expect(penaltyAmount('money', 300)).toBe('$3');
    expect(amountInput('money', 150)).toBe('1.50');
    expect(amountInput('money', 200)).toBe('2');
    expect(amountInput('points', 10)).toBe('10');
  });

  it('[PTS-09-j] reads a typed amount of money in cents', () => {
    expect(parseMoney('1')).toBe(100);
    expect(parseMoney('$1.5')).toBe(150);
    expect(parseMoney(' 2.05 ')).toBe(205);
    expect(parseMoney('1,000')).toBe(100_000);
    expect(parseMoney('1.234')).toBeNaN();
    expect(parseMoney('-1')).toBeNaN();
    expect(parseMoney('')).toBeNaN();
  });

  it('[PTS-09-j] checks Give a penalty the way give_penalty() will', () => {
    const ok = parseGivePenalty(
      form({ memberId: MAYA, reasonId: BIKE.id, amount: '2.50', requestId: REQ }),
      [RUDE, BIKE],
    );
    expect(ok).toEqual({
      ok: true,
      value: { memberId: MAYA, reasonId: BIKE.id, amount: 250, requestId: REQ },
    });
    expect(
      parseGivePenalty(form({ memberId: MAYA, reasonId: RUDE.id, amount: '10', requestId: REQ }), [
        RUDE,
      ]),
    ).toMatchObject({
      ok: true,
      value: { amount: 10 },
    });
    expect(
      parseGivePenalty(form({ reasonId: RUDE.id, amount: '10', requestId: REQ }), [RUDE]),
    ).toEqual({
      ok: false,
      message: 'Choose who the penalty is for.',
    });
    expect(
      parseGivePenalty(form({ memberId: MAYA, reasonId: 'x', amount: '10', requestId: REQ }), [
        RUDE,
      ]),
    ).toEqual({
      ok: false,
      message: 'Choose a reason from the list.',
    });
    expect(
      parseGivePenalty(form({ memberId: MAYA, reasonId: RUDE.id, amount: '1.5', requestId: REQ }), [
        RUDE,
      ]),
    ).toEqual({
      ok: false,
      message: 'Enter a whole number of points from 1 to 10,000.',
    });
    expect(
      parseGivePenalty(form({ memberId: MAYA, reasonId: BIKE.id, amount: '0', requestId: REQ }), [
        BIKE,
      ]),
    ).toEqual({
      ok: false,
      message: 'Enter an amount from $0.01 to $1,000.',
    });
  });

  it('[PTS-09-j] checks Record paid: up to what is owed', () => {
    const f = (amount: string) => form({ penaltyId: BIKE.id, amount, requestId: REQ });
    expect(parsePaid(f('1'), 100)).toEqual({
      ok: true,
      value: { penaltyId: BIKE.id, amount: 100, requestId: REQ },
    });
    expect(parsePaid(f('1.01'), 100)).toEqual({
      ok: false,
      message: 'Enter an amount from $0.01 to $1, what is owed.',
    });
  });

  it('[PTS-09-j] checks a new reason', () => {
    expect(
      parseReason(form({ name: ' Left the lights on ', unit: 'points', amount: '5' })),
    ).toEqual({
      ok: true,
      value: { name: 'Left the lights on', unit: 'points', amount: 5 },
    });
    expect(parseReason(form({ name: '', unit: 'points', amount: '5' }))).toMatchObject({
      ok: false,
    });
    expect(parseReason(form({ name: 'Late', unit: 'cash', amount: '5' }))).toEqual({
      ok: false,
      message: 'Choose points or money.',
    });
  });

  it('[PTS-09-j] says what the database refused, plainly', () => {
    expect(penaltyMessage({ hint: 'penalties_off' })).toBe(
      'Penalties are off. Turn them on in Settings, Penalties.',
    );
    expect(penaltyMessage({ hint: 'not_earning' }, 'Alex')).toBe(
      'Alex doesn’t earn rewards, so they can’t be given a penalty.',
    );
    expect(penaltyMessage({ code: '42501' })).toBe('Only a parent of this household can do that.');
    expect(penaltyMessage({})).toBe('Nothing was changed. Try again in a moment.');
  });

  it('[PTS-09-j] works out what is owed, and the history newest first', () => {
    const base = { memberId: MAYA, givenBy: 'u-sam', takenBackAt: null, takenBackBy: null };
    const rows = withOwed(
      [
        {
          ...base,
          id: 'p1',
          reason: 'Left bike in the driveway',
          unit: 'money',
          amount: 300,
          givenAt: '2026-11-16T15:00:00Z',
        },
        {
          ...base,
          id: 'p2',
          reason: 'Rude to a sibling',
          unit: 'points',
          amount: 10,
          givenAt: '2026-11-19T23:40:00Z',
        },
        {
          ...base,
          id: 'p3',
          reason: 'Slammed a door',
          unit: 'money',
          amount: 100,
          givenAt: '2026-11-17T15:00:00Z',
          takenBackAt: '2026-11-17T16:00:00Z',
          takenBackBy: 'u-alex',
        },
      ],
      [
        {
          id: 'x1',
          penaltyId: 'p1',
          amount: 200,
          recordedAt: '2026-11-18T15:00:00Z',
          recordedBy: 'u-sam',
        },
      ],
    );
    expect(rows.map((p) => p.owed)).toEqual([100, 0, 0]);
    expect(owedTotal(rows)).toBe(100);
    const h = penaltyHistory(rows, [
      {
        id: 'x1',
        penaltyId: 'p1',
        amount: 200,
        recordedAt: '2026-11-18T15:00:00Z',
        recordedBy: 'u-sam',
      },
    ]);
    expect(h.map((e) => `${e.tag}:${e.what}:${e.amount}:${e.takeBack ?? '-'}`)).toEqual([
      'Penalty:Rude to a sibling:−10 pts:p2',
      'Paid:Paid for Left bike in the driveway:−$2 owed:-',
      'Taken back:Slammed a door:−$1 owed:-',
      'Penalty:Slammed a door:+$1 owed:-',
      'Penalty:Left bike in the driveway:+$3 owed:p1',
    ]);
  });

  it('[PTS-09-j] names a penalty in the ledger, the register and on the board', () => {
    const e = {
      id: 'l1',
      type: 'penalty' as const,
      amount: -10,
      at: '2026-11-19T23:40:00Z',
      label: 'Rude to a sibling',
      by: 'u-sam',
    };
    expect(ledgerLine(e, () => 'Sam')).toBe('Penalty: Rude to a sibling · by Sam');
    expect(ledgerLine({ ...e, amount: 10 }, () => 'Sam')).toBe(
      'Penalty taken back: Rude to a sibling · by Sam',
    );
    expect(boardActivity(e)).toBe('Rude to a sibling');
    expect(KIND_LABEL.penalty).toBe('Penalty');
    expect(
      entryWords(
        {
          id: 'l1',
          memberId: MAYA,
          kind: 'penalty',
          amount: -10,
          at: e.at,
          reason: 'Rude to a sibling',
          forItem: false,
          itemTitle: null,
          goalId: null,
          goalTitle: null,
          ruleId: null,
          byType: 'admin',
          by: 'u-sam',
        },
        () => 'Sam',
      ),
    ).toEqual({ what: 'Rude to a sibling', by: 'by Sam' });
  });
});
