import { ENGINE_VERSION, type OccurrenceFact } from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  dayBefore,
  duration,
  heatmapWeeks,
  historyRows,
  percent,
  rebuildMemberHistory,
} from './history';

// The 14 days of supabase/tests/190_streak_history.test.sql, as member_history_facts gives them to
// the engine: Kid's Make bed (Morning, 5), Brush teeth (Morning, 2) and Set the table (Kitchen, 5).
const KID = 'kid';
const day = (k: number) => `2026-10-${String(k).padStart(2, '0')}`;
const THROUGH = day(14);

function fact(
  chore: 'bed' | 'teeth' | 'table',
  k: number,
  status: OccurrenceFact['status'],
): OccurrenceFact {
  const spec = { bed: ['morning', 5], teeth: ['morning', 2], table: ['kitchen', 5] } as const;
  return {
    id: `${chore}-${k}`,
    chore_id: chore,
    member_id: KID,
    kind: 'chore',
    tag_ids: [spec[chore][0]],
    due_date: day(k),
    credit_date: day(k),
    status,
    credited: status === 'completed' || status === 'approved',
    points: spec[chore][1],
  };
}

const FACTS: OccurrenceFact[] = [];
for (let k = 1; k <= 14; k++) {
  FACTS.push(
    fact('bed', k, k === 11 ? 'skipped' : k === 6 || k === 7 ? 'missed' : 'completed'),
    fact('teeth', k, k === 11 ? 'skipped' : k === 3 || k === 6 ? 'missed' : 'completed'),
    fact(
      'table',
      k,
      k === 5 || k === 11 ? 'skipped' : k === 6 ? 'missed' : k === 13 ? 'covered' : 'approved',
    ),
  );
}

// The hand-computed table (the same rows the pgTAP test saves).
const DAYS: [number, number, number, number, number, number, string][] = [
  // k, done, missed, skipped, covered, points, class
  [1, 3, 0, 0, 0, 12, 'good'],
  [2, 3, 0, 0, 0, 12, 'good'],
  [3, 2, 1, 0, 0, 10, 'bad'],
  [4, 3, 0, 0, 0, 12, 'good'],
  [5, 2, 0, 1, 0, 7, 'good'],
  [6, 0, 3, 0, 0, 0, 'bad'],
  [7, 2, 1, 0, 0, 7, 'bad'],
  [8, 3, 0, 0, 0, 12, 'good'],
  [9, 3, 0, 0, 0, 12, 'good'],
  [10, 3, 0, 0, 0, 12, 'good'],
  [11, 0, 0, 3, 0, 0, 'neutral'],
  [12, 3, 0, 0, 0, 12, 'good'],
  [13, 2, 0, 0, 1, 7, 'good'],
  [14, 3, 0, 0, 0, 12, 'good'],
];

describe('a member’s stored history', () => {
  it('[RWD-11] 14 days read by the engine match the hand-computed table, day by day and run by run', () => {
    const rows = historyRows(KID, FACTS, THROUGH);
    expect(rows.through).toBe(THROUGH);
    expect(rows.days).toEqual(
      DAYS.map(([k, done, missed, skipped, covered, points, dayClass]) => ({
        date: day(k),
        scheduled: 3,
        done,
        missed,
        skipped,
        covered,
        points,
        dayClass,
      })),
    );
    // A neutral day (d11) passes over, so d8 to d14 is one good run, still going.
    expect(rows.segments).toEqual([
      { kind: 'good', start: day(1), end: day(2), length: 2 },
      { kind: 'bad', start: day(3), end: day(3), length: 1 },
      { kind: 'good', start: day(4), end: day(5), length: 2 },
      { kind: 'bad', start: day(6), end: day(7), length: 2 },
      { kind: 'good', start: day(8), end: null, length: 6 },
    ]);
  });

  it('[RWD-11][D-55] a miss on the last closed day makes it bad and ends the good run there', () => {
    // As the seed's Leo: everything done but yesterday's bed. Yesterday is a closed day, not today.
    const facts = FACTS.map((f) =>
      f.id === 'bed-14' ? { ...f, status: 'missed' as const, credited: false } : f,
    );
    const rows = historyRows(KID, facts, THROUGH);
    expect(rows.days.at(-1)).toMatchObject({ date: THROUGH, done: 2, missed: 1, dayClass: 'bad' });
    expect(rows.segments.slice(-2)).toEqual([
      { kind: 'good', start: day(8), end: day(13), length: 5 },
      { kind: 'bad', start: day(14), end: null, length: 1 },
    ]);
  });

  it('[RWD-11] the same facts in any order give the same rows (a rebuild changes nothing)', () => {
    const once = historyRows(KID, FACTS, THROUGH);
    const shuffled = [...FACTS].reverse();
    expect(historyRows(KID, shuffled, THROUGH)).toEqual(once);
  });

  it('[RWD-11] a member with no routines yet has no history', () => {
    expect(historyRows(KID, [], THROUGH)).toEqual({ through: THROUGH, days: [], segments: [] });
  });

  it('[RWD-11] rebuilding reads the facts, saves what the engine made of them, and says how much', async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'member_history_facts') {
        expect(args).toEqual({ p_member: KID, p_through: THROUGH });
        return { data: { read_at: '2026-10-15T06:00:00Z', facts: FACTS }, error: null };
      }
      return { data: { days: 14, segments: 5 }, error: null };
    });
    const db = { rpc } as unknown as SupabaseClient;
    expect(await rebuildMemberHistory(db, KID, THROUGH)).toEqual({ days: 14, segments: 5 });
    const saved = rpc.mock.calls[1]!;
    expect(saved[0]).toBe('save_member_history');
    expect(saved[1]).toMatchObject({
      p_member: KID,
      p_through: THROUGH,
      p_engine_version: ENGINE_VERSION,
      p_read_at: '2026-10-15T06:00:00Z',
    });
    expect(saved[1]).toEqual({ ...saved[1], ...historyRowsArgs() });
    // Twice: the same rows are sent.
    await rebuildMemberHistory(db, KID, THROUGH);
    expect(rpc.mock.calls[3]![1]).toEqual(saved[1]);
  });

  it('a database refusal is an error, not an empty history', async () => {
    const db = {
      rpc: async () => ({ data: null, error: { message: 'not allowed' } }),
    } as unknown as SupabaseClient;
    await expect(rebuildMemberHistory(db, KID, THROUGH)).rejects.toThrow('not allowed');
  });
});

function historyRowsArgs() {
  const rows = historyRows(KID, FACTS, THROUGH);
  return { p_days: rows.days, p_segments: rows.segments };
}

describe('the insights page’s words and grid', () => {
  it('says rates and times plainly', () => {
    expect(percent(32, 37)).toBe('86%');
    expect(percent(0, 0)).toBe('—');
    expect(duration(7200)).toBe('2 hours');
    expect(duration(5400)).toBe('1.5 hours');
    expect(duration(60)).toBe('a minute');
    expect(duration(1500)).toBe('25 minutes');
    expect(duration(3600)).toBe('an hour');
    expect(duration(30)).toBe('under a minute');
    expect(duration(3 * 86400)).toBe('3 days');
    expect(duration(null)).toBe('—');
  });

  it('[RWD-12] lays the days out in weeks from the household’s first day of the week', () => {
    // 2026-10-01 is a Thursday; weeks start on Sunday (0).
    const weeks = heatmapWeeks(
      [{ date: '2026-10-02', class: 'good' }],
      '2026-10-01',
      '2026-10-04',
      0,
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]![4]).toEqual({ date: '2026-10-01', empty: true });
    expect(weeks[0]![5]).toEqual({ date: '2026-10-02', class: 'good' });
    expect(weeks[1]![0]).toEqual({ date: '2026-10-04', empty: true });
    expect(weeks[1]![1]).toBeNull();
    // Monday (1) as the first day.
    expect(heatmapWeeks([], '2026-10-05', '2026-10-11', 1)).toHaveLength(1);
  });

  it('knows the day before, across months and years', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
