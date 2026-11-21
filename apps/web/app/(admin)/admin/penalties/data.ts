import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Penalty,
  type PenaltyPayment,
  type PenaltyReason,
  type PenaltyUnit,
  withOwed,
} from '@/lib/penalties';

/** [PTS-09] The household's penalties on/off and its reasons, read through RLS (WP-120). */
export async function loadPenaltySettings(
  db: SupabaseClient,
  householdId: string,
): Promise<{ on: boolean; reasons: PenaltyReason[] }> {
  const [settings, reasons] = await Promise.all([
    db
      .from('household_settings')
      .select('penalties_on')
      .eq('household_id', householdId)
      .maybeSingle(),
    db
      .from('penalty_reason')
      .select('id, name, unit, amount')
      .eq('household_id', householdId)
      .is('removed_at', null)
      .order('created_at')
      .order('id'),
  ]);
  if (settings.error) throw new Error(`penalties: ${settings.error.message}`);
  if (reasons.error) throw new Error(`penalty reasons: ${reasons.error.message}`);
  return {
    on: Boolean(settings.data?.penalties_on),
    reasons: (reasons.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      unit: r.unit as PenaltyUnit,
      amount: r.amount as number,
    })),
  };
}

/** [PTS-09] A member's penalties, newest first, each with what is owed, and the payments on them. */
export async function loadMemberPenalties(
  db: SupabaseClient,
  memberId: string,
): Promise<{ penalties: Penalty[]; payments: PenaltyPayment[] }> {
  const rows = await db
    .from('penalty')
    .select('id, member_id, reason, unit, amount, given_at, given_by, taken_back_at, taken_back_by')
    .eq('member_id', memberId)
    .order('given_at', { ascending: false })
    .order('id')
    .limit(200);
  if (rows.error) throw new Error(`penalties: ${rows.error.message}`);
  const ids = (rows.data ?? []).map((r) => r.id as string);
  const paid = ids.length
    ? await db
        .from('penalty_payment')
        .select('id, penalty_id, amount, recorded_at, recorded_by')
        .in('penalty_id', ids)
        .order('recorded_at', { ascending: false })
    : { data: [], error: null };
  if (paid.error) throw new Error(`penalty payments: ${paid.error.message}`);
  const payments: PenaltyPayment[] = (paid.data ?? []).map((x) => ({
    id: x.id as string,
    penaltyId: x.penalty_id as string,
    amount: x.amount as number,
    recordedAt: x.recorded_at as string,
    recordedBy: x.recorded_by as string,
  }));
  const penalties = withOwed(
    (rows.data ?? []).map((r) => ({
      id: r.id as string,
      memberId: r.member_id as string,
      reason: r.reason as string,
      unit: r.unit as PenaltyUnit,
      amount: r.amount as number,
      givenAt: r.given_at as string,
      givenBy: r.given_by as string,
      takenBackAt: (r.taken_back_at as string | null) ?? null,
      takenBackBy: (r.taken_back_by as string | null) ?? null,
    })),
    payments,
  );
  return { penalties, payments };
}
