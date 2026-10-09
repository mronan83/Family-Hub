import type { AvatarKey, MemberColor } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberInput } from '@/lib/members';
import type { LedgerEntry, LedgerEntryType } from '@/lib/points';

export interface MemberRow extends MemberInput {
  id: string;
  archivedAt: string | null;
}

interface Raw {
  id: string;
  display_name: string;
  role: 'child' | 'adult';
  avatar_key: AvatarKey | null;
  color: MemberColor;
  birth_year: number | null;
  earns_rewards: boolean;
  user_id: string | null;
  archived_at: string | null;
}

const COLUMNS =
  'id, display_name, role, avatar_key, color, birth_year, earns_rewards, user_id, archived_at';

function toRow(r: Raw): MemberRow {
  return {
    id: r.id,
    displayName: r.display_name,
    role: r.role,
    avatarKey: r.avatar_key,
    color: r.color,
    birthYear: r.birth_year,
    earnsRewards: r.earns_rewards,
    userId: r.user_id,
    archivedAt: r.archived_at,
  };
}

/** The household's members through RLS: children first, then adults, each by name. */
export async function loadMembers(db: SupabaseClient, householdId: string): Promise<MemberRow[]> {
  const { data, error } = await db
    .from('member')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .order('role', { ascending: false })
    .order('display_name');
  if (error) throw new Error(`members: ${error.message}`);
  return (data as Raw[]).map(toRow);
}

export async function loadAdmins(
  db: SupabaseClient,
  householdId: string,
): Promise<{ userId: string; email: string }[]> {
  const { data, error } = await db.rpc('household_admins', { p_household_id: householdId });
  if (error) throw new Error(`admins: ${error.message}`);
  return (data as { user_id: string; email: string }[]).map((a) => ({
    userId: a.user_id,
    email: a.email,
  }));
}

/** [PTS-02] Each member's balance in the household, through RLS; a member with no entries has none. */
export async function loadBalances(
  db: SupabaseClient,
  householdId: string,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from('v_points_balance')
    .select('member_id, balance')
    .eq('household_id', householdId);
  if (error) throw new Error(`balances: ${error.message}`);
  return new Map(
    (data as { member_id: string; balance: number }[]).map((r) => [r.member_id, r.balance]),
  );
}

interface RawEntry {
  id: string;
  entry_type: LedgerEntryType;
  amount: number;
  reason: string | null;
  occurrence_id: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * [PTS-01][PTS-02] A member's balance and their latest entries, newest first. An earn names its item
 * when this admin may see the item (D-34); otherwise it stays "a private item".
 */
export async function loadPoints(
  db: SupabaseClient,
  memberId: string,
  limit = 30,
): Promise<{ balance: number; entries: LedgerEntry[] }> {
  const [{ data: rows, error }, { data: total, error: totalError }] = await Promise.all([
    db
      .from('points_ledger')
      .select('id, entry_type, amount, reason, occurrence_id, created_by, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
    db.from('v_points_balance').select('balance').eq('member_id', memberId).maybeSingle(),
  ]);
  if (error) throw new Error(`points: ${error.message}`);
  if (totalError) throw new Error(`balance: ${totalError.message}`);
  const entries = rows as RawEntry[];
  const occurrenceIds = [
    ...new Set(entries.flatMap((e) => (e.occurrence_id ? [e.occurrence_id] : []))),
  ];
  const titles = new Map<string, string>();
  if (occurrenceIds.length > 0) {
    const { data: occs, error: occError } = await db
      .from('chore_occurrence')
      .select('id, chore:chore_id (title)')
      .in('id', occurrenceIds);
    if (occError) throw new Error(`points items: ${occError.message}`);
    for (const o of occs as unknown as { id: string; chore: { title: string } | null }[]) {
      if (o.chore) titles.set(o.id, o.chore.title);
    }
  }
  return {
    balance: (total as { balance: number } | null)?.balance ?? 0,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.entry_type,
      amount: e.amount,
      at: e.created_at,
      label: e.occurrence_id ? (titles.get(e.occurrence_id) ?? null) : e.reason,
      by: e.created_by,
    })),
  };
}
