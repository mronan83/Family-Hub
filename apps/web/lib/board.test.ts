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
  // [BRD-05] The household's layout (seven days, Goals first) and no layout of this board's own.
  layout: { household: { calendar: '7', cards: [{ id: 'goals', show: true }] }, board: null },
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
      wish: { item_id: 'r1', title: 'Movie night', icon: 'ticket', cost: 100 },
    },
    {
      id: 'm2',
      display_name: 'Alex',
      role: 'adult',
      avatar_key: null,
      color: 'member-3',
      earns_rewards: false,
      points: null,
      wish: null,
    },
  ],
  shop: [
    { id: 'r1', title: 'Movie night', icon: 'ticket', cost: 100 },
    { id: 'r2', title: 'Ice cream trip', icon: 'snack', cost: 40 },
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
      layout: {
        household: {
          calendar: '7',
          cards: [
            { id: 'goals', show: true },
            { id: 'meals', show: true },
            { id: 'waiting', show: true },
            { id: 'coming', show: true },
          ],
        },
        board: null,
      },
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
          wish: { id: 'r1', title: 'Movie night', icon: 'ticket', cost: 100 },
          // A snapshot from before WP-20: all of the balance can be spent, nothing asked for.
          available: 35,
          requests: [],
          limited: [],
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
          wish: null,
          available: null,
          requests: [],
          limited: [],
        },
      ],
      shop: [
        { id: 'r1', title: 'Movie night', icon: 'ticket', cost: 100 },
        { id: 'r2', title: 'Ice cream trip', icon: 'snack', cost: 40 },
      ],
      goals: [],
      // A snapshot from before WP-23 has no calendar.
      calendar: null,
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
          description: null,
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

describe('wishes in the snapshot', () => {
  it('[PTS-06] reads the shop and each child’s wish (WP-30); an older snapshot has neither', () => {
    const old = readSnapshot({
      ...RAW,
      shop: undefined,
      members: (RAW.members as Record<string, unknown>[]).map((m) => ({ ...m, wish: undefined })),
    })!;
    expect(old.shop).toEqual([]);
    expect(old.members.map((m) => m.wish)).toEqual([null, null]);
    // Something that isn't a reward (no id, or no title) is left out of the shop, and is no wish.
    const odd = readSnapshot({ ...RAW, shop: [null, { title: 'No id' }, RAW.shop[1]] })!;
    expect(odd.shop.map((i) => i.id)).toEqual(['r2']);
    const bare = readSnapshot({
      ...RAW,
      members: [{ ...(RAW.members as Record<string, unknown>[])[0], wish: { item_id: 'r9' } }],
    })!;
    expect(bare.members[0]!.wish).toBeNull();
    const plain = readSnapshot({
      ...RAW,
      members: [
        {
          ...(RAW.members as Record<string, unknown>[])[0],
          wish: { item_id: 'r9', title: 'Kite' },
        },
      ],
    })!;
    expect(plain.members[0]!.wish).toEqual({ id: 'r9', title: 'Kite', icon: 'gift', cost: 0 });
  });
});

describe('the shop, requests and goals (WP-20)', () => {
  const maya = (RAW.members as Record<string, unknown>[])[0]!;
  const read = (member: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    readSnapshot({ ...RAW, members: [{ ...maya, ...member }], ...extra })!;

  it('[PTS-04] reads what a child can spend, their requests and their weekly limits', () => {
    const s = read({
      available: 5,
      requests: [
        {
          id: 'q1',
          item_id: 'r1',
          title: 'Movie night',
          icon: 'ticket',
          cost: 30,
          status: 'requested',
          at: '2026-10-09T13:00:00Z',
        },
        { id: 'q2', item_id: 'r2', title: 'Kite', cost: 5, status: 'lost', at: 'x' },
      ],
      limited: ['r2', 7],
    });
    expect(s.members[0]).toMatchObject({
      available: 5,
      requests: [
        {
          id: 'q1',
          itemId: 'r1',
          title: 'Movie night',
          icon: 'ticket',
          cost: 30,
          status: 'requested',
          at: '2026-10-09T13:00:00Z',
        },
      ],
      limited: ['r2'],
    });
  });

  it('[PTS-03] reads how many of a reward are left and its photo; a wish has neither', () => {
    const s = read(
      {},
      {
        shop: [
          {
            id: 'r1',
            title: 'Movie night',
            icon: 'ticket',
            cost: 100,
            photo: 'h/r1/a.jpg',
            left: 2,
          },
          { id: 'r2', title: 'Kite', icon: 'star', cost: 15, photo: null, left: null },
        ],
      },
    );
    expect(s.shop).toEqual([
      { id: 'r1', title: 'Movie night', icon: 'ticket', cost: 100, photo: 'h/r1/a.jpg', left: 2 },
      { id: 'r2', title: 'Kite', icon: 'star', cost: 15, photo: null, left: null },
    ]);
    expect(s.members[0]!.wish).toEqual({
      id: 'r1',
      title: 'Movie night',
      icon: 'ticket',
      cost: 100,
    });
  });

  it('[RWD-07] reads the goals in play with each rule; leaves out what it cannot draw', () => {
    const s = read(
      {},
      {
        goals: [
          {
            id: 'g1',
            member_id: 'm1',
            title: 'Zoo trip',
            icon: 'star',
            photo: null,
            status: 'achieved',
            n: 2,
            achieved_at: '2026-10-09T13:00:00Z',
            celebrate: true,
            end_date: '2026-10-20',
            logic: 'any',
            pct: 100,
            rules: [
              {
                id: 'r1',
                type: 'STREAK',
                target: 5,
                current: 5,
                pct: 100,
                met: true,
                streak: 5,
                best: 5,
              },
              { id: 'r2', type: 'MAGIC', target: 1 },
            ],
          },
          { id: 'g2', member_id: null, title: 'Old', icon: 'star', status: 'redeemed', rules: [] },
          { id: 'g3', member_id: null, title: 'Pizza night', status: 'active', logic: 'all' },
        ],
      },
    );
    expect(s.goals).toEqual([
      {
        id: 'g1',
        memberId: 'm1',
        title: 'Zoo trip',
        icon: 'star',
        photo: null,
        status: 'achieved',
        n: 2,
        achievedAt: '2026-10-09T13:00:00Z',
        celebrate: true,
        endDate: '2026-10-20',
        logic: 'any',
        pct: 100,
        rules: [
          {
            id: 'r1',
            type: 'STREAK',
            target: 5,
            current: 5,
            pct: 100,
            met: true,
            streak: 5,
            best: 5,
          },
        ],
      },
      {
        id: 'g3',
        memberId: null,
        title: 'Pizza night',
        icon: 'trophy',
        photo: null,
        status: 'active',
        n: 0,
        achievedAt: null,
        celebrate: false,
        endDate: null,
        logic: 'all',
        pct: 0,
        rules: [],
      },
    ]);
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
      { table: 'wishlist_pin', filter: 'household_id=eq.h1' },
      { table: 'reward_catalog_item', filter: 'household_id=eq.h1' },
      { table: 'redemption', filter: 'household_id=eq.h1' },
      { table: 'reward_goal', filter: 'household_id=eq.h1' },
      { table: 'reward_goal_progress', filter: 'household_id=eq.h1' },
      { table: 'reward_rule_progress', filter: 'household_id=eq.h1' },
      { table: 'calendar_source', filter: 'household_id=eq.h1' },
      { table: 'device_calendar', filter: 'device_id=eq.d1' },
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
