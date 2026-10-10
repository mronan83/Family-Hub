import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import schedule from './schedule.json';
import { JOBS } from './registry';

describe('[NFR-07] schedule and job registry', () => {
  const http = schedule.jobs.filter((j) => j.kind === 'http').map((j) => j.name);

  it('every scheduled HTTP job has a handler, and every handler is scheduled', () => {
    expect(Object.keys(JOBS).sort()).toEqual([...http].sort());
  });

  it('the heartbeat counts members and reports how late its call arrived', async () => {
    const eq = vi.fn(async () => ({ count: 4, error: null }));
    const db = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    } as unknown as SupabaseClient;
    const scheduledAt = new Date(Date.now() - 1500);
    const result = await JOBS.heartbeat!({ db, householdId: 'h1', scheduledAt, since: null });
    expect(eq).toHaveBeenCalledWith('household_id', 'h1');
    expect(result.status).toBe('ok');
    expect(result.stats?.members).toBe(4);
    expect(result.stats?.lag_ms).toBeGreaterThanOrEqual(1500);
  });

  it('[CHR-03] occurrence_gen asks the database to fill the household’s next 14 days', async () => {
    const rpc = vi.fn(async () => ({
      data: { added: 3, from: '2026-10-10', through: '2026-10-23' },
      error: null,
    }));
    const db = { rpc } as unknown as SupabaseClient;
    const result = await JOBS.occurrence_gen!({
      db,
      householdId: 'h1',
      scheduledAt: new Date(),
      since: null,
    });
    expect(rpc).toHaveBeenCalledWith('generate_household_occurrences', { p_household_id: 'h1' });
    expect(result).toEqual({
      status: 'ok',
      stats: { added: 3, from: '2026-10-10', through: '2026-10-23' },
    });
  });

  it('[CHR-03] occurrence_gen fails the household’s run when the database refuses', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'permission denied' } })),
    } as unknown as SupabaseClient;
    await expect(
      JOBS.occurrence_gen!({ db, householdId: 'h1', scheduledAt: new Date(), since: null }),
    ).rejects.toThrow('generate occurrences: permission denied');
  });

  it('[CHR-07] day_close asks the database to finalize the household’s past days', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'close_household_day'
        ? { data: { closed: 4, through: '2026-10-08' }, error: null }
        : name === 'apply_points_rules'
          ? { data: { posted: 1 }, error: null }
          : { data: [], error: null },
    );
    // [RWD-11] Then the histories of marked members (none here; lib/jobs/history.test.ts), and
    // [PTS-05] then the bonus rules.
    const household = { data: { timezone: 'UTC' }, error: null };
    const from = () => ({ select: () => ({ eq: () => ({ single: async () => household }) }) });
    const db = { rpc, from } as unknown as SupabaseClient;
    const result = await JOBS.day_close!({
      db,
      householdId: 'h1',
      scheduledAt: new Date(),
      since: null,
    });
    expect(rpc).toHaveBeenCalledWith('close_household_day', { p_household_id: 'h1' });
    expect(rpc).toHaveBeenLastCalledWith('apply_points_rules', { p_household: 'h1' });
    expect(result).toEqual({
      status: 'ok',
      stats: {
        closed: 4,
        through: '2026-10-08',
        history: { members: 0, days: 0 },
        bonuses: { posted: 1 },
      },
    });
  });

  it('[PTS-05] day_close fails the run when the bonus rules can’t be applied', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'apply_points_rules'
        ? { data: null, error: { message: 'permission denied' } }
        : name === 'close_household_day'
          ? { data: { closed: 0 }, error: null }
          : { data: [], error: null },
    );
    const household = { data: { timezone: 'UTC' }, error: null };
    const from = () => ({ select: () => ({ eq: () => ({ single: async () => household }) }) });
    const db = { rpc, from } as unknown as SupabaseClient;
    await expect(
      JOBS.day_close!({ db, householdId: 'h1', scheduledAt: new Date(), since: null }),
    ).rejects.toThrow('apply bonus rules: permission denied');
  });

  it('[NFR-06] status_check passes when every status matches its events, and fails on drift', async () => {
    const report = (drift: number) => ({
      data: {
        from: '2026-09-25',
        through: '2026-10-23',
        drift,
        sample: drift ? [{ was: 'completed', now_is: 'scheduled' }] : [],
      },
      error: null,
    });
    const ok = { rpc: vi.fn(async () => report(0)) } as unknown as SupabaseClient;
    expect(
      (
        await JOBS.status_check!({
          db: ok,
          householdId: 'h1',
          scheduledAt: new Date(),
          since: null,
        })
      ).status,
    ).toBe('ok');
    const drifted = { rpc: vi.fn(async () => report(1)) } as unknown as SupabaseClient;
    await expect(
      JOBS.status_check!({ db: drifted, householdId: 'h1', scheduledAt: new Date(), since: null }),
    ).rejects.toThrow(/1 occurrence status\(es\) differ from their events/);
  });

  it('[PTS-01] status_check also fails when the points ledger differs from the statuses', async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: {
          drift: 0,
          sample: [],
          points_drift: 2,
          points_sample: [{ occurrence_id: 'o1', member_id: 'm1', held: 0, owed: 5 }],
        },
        error: null,
      })),
    } as unknown as SupabaseClient;
    await expect(
      JOBS.status_check!({ db, householdId: 'h1', scheduledAt: new Date(), since: null }),
    ).rejects.toThrow(/2 member point total\(s\) differ from their occurrences/);
  });
});
