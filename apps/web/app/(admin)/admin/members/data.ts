import type { AvatarKey, MemberColor } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberInput } from '@/lib/members';

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
