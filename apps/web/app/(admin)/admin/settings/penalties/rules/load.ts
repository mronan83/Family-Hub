import type { SupabaseClient } from '@supabase/supabase-js';
import { isoDay } from '@/lib/format';
import type { PenaltyReason, PenaltyUnit } from '@/lib/penalties';
import {
  loadPaybackGoals,
  loadPenaltyRules,
  loadPenaltySettings,
  loadRuleChores,
  loadRuleTags,
} from '../../../penalties/data';
import { loadMembers } from '../../../members/data';

/**
 * [PTS-10] What the rule form needs, read through RLS: the reasons (and a rule's own, even once
 * removed from the list), who earns rewards, the chores and tags it can count, and the rule itself.
 */
export async function loadRuleForm(
  db: SupabaseClient,
  household: { id: string; timezone: string },
  ruleId: string | null,
) {
  const [{ on, reasons }, rules, members, chores, tags, goals] = await Promise.all([
    loadPenaltySettings(db, household.id),
    ruleId ? loadPenaltyRules(db, household.id) : Promise.resolve([]),
    loadMembers(db, household.id),
    loadRuleChores(db, household.id),
    loadRuleTags(db, household.id),
    loadPaybackGoals(db, household.id),
  ]);
  const rule = ruleId ? (rules.find((r) => r.id === ruleId) ?? null) : null;
  let choices: PenaltyReason[] = reasons;
  if (rule && !reasons.some((r) => r.id === rule.reasonId)) {
    const { data } = await db
      .from('penalty_reason')
      .select('id, name, unit, amount')
      .eq('id', rule.reasonId)
      .maybeSingle();
    if (data) choices = [...reasons, { ...data, unit: data.unit as PenaltyUnit } as PenaltyReason];
  }
  return {
    on,
    rule,
    reasons: choices,
    people: members
      .filter((m) => m.earnsRewards && !m.archivedAt)
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        avatarKey: m.avatarKey,
        color: m.color,
      })),
    // A rule's own chores stay listed even once archived.
    chores: [...chores, ...(rule?.chores.filter((c) => !chores.some((x) => x.id === c.id)) ?? [])],
    tags,
    // [PTS-11] The goals it can be paid back by (WP-122).
    goals,
    today: isoDay(household.timezone),
  };
}
