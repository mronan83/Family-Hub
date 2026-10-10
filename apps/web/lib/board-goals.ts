import type { RuleType } from '@familywise/rules-engine';
import { z } from 'zod';
import type { BoardGoal, BoardGoalRule } from './snapshot';

// Goals on the board (WP-20, D-59): WP-19 works out the progress; the board draws it in a child's words,
// nudges when a goal is nearly reached, and celebrates a reached goal once.

/** What each kind of rule counts, as a child reads it. */
export const BOARD_RULE_WORDS: Record<RuleType, string> = {
  COUNT: 'Things done',
  DAILY_ALL_DONE: 'Days with everything done',
  STREAK: 'Good days in a row',
  POINTS: 'Points earned',
};

/** [RWD-07] A child's own goals first, then the family's. */
export function goalsFor(goals: BoardGoal[], memberId: string): BoardGoal[] {
  return [
    ...goals.filter((g) => g.memberId === memberId),
    ...goals.filter((g) => g.memberId === null),
  ];
}

/** A rule's meter: how far toward its target (a streak's best run in the goal's dates, as stored). */
export function ruleMeter(r: BoardGoalRule): { label: string; value: number; target: number } {
  return {
    label: BOARD_RULE_WORDS[r.type],
    value: Math.min(r.current, r.target),
    target: r.target,
  };
}

/** A streak's run now, which its meter (the best run) doesn't say. */
export function ruleNote(r: BoardGoalRule): string | null {
  if (r.type !== 'STREAK' || r.streak === null || r.met) return null;
  return r.best !== null && r.best > r.streak
    ? `${r.streak} in a row now, best ${r.best}`
    : `${r.streak} in a row now`;
}

const DAY_MS = 86_400_000;

/** When a goal ends, counted in household days: "Ends today", "Ends Sunday", "Ends Oct 24". */
export function endsLine(endDate: string | null, today: string): string | null {
  if (!endDate) return null;
  const days = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
  if (days < 0) return null;
  if (days === 0) return 'Ends today';
  if (days === 1) return 'Ends tomorrow';
  const at = new Date(`${endDate}T12:00:00Z`);
  return days < 7
    ? `Ends ${at.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`
    : `Ends ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** How a rule close to its target reads as a nudge; null when it isn't close. */
function closeLine(r: BoardGoalRule, title: string): string | null {
  const left = r.target - (r.type === 'STREAK' ? (r.streak ?? 0) : r.current);
  if (left < 1) return null;
  switch (r.type) {
    case 'COUNT':
      return left === 1 ? `One more thing to do for ${title}!` : null;
    case 'POINTS':
      return left <= Math.max(5, Math.ceil(r.target / 10))
        ? `${left} more ${left === 1 ? 'point' : 'points'} for ${title}!`
        : null;
    case 'DAILY_ALL_DONE':
      return left === 1 ? `One more day with everything done for ${title}!` : null;
    case 'STREAK':
      return left === 1 ? `One more good day in a row for ${title}!` : null;
  }
}

/**
 * [RWD-07][US-403] A nudge naming a goal that is nearly reached: one thing (or day) to go, a few points
 * to go, or 90% there. With "all" rules, only when every other rule is met already.
 */
export function goalNudge(g: BoardGoal): string | null {
  if (g.status !== 'active') return null;
  const unmet = g.rules.filter((r) => !r.met);
  if (unmet.length === 0) return null;
  const candidates = g.logic === 'all' ? (unmet.length === 1 ? unmet : []) : unmet;
  for (const r of candidates) {
    const line = closeLine(r, g.title);
    if (line) return line;
  }
  return g.pct >= 90 ? `Almost there with ${g.title}!` : null;
}

/**
 * The first nudge for a child: their own goals, then the family's. Everyone's view leaves the family's
 * out (`own`): its family goals have their own place, and one nudge in every column says it too often.
 */
export function nudgeFor(
  goals: BoardGoal[],
  memberId: string,
  { own = false }: { own?: boolean } = {},
): string | null {
  for (const g of goalsFor(goals, memberId)) {
    if (own && g.memberId === null) continue;
    const line = goalNudge(g);
    if (line) return line;
  }
  return null;
}

/** One achievement of a goal: n + 1 is celebrated on its own. */
export const celebrationKey = (g: Pick<BoardGoal, 'id' | 'n'>): string => `${g.id}:${g.n}`;

/** [RWD-08] The reached goals still to celebrate, first reached first, less those this board did. */
export function toCelebrate(goals: BoardGoal[], done: ReadonlySet<string>): BoardGoal[] {
  return goals
    .filter((g) => g.status === 'achieved' && g.celebrate && !done.has(celebrationKey(g)))
    .sort((a, b) => (a.achievedAt ?? '').localeCompare(b.achievedAt ?? ''));
}

/** "Leo reached Movie night!" · "The family reached Pizza night!" */
export function celebrationLine(g: BoardGoal, name: (id: string) => string): string {
  return `${g.memberId ? name(g.memberId) : 'The family'} reached ${g.title}!`;
}

/** [RWD-08] A board says it has celebrated achievement n of a goal. */
export const celebratedSchema = z
  .object({ goal_id: z.guid(), n: z.number().int().min(1) })
  .strict();

export type MarkCelebrated = (goalId: string, n: number) => Promise<boolean>;

/** [RWD-08] POST /api/goals/celebrated: true once it is recorded (by this board or another). */
export const postCelebrated: MarkCelebrated = async (goalId, n) => {
  try {
    const res = await fetch('/api/goals/celebrated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal_id: goalId, n }),
    });
    return res.ok;
  } catch {
    return false;
  }
};
