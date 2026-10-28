import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type MemberTotal,
  type RegisterEntry,
  type RegisterFilters,
  type RegisterKind,
  readParts,
  shownCount,
} from '@/lib/points-register';

interface RawEntry {
  id: string;
  member_id: string;
  kind: RegisterKind;
  amount: number;
  created_at: string;
  reason: string | null;
  occurrence_id: string | null;
  item_title: string | null;
  goal_id: string | null;
  goal_title: string | null;
  points_rule_id: string | null;
  created_by_type: RegisterEntry['byType'];
  created_by: string | null;
}

const toEntry = (r: RawEntry): RegisterEntry => ({
  id: r.id,
  memberId: r.member_id,
  kind: r.kind,
  amount: r.amount,
  at: r.created_at,
  reason: r.reason,
  forItem: r.occurrence_id !== null,
  itemTitle: r.item_title,
  goalId: r.goal_id,
  goalTitle: r.goal_title,
  ruleId: r.points_rule_id,
  byType: r.created_by_type,
  by: r.created_by,
});

/** The filters as `points_register()` and `points_register_totals()` take them. */
const filterArgs = (householdId: string, f: RegisterFilters) => ({
  p_household: householdId,
  p_members: f.who.length ? f.who : null,
  p_kinds: f.types.length ? f.types : null,
  p_rule: f.rule,
  p_from: f.from,
  p_to: f.to,
});

/**
 * [PTS-08] The register as this admin reads it through RLS (D-147): the newest entries the address
 * shows (50, and 50 more for each Show older), read in parts the database answers whole, and what
 * every matching entry adds up to, per member. An item this admin may not see has no title (D-34).
 */
export async function loadRegister(
  db: SupabaseClient,
  householdId: string,
  f: RegisterFilters,
): Promise<{ entries: RegisterEntry[]; totals: MemberTotal[] }> {
  const args = filterArgs(householdId, f);
  const [parts, totals] = await Promise.all([
    Promise.all(
      readParts(shownCount(f)).map(({ offset, limit }) =>
        db.rpc('points_register', { ...args, p_limit: limit, p_offset: offset }),
      ),
    ),
    db.rpc('points_register_totals', args),
  ]);
  const entries: RegisterEntry[] = [];
  for (const { data, error } of parts) {
    if (error) throw new Error(`points register: ${error.message}`);
    entries.push(...(data as RawEntry[]).map(toEntry));
  }
  if (totals.error) throw new Error(`points register totals: ${totals.error.message}`);
  return {
    entries,
    totals: (
      totals.data as {
        member_id: string;
        entries: number;
        added: number;
        taken: number;
        latest: string;
      }[]
    ).map((t) => ({
      memberId: t.member_id,
      entries: t.entries,
      added: t.added,
      taken: t.taken,
      latest: t.latest,
    })),
  };
}

/** [PTS-05][PTS-08] How many times each bonus rule has paid, and its latest. */
export async function loadRulePayouts(
  db: SupabaseClient,
  householdId: string,
): Promise<Map<string, { times: number; latest: string }>> {
  const { data, error } = await db.rpc('points_rule_payouts', { p_household: householdId });
  if (error) throw new Error(`bonus payouts: ${error.message}`);
  return new Map(
    (data as { points_rule_id: string; times: number; latest: string }[]).map((r) => [
      r.points_rule_id,
      { times: r.times, latest: r.latest },
    ]),
  );
}
