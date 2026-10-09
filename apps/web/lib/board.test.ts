import { describe, expect, it } from 'vitest';
import { boardTables, coalesce, untilNextMinute } from './live';
import { readSnapshot } from './snapshot';

const RAW = {
  v: 1,
  fetched_at: '2026-10-09T14:02:03.123+00:00',
  today: '2026-10-09',
  range: { from: '2026-10-08', to: '2026-10-23' },
  household: { id: 'h1', name: 'Demo family', timezone: 'America/Chicago', week_start: 0 },
  device: { id: 'd1', name: 'Kitchen', theme: 'auto' },
  members: [
    {
      id: 'm1',
      display_name: 'Maya',
      role: 'child',
      avatar_key: 'owl',
      color: 'member-1',
      earns_rewards: true,
    },
    {
      id: 'm2',
      display_name: 'Alex',
      role: 'adult',
      avatar_key: null,
      color: 'member-3',
      earns_rewards: false,
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
      household: { id: 'h1', name: 'Demo family', timezone: 'America/Chicago', weekStart: 0 },
      device: { id: 'd1', name: 'Kitchen', theme: 'auto' },
      members: [
        {
          id: 'm1',
          displayName: 'Maya',
          role: 'child',
          avatarKey: 'owl',
          color: 'member-1',
          earnsRewards: true,
        },
        {
          id: 'm2',
          displayName: 'Alex',
          role: 'adult',
          avatarKey: null,
          color: 'member-3',
          earnsRewards: false,
        },
      ],
    });
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
});

describe('notify, then refetch', () => {
  it('[DEV-05] listens to every board-readable table, filtered to this board', () => {
    expect(boardTables('h1', 'd1')).toEqual([
      { table: 'household', filter: 'id=eq.h1' },
      { table: 'household_settings', filter: 'household_id=eq.h1' },
      { table: 'member', filter: 'household_id=eq.h1' },
      { table: 'device', filter: 'id=eq.d1' },
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
