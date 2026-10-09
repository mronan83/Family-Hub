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
});
