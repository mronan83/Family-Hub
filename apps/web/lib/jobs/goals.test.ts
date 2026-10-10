import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { JOBS } from './registry';

// [RWD-04][US-407] progress_reconcile (WP-19): every goal of the household that needs it is evaluated;
// a goal that fails is left for the next run, and the run fails so System Health shows it.
const run = (rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>) =>
  JOBS.progress_reconcile!({
    db: { rpc } as unknown as SupabaseClient,
    householdId: 'h1',
    scheduledAt: new Date(),
    since: null,
  });

describe('[RWD-04] progress_reconcile', () => {
  it('evaluates nothing when nothing waits, and says so', async () => {
    const result = await run(async () => ({ data: [], error: null }));
    expect(result).toEqual({
      status: 'ok',
      stats: { goals: 0, achieved: 0, unachieved: 0, started: 0, expired: 0, failed: 0 },
    });
  });

  it('fails the run when a goal could not be evaluated', async () => {
    await expect(
      run(async (name) =>
        name === 'goals_to_evaluate'
          ? { data: ['g1'], error: null }
          : { data: null, error: { message: 'connection lost' } },
      ),
    ).rejects.toThrow('1 goal(s) not evaluated: g1: read goal facts: connection lost');
  });
});
