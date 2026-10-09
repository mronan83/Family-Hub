import { describe, expect, it } from 'vitest';
import {
  adjustmentMessage,
  balanceText,
  type LedgerEntry,
  ledgerDay,
  ledgerLine,
  parseAdjustment,
  pointsWord,
  signed,
} from './points';

const MEMBER = '0f110000-0000-4000-8000-000000000001';
const REQUEST = '0fad0000-0000-4000-8000-000000000001';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const ok = {
  memberId: MEMBER,
  requestId: REQUEST,
  direction: 'add',
  points: '10',
  reason: 'Helped a neighbour',
};

describe('the adjustment form', () => {
  it('[PTS-01] adds points with a reason, trimmed', () => {
    expect(parseAdjustment(form({ ...ok, reason: '  Helped a neighbour ' }))).toEqual({
      ok: true,
      value: { memberId: MEMBER, amount: 10, reason: 'Helped a neighbour', requestId: REQUEST },
    });
  });

  it('[PTS-01] takes points away as a negative amount', () => {
    const parsed = parseAdjustment(form({ ...ok, direction: 'take', points: '5' }));
    expect(parsed.ok && parsed.value.amount).toBe(-5);
  });

  it('[PTS-01] needs a whole number of points from 1 to 10000', () => {
    for (const points of ['0', '10001', '2.5', '-3', 'ten', '']) {
      expect(parseAdjustment(form({ ...ok, points }))).toEqual({
        ok: false,
        message: 'Enter a whole number of points from 1 to 10000.',
      });
    }
    expect(parseAdjustment(form({ ...ok, points: '10000' })).ok).toBe(true);
  });

  it('[PTS-01] needs a reason of up to 200 characters', () => {
    expect(parseAdjustment(form({ ...ok, reason: '   ' })).ok).toBe(false);
    expect(parseAdjustment(form({ ...ok, reason: 'x'.repeat(201) })).ok).toBe(false);
    expect(parseAdjustment(form({ ...ok, reason: 'x'.repeat(200) })).ok).toBe(true);
  });

  it('[PTS-01] needs add or take away, the member and a request id', () => {
    expect(parseAdjustment(form({ ...ok, direction: 'double' })).ok).toBe(false);
    expect(parseAdjustment(form({ ...ok, memberId: 'maya' })).ok).toBe(false);
    expect(parseAdjustment(form({ ...ok, requestId: '' })).ok).toBe(false);
  });

  it('[PTS-01][PTS-07] says plainly what the database refused', () => {
    expect(adjustmentMessage({ code: '22023', hint: 'not_earning' }, 'Pat')).toBe(
      'Pat doesn’t earn rewards. Turn on Earns rewards above to give them points.',
    );
    expect(adjustmentMessage({ code: '22023', hint: 'member_archived' }, 'Zed')).toMatch(
      /archived/,
    );
    expect(adjustmentMessage({ code: '22023', hint: 'request_reused' }, 'Maya')).toMatch(/Reload/);
    expect(adjustmentMessage({ code: '42501', hint: 'not_allowed' }, 'Maya')).toBe(
      'Only an admin of this household can change points.',
    );
    expect(adjustmentMessage({ code: 'XX000' }, 'Maya')).toMatch(/weren’t changed/);
  });
});

describe('points in words', () => {
  it('[PTS-02] counts points', () => {
    expect(pointsWord(1)).toBe('1 point');
    expect(pointsWord(35)).toBe('35 points');
    expect(signed(5)).toBe('+5');
    expect(signed(-5)).toBe('−5');
  });

  it('[PTS-02] shows a parent a balance plainly, below zero with a minus sign', () => {
    expect(balanceText(35)).toBe('35 points');
    expect(balanceText(0)).toBe('0 points');
    expect(balanceText(-20)).toBe('−20 points');
    expect(balanceText(-1)).toBe('−1 point');
  });

  const entry = (e: Partial<LedgerEntry>): LedgerEntry => ({
    id: 'e1',
    type: 'earn',
    amount: 5,
    at: '2026-10-09T13:00:00Z',
    label: 'Make bed',
    by: null,
    ...e,
  });
  const names = (id: string) => (id === 'u1' ? 'Alex' : 'someone');

  it('[PTS-01] describes each entry for a parent', () => {
    expect(ledgerLine(entry({}), names)).toBe('Make bed');
    expect(ledgerLine(entry({ type: 'reversal', amount: -5 }), names)).toBe('Reversed Make bed');
    expect(ledgerLine(entry({ type: 'reversal', amount: -5, label: null }), names)).toBe(
      'Reversed a private item',
    );
    expect(ledgerLine(entry({ label: null }), names)).toBe('A private item');
    expect(
      ledgerLine(
        entry({ type: 'adjustment', amount: 10, label: 'Helped a neighbour', by: 'u1' }),
        names,
      ),
    ).toBe('Helped a neighbour · by Alex');
  });

  it("[PTS-01] dates each entry by the household's day", () => {
    // 01:30 UTC on the 10th is still the 9th in Chicago.
    expect(ledgerDay('2026-10-10T01:30:00Z', 'America/Chicago', '2026-10-09')).toBe('Today');
    expect(ledgerDay('2026-10-08T15:00:00Z', 'America/Chicago', '2026-10-09')).toBe('Yesterday');
    expect(ledgerDay('2026-10-05T15:00:00Z', 'America/Chicago', '2026-10-09')).toBe('Mon, Oct 5');
  });
});
