import { describe, expect, it } from 'vitest';
import { boardTables, coalesce, untilNextMinute } from './live';
import { readSnapshot } from './snapshot';

const RAW = {
  v: 1,
  fetched_at: '2026-10-09T14:02:03.123+00:00',
  today: '2026-10-09',
  range: { from: '2026-10-08', to: '2026-10-23' },
  household: {
    id: 'h1',
    name: 'Demo family',
    timezone: 'America/Chicago',
    week_start: 0,
    undo_window_seconds: 120,
  },
  device: { id: 'd1', name: 'Kitchen', theme: 'auto' },
  members: [
    {
      id: 'm1',
      display_name: 'Maya',
      role: 'child',
      avatar_key: 'owl',
      color: 'member-1',
      earns_rewards: true,
      points: {
        balance: 35,
        recent: [
          { id: 'p2', type: 'earn', amount: 5, at: '2026-10-09T13:00:00Z', label: 'Make bed' },
          { id: 'p1', type: 'earn', amount: 7, at: '2026-10-08T13:00:00Z', label: null },
        ],
      },
    },
    {
      id: 'm2',
      display_name: 'Alex',
      role: 'adult',
      avatar_key: null,
      color: 'member-3',
      earns_rewards: false,
      points: null,
    },
  ],
  occurrences: [
    {
      id: 'o1',
      chore_id: 'c1',
      title: 'Make bed',
      icon: 'chore-bed',
      kind: 'chore',
      due_date: '2026-10-09',
      due_time: '07:30',
      member_id: 'm1',
      assignees: ['m1'],
      status: 'completed',
      done_by: ['m1'],
      rewarded: ['m1'],
      points: 5,
      requires_approval: false,
      checked_at: '2026-10-09T12:31:00Z',
    },
  ],
};

describe('board snapshot', () => {
  it('[DEV-05] reads what board_snapshot returns', () => {
    expect(readSnapshot(RAW)).toEqual({
      v: 1,
      fetchedAt: '2026-10-09T14:02:03.123+00:00',
      today: '2026-10-09',
      range: { from: '2026-10-08', to: '2026-10-23' },
      household: {
        id: 'h1',
        name: 'Demo family',
        timezone: 'America/Chicago',
        weekStart: 0,
        undoWindowSeconds: 120,
      },
      device: { id: 'd1', name: 'Kitchen', theme: 'auto' },
      members: [
        {
          id: 'm1',
          displayName: 'Maya',
          role: 'child',
          avatarKey: 'owl',
          color: 'member-1',
          earnsRewards: true,
          points: {
            balance: 35,
            recent: [
              { id: 'p2', type: 'earn', amount: 5, at: '2026-10-09T13:00:00Z', label: 'Make bed' },
              { id: 'p1', type: 'earn', amount: 7, at: '2026-10-08T13:00:00Z', label: null },
            ],
          },
          streak: null,
        },
        {
          id: 'm2',
          displayName: 'Alex',
          role: 'adult',
          avatarKey: null,
          color: 'member-3',
          earnsRewards: false,
          points: null,
          streak: null,
        },
      ],
      occurrences: [
        {
          id: 'o1',
          choreId: 'c1',
          title: 'Make bed',
          icon: 'chore-bed',
          kind: 'chore',
          dueDate: '2026-10-09',
          dueTime: '07:30',
          memberId: 'm1',
          assignees: ['m1'],
          status: 'completed',
          doneBy: ['m1'],
          rewarded: ['m1'],
          points: 5,
          requiresApproval: false,
          checkedAt: '2026-10-09T12:31:00Z',
        },
      ],
    });
  });

  it('[BRD-01] refuses an item in a status it does not know; an older snapshot has no items', () => {
    const odd = { ...RAW, occurrences: [{ ...RAW.occurrences[0], status: 'lost' }] };
    expect(() => readSnapshot(odd)).toThrow('unknown occurrence');
    expect(readSnapshot({ ...RAW, occurrences: undefined })?.occurrences).toEqual([]);
  });

  it("[PTS-02] reads each rewarded member's points; refuses an entry it does not know", () => {
    const maya = RAW.members[0]!;
    const withEntry = (entry: unknown) => ({
      ...RAW,
      members: [{ ...maya, points: { balance: 1, recent: [entry] } }],
    });
    expect(() => readSnapshot(withEntry({ ...maya.points!.recent[0], type: 'gift' }))).toThrow(
      'unknown points entry',
    );
    expect(() =>
      readSnapshot({ ...RAW, members: [{ ...maya, points: { balance: '35', recent: [] } }] }),
    ).toThrow('points are not a balance');
    // A snapshot from before points (an older database) reads as no points.
    expect(
      readSnapshot({ ...RAW, members: [{ ...maya, points: undefined }] })?.members[0]?.points,
    ).toBeNull();
  });

  it('[DEV-02] no snapshot means the board is not active', () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot(undefined)).toBeNull();
  });

  it('[DEV-05] keeps a held theme and treats anything else as automatic', () => {
    const held = { ...RAW, device: { ...RAW.device, theme: 'evening' } };
    expect(readSnapshot(held)?.device.theme).toBe('evening');
    const odd = { ...RAW, device: { ...RAW.device, theme: 'dusk' } };
    expect(readSnapshot(odd)?.device.theme).toBe('auto');
  });

  it('[DEV-05] refuses a shape this build does not know, rather than drawing half a board', () => {
    expect(() => readSnapshot({ ...RAW, v: 2 })).toThrow('unknown shape');
    expect(() => readSnapshot({ ...RAW, members: undefined })).toThrow('missing part');
    expect(() => readSnapshot({ ...RAW, household: { ...RAW.household, name: 7 } })).toThrow(
      'name is not text',
    );
    expect(() => readSnapshot({ ...RAW, members: [null] })).toThrow('member');
  });

  it('[RWD-05] reads a member’s run as of the last closed day (WP-17); an unknown kind is no run', () => {
    const member = (streak: unknown) =>
      readSnapshot({
        ...RAW,
        members: [{ ...(RAW.members as Record<string, unknown>[])[0], streak }],
      })!.members[0]!.streak;
    expect(member({ kind: 'good', length: 4, best: 9 })).toEqual({
      kind: 'good',
      length: 4,
      best: 9,
    });
    expect(member({ kind: null, length: 0, best: 0 })).toEqual({ kind: null, length: 0, best: 0 });
    expect(member({ kind: 'great', length: 'x' })).toEqual({ kind: null, length: 0, best: 0 });
    expect(member(null)).toBeNull();
  });
});

describe('notify, then refetch', () => {
  it('[DEV-05] listens to every board-readable table, filtered to this board', () => {
    expect(boardTables('h1', 'd1')).toEqual([
      { table: 'household', filter: 'id=eq.h1' },
      { table: 'household_settings', filter: 'household_id=eq.h1' },
      { table: 'member', filter: 'household_id=eq.h1' },
      { table: 'device', filter: 'id=eq.d1' },
      { table: 'points_ledger', filter: 'household_id=eq.h1' },
      { table: 'chore_occurrence', filter: 'household_id=eq.h1' },
      { table: 'chore', filter: 'household_id=eq.h1' },
      { table: 'streak_segment', filter: 'household_id=eq.h1' },
    ]);
  });

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('[DEV-05] a burst of changes costs at most two reads, the last after the last change', async () => {
    const reads: ReturnType<typeof deferred>[] = [];
    const run = coalesce(() => {
      const d = deferred();
      reads.push(d);
      return d.promise;
    });
    const first = run();
    run();
    run();
    run();
    expect(reads).toHaveLength(1);
    reads[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toHaveLength(2);
    reads[1]!.resolve();
    await first;
    expect(reads).toHaveLength(2);

    // Idle again: the next change reads at once.
    void run();
    expect(reads).toHaveLength(3);
    reads[2]!.resolve();
  });

  it('[DEV-05] a read that fails does not stop the next one', async () => {
    let calls = 0;
    const run = coalesce(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network');
    });
    await run();
    await run();
    expect(calls).toBe(2);
  });

  it('ticks on the minute', () => {
    expect(untilNextMinute(new Date(2026, 9, 9, 7, 42, 0, 0))).toBe(60_000);
    expect(untilNextMinute(new Date(2026, 9, 9, 7, 42, 59, 500))).toBe(500);
  });
});
