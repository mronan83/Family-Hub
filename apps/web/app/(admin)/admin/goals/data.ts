import type { GoalStatus, RuleType } from '@familywise/rules-engine';
import type { IconName } from '@familywise/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RuleFormValue } from '@/lib/goals';

// Goals (WP-19), read through RLS as the parent: each goal with its rules and what the rules engine
// last made of them. Photos are private: each comes with a signed link that lasts an hour.

/** The icons a goal can take (06 §5), trophy first. */
export const GOAL_ICONS: IconName[] = [
  'trophy',
  'target',
  'star',
  'gift',
  'ticket',
  'sparkles',
  'sun',
  'moon',
  'utensils',
  'snack',
];

export interface GoalRule {
  id: string;
  type: RuleType;
  target: number;
  scope: RuleFormValue['scope'];
  params: { grace_per_week?: number };
  progress: {
    current: number;
    pct: number;
    met: boolean;
    currentStreak: number | null;
    bestStreak: number | null;
  } | null;
}

export interface GoalRow {
  id: string;
  memberId: string | null;
  title: string;
  description: string | null;
  icon: IconName;
  imagePath: string | null;
  imageUrl: string | null;
  startDate: string;
  endDate: string | null;
  logic: 'all' | 'any';
  status: GoalStatus;
  achievementCount: number;
  achievedAt: string | null;
  redeemedAt: string | null;
  redeemedBy: string | null;
  needsReview: boolean;
  archivedAt: string | null;
  createdAt: string;
  /** The engine's last result; null before the first evaluation. */
  pct: number | null;
  computedAt: string | null;
  rules: GoalRule[];
}

export interface GoalEvent {
  id: number;
  type: string;
  actorType: 'admin' | 'system';
  actorId: string | null;
  payload: Record<string, unknown>;
  at: string;
}

/** [RWD-01][RWD-04] The household's goals, newest first, with their rules and progress. */
export async function loadGoals(db: SupabaseClient, householdId: string): Promise<GoalRow[]> {
  const [goals, rules, progress, ruleProgress] = await Promise.all([
    db
      .from('reward_goal')
      .select(
        'id, member_id, title, description, icon, image_path, start_date, end_date, rule_logic, status, achievement_count, achieved_at, redeemed_at, redeemed_by, needs_review, archived_at, created_at',
      )
      .eq('household_id', householdId)
      .order('created_at', { ascending: false }),
    db
      .from('reward_rule')
      .select('id, goal_id, rule_type, target, scope, params, sort_order')
      .eq('household_id', householdId)
      .order('sort_order'),
    db
      .from('reward_goal_progress')
      .select('goal_id, pct, computed_at')
      .eq('household_id', householdId),
    db
      .from('reward_rule_progress')
      .select('rule_id, current_value, pct, is_met, current_streak, best_streak')
      .eq('household_id', householdId),
  ]);
  for (const r of [goals, rules, progress, ruleProgress]) {
    if (r.error) throw new Error(`goals: ${r.error.message}`);
  }
  const goalProgress = new Map(
    (progress.data as { goal_id: string; pct: number; computed_at: string | null }[]).map((p) => [
      p.goal_id,
      p,
    ]),
  );
  const perRule = new Map(
    (
      ruleProgress.data as {
        rule_id: string;
        current_value: number;
        pct: number;
        is_met: boolean;
        current_streak: number | null;
        best_streak: number | null;
      }[]
    ).map((p) => [p.rule_id, p]),
  );
  const rulesByGoal = new Map<string, GoalRule[]>();
  for (const r of rules.data as {
    id: string;
    goal_id: string;
    rule_type: RuleType;
    target: number;
    scope: RuleFormValue['scope'];
    params: { grace_per_week?: number };
  }[]) {
    const p = perRule.get(r.id);
    const list = rulesByGoal.get(r.goal_id) ?? [];
    list.push({
      id: r.id,
      type: r.rule_type,
      target: r.target,
      scope: r.scope,
      params: r.params ?? {},
      progress: p
        ? {
            current: p.current_value,
            pct: Number(p.pct),
            met: p.is_met,
            currentStreak: p.current_streak,
            bestStreak: p.best_streak,
          }
        : null,
    });
    rulesByGoal.set(r.goal_id, list);
  }
  const raw = goals.data as {
    id: string;
    member_id: string | null;
    title: string;
    description: string | null;
    icon: IconName;
    image_path: string | null;
    start_date: string;
    end_date: string | null;
    rule_logic: 'all' | 'any';
    status: GoalStatus;
    achievement_count: number;
    achieved_at: string | null;
    redeemed_at: string | null;
    redeemed_by: string | null;
    needs_review: boolean;
    archived_at: string | null;
    created_at: string;
  }[];
  const paths = raw.map((g) => g.image_path).filter((p): p is string => p !== null);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await db.storage.from('rewards').createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return raw.map((g) => {
    const p = goalProgress.get(g.id);
    return {
      id: g.id,
      memberId: g.member_id,
      title: g.title,
      description: g.description,
      icon: g.icon,
      imagePath: g.image_path,
      imageUrl: g.image_path ? (urls.get(g.image_path) ?? null) : null,
      startDate: g.start_date,
      endDate: g.end_date,
      logic: g.rule_logic,
      status: g.status,
      achievementCount: g.achievement_count,
      achievedAt: g.achieved_at,
      redeemedAt: g.redeemed_at,
      redeemedBy: g.redeemed_by,
      needsReview: g.needs_review,
      archivedAt: g.archived_at,
      createdAt: g.created_at,
      pct: p?.computed_at ? Number(p.pct) : null,
      computedAt: p?.computed_at ?? null,
      rules: rulesByGoal.get(g.id) ?? [],
    };
  });
}

/** [RWD-09] A goal's lifecycle log, newest first. */
export async function loadGoalEvents(db: SupabaseClient, goalId: string): Promise<GoalEvent[]> {
  const { data, error } = await db
    .from('reward_goal_event')
    .select('id, type, actor_type, actor_id, payload, at')
    .eq('goal_id', goalId)
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw new Error(`goal history: ${error.message}`);
  return (
    data as {
      id: number;
      type: string;
      actor_type: 'admin' | 'system';
      actor_id: string | null;
      payload: Record<string, unknown>;
      at: string;
    }[]
  ).map((e) => ({
    id: e.id,
    type: e.type,
    actorType: e.actor_type,
    actorId: e.actor_id,
    payload: e.payload ?? {},
    at: e.at,
  }));
}
