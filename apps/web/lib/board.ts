import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeviceClaims } from './devices';

export interface BoardDevice {
  id: string;
  name: string;
  householdId: string;
  householdName: string;
  timezone: string;
}

export type BoardState =
  { kind: 'unpaired' } | { kind: 'revoked' } | { kind: 'paired'; device: BoardDevice };

/**
 * [DEV-02] Who this browser is, as a board: unpaired (no board session), revoked (a board session
 * whose device row RLS no longer shows), or paired. Verified on the server; RLS decides the reads.
 */
export async function boardState(db: SupabaseClient): Promise<BoardState> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub || !isDeviceClaims(data.claims)) return { kind: 'unpaired' };
  const { data: row } = await db
    .from('device')
    .select('id, name, household:household_id (id, name, timezone)')
    .eq('auth_user_id', data.claims.sub)
    .maybeSingle();
  const h = row?.household as unknown as { id: string; name: string; timezone: string } | null;
  if (!row || !h) return { kind: 'revoked' };
  return {
    kind: 'paired',
    device: {
      id: row.id,
      name: row.name,
      householdId: h.id,
      householdName: h.name,
      timezone: h.timezone,
    },
  };
}
