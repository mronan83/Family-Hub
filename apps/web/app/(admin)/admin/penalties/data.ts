import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalRepeat, PaybackGoal, PenaltyPaybackRow } from '@/lib/paybacks';
import type { PenaltyRule, RuleChore, RuleScope } from '@/lib/penalty-rules';
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

/**
 * [PTS-09] A member's penalties, newest first, each with what is owed, and the payments on them.
 * [PTS-11] And what goals paid back on their rules (WP-122), each with its rule and goal.
 */
export async function loadMemberPenalties(
  db: SupabaseClient,
  memberId: string,
): Promise<{ penalties: Penalty[]; payments: PenaltyPayment[]; paybacks: PenaltyPaybackRow[] }> {
  const rows = await db
    .from('penalty')
    .select(
      'id, member_id, reason, unit, amount, given_at, given_by, taken_back_at, taken_back_by, rule_id, missed_on, taken_back_on_time',
    )
    .eq('member_id', memberId)
    .order('given_at', { ascending: false })
    .order('id')
    .limit(200);
  if (rows.error) throw new Error(`penalties: ${rows.error.message}`);
  const ids = (rows.data ?? []).map((r) => r.id as string);
  const paid = ids.length
    ? await db
        .from('penalty_payment')
        .select('id, penalty_id, amount, recorded_at, recorded_by, payback_id')
        .in('penalty_id', ids)
        .order('recorded_at', { ascending: false })
    : { data: [], error: null };
  if (paid.error) throw new Error(`penalty payments: ${paid.error.message}`);
  const payments: PenaltyPayment[] = (paid.data ?? []).map((x) => ({
    id: x.id as string,
    penaltyId: x.penalty_id as string,
    amount: x.amount as number,
    recordedAt: x.recorded_at as string,
    recordedBy: (x.recorded_by as string | null) ?? null,
    paybackId: (x.payback_id as string | null) ?? null,
  }));
  const back = await db
    .from('penalty_payback')
    .select(
      'id, rule_id, unit, amount, paid_at, taken_back_at, penalty_rule(name), reward_goal(title, repeats)',
    )
    .eq('member_id', memberId)
    .order('paid_at', { ascending: false })
    .limit(200);
  if (back.error) throw new Error(`penalty paybacks: ${back.error.message}`);
  const one = <T>(x: T | T[] | null): T | null => (Array.isArray(x) ? (x[0] ?? null) : x);
  const paybacks: PenaltyPaybackRow[] = (back.data ?? []).map((b) => {
    const goal = one(b.reward_goal as unknown as { title: string; repeats: string } | null);
    return {
      id: b.id as string,
      ruleId: b.rule_id as string,
      rule: one(b.penalty_rule as unknown as { name: string } | null)?.name ?? 'a rule',
      goal: goal?.title ?? 'a goal',
      repeat: (goal?.repeats ?? 'none') as GoalRepeat,
      unit: b.unit as PenaltyUnit,
      amount: b.amount as number,
      paidAt: b.paid_at as string,
      takenBackAt: (b.taken_back_at as string | null) ?? null,
    };
  });
  const penalties = withOwed(
    (rows.data ?? []).map((r) => ({
      id: r.id as string,
      memberId: r.member_id as string,
      reason: r.reason as string,
      unit: r.unit as PenaltyUnit,
      amount: r.amount as number,
      givenAt: r.given_at as string,
      givenBy: (r.given_by as string | null) ?? null,
      takenBackAt: (r.taken_back_at as string | null) ?? null,
      takenBackBy: (r.taken_back_by as string | null) ?? null,
      ruleId: (r.rule_id as string | null) ?? null,
      missedOn: (r.missed_on as string | null) ?? null,
      takenBackOnTime: Boolean(r.taken_back_on_time),
    })),
    payments,
  );
  return { penalties, payments, paybacks };
}

/**
 * [PTS-10] The household's penalty rules, oldest first, each with its people, its chores, its tag and
 * what it has on each person (cents owed, or points it took), read through RLS (WP-121).
 */
export async function loadPenaltyRules(
  db: SupabaseClient,
  householdId: string,
): Promise<PenaltyRule[]> {
  const rules = await db
    .from('penalty_rule')
    .select(
      'id, name, reason_id, unit, amount, max_amount, scope, tag_id, start_date, end_date, stopped_at, payback_goal_id, payback_amount, penalty_rule_member(member_id), penalty_rule_chore(chore_id), tag(name), reward_goal(title, repeats)',
    )
    .eq('household_id', householdId)
    .order('created_at')
    .order('id');
  if (rules.error) throw new Error(`penalty rules: ${rules.error.message}`);
  const rows = rules.data ?? [];
  if (rows.length === 0) return [];
  const ruleIds = rows.map((r) => r.id as string);
  const choreIds = [
    ...new Set(
      rows.flatMap((r) =>
        ((r.penalty_rule_chore as { chore_id: string }[] | null) ?? []).map((c) => c.chore_id),
      ),
    ),
  ];
  const [chores, misses, paidBack] = await Promise.all([
    loadRuleChores(db, householdId, choreIds),
    db
      .from('penalty')
      .select('id, rule_id, member_id, unit, amount, taken_back_at, penalty_payment(amount)')
      .in('rule_id', ruleIds),
    // [PTS-11] Points a goal paid back count off what a points rule has on someone (D-158).
    db
      .from('penalty_payback')
      .select('rule_id, member_id, amount')
      .in('rule_id', ruleIds)
      .eq('unit', 'points')
      .is('taken_back_at', null),
  ]);
  if (misses.error) throw new Error(`penalty rule misses: ${misses.error.message}`);
  if (paidBack.error) throw new Error(`penalty paybacks: ${paidBack.error.message}`);
  return rows.map((r) => {
    const held: Record<string, number> = {};
    let added = 0;
    for (const m of misses.data ?? []) {
      if (m.rule_id !== r.id) continue;
      added += 1;
      if (m.taken_back_at) continue;
      const paid = ((m.penalty_payment as { amount: number }[] | null) ?? []).reduce(
        (t, x) => t + x.amount,
        0,
      );
      const id = m.member_id as string;
      held[id] = (held[id] ?? 0) + (m.amount as number) - (m.unit === 'money' ? paid : 0);
    }
    for (const b of paidBack.data ?? []) {
      if (b.rule_id !== r.id) continue;
      const id = b.member_id as string;
      held[id] = Math.max(0, (held[id] ?? 0) - (b.amount as number));
    }
    const goal = r.reward_goal as
      { title: string; repeats: string } | { title: string; repeats: string }[] | null;
    const g = Array.isArray(goal) ? goal[0] : goal;
    const linked = ((r.penalty_rule_chore as { chore_id: string }[] | null) ?? []).map(
      (c) => c.chore_id,
    );
    const tag = r.tag as { name: string } | { name: string }[] | null;
    return {
      id: r.id as string,
      name: r.name as string,
      reasonId: r.reason_id as string,
      unit: r.unit as PenaltyUnit,
      amount: r.amount as number,
      max: r.max_amount as number,
      scope: r.scope as RuleScope,
      tagId: (r.tag_id as string | null) ?? null,
      tagName: (Array.isArray(tag) ? tag[0]?.name : tag?.name) ?? null,
      chores: chores.filter((c) => linked.includes(c.id)),
      memberIds: ((r.penalty_rule_member as { member_id: string }[] | null) ?? []).map(
        (m) => m.member_id,
      ),
      startDate: r.start_date as string,
      endDate: r.end_date as string,
      held,
      stoppedAt: (r.stopped_at as string | null) ?? null,
      added,
      payback:
        r.payback_goal_id && g
          ? {
              goalId: r.payback_goal_id as string,
              goal: g.title,
              repeat: (g.repeats ?? 'none') as GoalRepeat,
              amount: r.payback_amount as number,
            }
          : null,
    };
  });
}

/**
 * [PTS-10] The chores a rule can link (kind chore, not archived), or the ones named: each with
 * whether it is due on school days only, and who it is for.
 */
export async function loadRuleChores(
  db: SupabaseClient,
  householdId: string,
  ids: string[] | null = null,
): Promise<RuleChore[]> {
  if (ids && ids.length === 0) return [];
  let q = db
    .from('chore')
    .select('id, title, day_types, chore_assignee(member_id)')
    .eq('household_id', householdId)
    .eq('kind', 'chore');
  q = ids ? q.in('id', ids) : q.is('archived_at', null);
  const { data, error } = await q.order('title').order('id');
  if (error) throw new Error(`rule chores: ${error.message}`);
  return (data ?? []).map((c) => {
    const types = (c.day_types as string[] | null) ?? [];
    return {
      id: c.id as string,
      title: c.title as string,
      schoolDays: types.length === 1 && types[0] === 'school_day',
      assignees: ((c.chore_assignee as { member_id: string }[] | null) ?? []).map(
        (a) => a.member_id,
      ),
    };
  });
}

/** [PTS-10] The household's tags a rule can count (not archived). */
export async function loadRuleTags(
  db: SupabaseClient,
  householdId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('tag')
    .select('id, name')
    .eq('household_id', householdId)
    .is('archived_at', null)
    .order('sort_order')
    .order('name');
  if (error) throw new Error(`tags: ${error.message}`);
  return (data ?? []).map((t) => ({ id: t.id as string, name: t.name as string }));
}

/**
 * [PTS-11] The goals a rule can be paid back by (WP-122): the household's, not archived, still to be
 * won (a draft, scheduled or going), as save_penalty_rule() checks.
 */
export async function loadPaybackGoals(
  db: SupabaseClient,
  householdId: string,
): Promise<PaybackGoal[]> {
  const { data, error } = await db
    .from('reward_goal')
    .select('id, title, member_id, repeats')
    .eq('household_id', householdId)
    .is('archived_at', null)
    .in('status', ['draft', 'scheduled', 'active'])
    .order('title')
    .order('id');
  if (error) throw new Error(`payback goals: ${error.message}`);
  return (data ?? []).map((g) => ({
    id: g.id as string,
    title: g.title as string,
    memberId: (g.member_id as string | null) ?? null,
    repeat: ((g.repeats as string | null) ?? 'none') as GoalRepeat,
  }));
}
