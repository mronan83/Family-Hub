import { ENGINE_VERSION } from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { rebuildHistories } from './registry';

/** A stand-in for the job's client: the household's time zone and the RPCs it calls. */
function fakeDb(marked: string[]) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case 'history_dirty_members':
        return { data: marked, error: null };
      case 'member_history_facts':
        return { data: { read_at: 'r', facts: [] }, error: null };
      case 'save_member_history':
        return { data: { days: 3, segments: 1 }, error: null };
      default:
        throw new Error(`unexpected ${name} ${JSON.stringify(args)}`);
    }
  });
  const single = async () => ({ data: { timezone: 'America/Chicago' }, error: null });
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));
  return { db: { rpc, from } as unknown as SupabaseClient, rpc };
}

describe('[RWD-11] day close rebuilds histories', () => {
  it('rebuilds each marked member through the household’s yesterday, with this engine', async () => {
    const { db, rpc } = fakeDb(['m1', 'm2']);
    // 05:30 UTC on 15 October is 00:30 in Chicago: yesterday there is the 14th.
    const result = await rebuildHistories(db, 'h1', new Date('2026-10-15T05:30:00Z'));
    expect(result).toEqual({ members: 2, days: 6 });
    expect(rpc).toHaveBeenCalledWith('history_dirty_members', {
      p_household_id: 'h1',
      p_engine_version: ENGINE_VERSION,
    });
    const facts = rpc.mock.calls.filter(([name]) => name === 'member_history_facts');
    expect(facts.map(([, a]) => a)).toEqual([
      { p_member: 'm1', p_through: '2026-10-14' },
      { p_member: 'm2', p_through: '2026-10-14' },
    ]);
  });

  it('does nothing more when nobody is marked', async () => {
    const { db, rpc } = fakeDb([]);
    expect(await rebuildHistories(db, 'h1')).toEqual({ members: 0, days: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
