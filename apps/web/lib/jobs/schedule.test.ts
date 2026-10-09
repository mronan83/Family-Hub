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
});
