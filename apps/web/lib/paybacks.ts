/**
 * [PTS-11] Penalties paid back through a goal, as the app reads and says them (WP-122, D-154, D-158;
 * 02 §4.2e). The database pays back a rule when its goal is won (a won period, or a one-off goal
 * reached), never more than is owed, and takes it back when the win is undone; the app checks the
 * rule form's "Paid back by" first and says each payback the way the approved mockup does: "A won
 * week pays back $1 of the $2 Maya owes for Folder home", "Nothing owed · payback paused", "Win a
 * Folder home week: pays back $1".
 */
import { money, type PenaltyUnit } from './penalties';

export type GoalRepeat = 'none' | 'week' | 'month' | 'term';

/** A goal a rule can be paid back by: its title, whose it is (null: the family's) and its repeat. */
export interface PaybackGoal {
  id: string;
  title: string;
  memberId: string | null;
  repeat: GoalRepeat;
}

/** A rule's "Paid back by": the goal and what each win pays back (points, or cents). */
export interface RulePayback {
  goalId: string;
  goal: string;
  repeat: GoalRepeat;
  amount: number;
}

/** One win's payback on a person, for their history. */
export interface PenaltyPaybackRow {
  id: string;
  ruleId: string;
  rule: string;
  goal: string;
  repeat: GoalRepeat;
  unit: PenaltyUnit;
  /** Points, or cents. */
  amount: number;
  paidAt: string;
  takenBackAt: string | null;
}

/** "week", "month", "term"; a goal that doesn't repeat has none. */
export function periodNoun(repeat: GoalRepeat): string | null {
  return repeat === 'none' ? null : repeat;
}

/** An amount in a unit: "$1", "5 points". */
export function unitAmount(unit: PenaltyUnit, amount: number): string {
  return unit === 'money' ? money(amount) : `${amount} ${amount === 1 ? 'point' : 'points'}`;
}

/** Settings' words for a rule's payback: "paid back $1 a week won", "paid back $1 when it's reached". */
export function paybackPhrase(unit: PenaltyUnit, p: RulePayback): string {
  const noun = periodNoun(p.repeat);
  return noun
    ? `paid back ${unitAmount(unit, p.amount)} a ${noun} won`
    : `paid back ${unitAmount(unit, p.amount)} when ${p.goal} is reached`;
}

/** A child's page: "Paid back $1 for each week won of", then the goal's title. */
export function paybackLead(unit: PenaltyUnit, p: RulePayback): string {
  const noun = periodNoun(p.repeat);
  return noun
    ? `Paid back ${unitAmount(unit, p.amount)} for each ${noun} won of`
    : `Paid back ${unitAmount(unit, p.amount)} when this goal is reached:`;
}

/** The paused state, everywhere it shows. */
export const PAUSED = 'Nothing owed · payback paused';

/** What the board knows of a rule's payback on one person (board_snapshot's `paybacks`). */
export interface PaybackState {
  rule: string;
  unit: PenaltyUnit;
  amount: number;
  /** What is owed on the rule now: 0 means paused. */
  owed: number;
  goal: string;
  repeat: GoalRepeat;
}

/**
 * The goal card's line: "A won week pays back $1 of the $2 Maya owes for Folder home"; all of it,
 * "A won week pays back the $1 Maya owes for Folder home"; with nothing owed, "Nothing owed ·
 * payback paused".
 */
export function goalPaybackLine(p: PaybackState, name: string): string {
  if (p.owed <= 0) return PAUSED;
  const noun = periodNoun(p.repeat);
  const lead = noun ? `A won ${noun} pays back` : 'Reaching it pays back';
  const back = Math.min(p.amount, p.owed);
  const owes = `${name} owes for ${p.rule}`;
  if (back >= p.owed) return `${lead} the ${unitAmount(p.unit, p.owed)} ${owes}`;
  const of = p.unit === 'money' ? money(p.owed) : `${p.owed}`;
  return `${lead} ${p.unit === 'money' ? money(back) : back} of the ${of}${
    p.unit === 'points' ? ' points' : ''
  } ${owes}`;
}

/** The board's Owes card: "Win a Folder home week: pays back $1"; a one-off goal, "Reach …". */
export function owesPaybackLine(p: PaybackState): string {
  const noun = periodNoun(p.repeat);
  const back = unitAmount(p.unit, Math.min(p.amount, Math.max(p.owed, 0)) || p.amount);
  return noun ? `Win a ${p.rule} ${noun}: pays back ${back}` : `Reach ${p.goal}: pays back ${back}`;
}

/** A payback in a person's history: "Folder home every school day, week won". */
export function paybackWhat(goal: string, repeat: GoalRepeat): string {
  const noun = periodNoun(repeat);
  return noun ? `${goal}, ${noun} won` : `${goal}, reached`;
}

/**
 * [PTS-11] The goals a rule can be paid back by, for its form: goals of the household still to be won
 * (as the database checks), each of the rule's people's or the family's; while nobody is chosen,
 * every one. "Folder home every school day · each week".
 */
export function paybackChoices(goals: PaybackGoal[], memberIds: string[]): PaybackGoal[] {
  return goals.filter(
    (g) => g.memberId === null || memberIds.length === 0 || memberIds.includes(g.memberId),
  );
}

export function goalChoiceLabel(g: PaybackGoal): string {
  const noun = periodNoun(g.repeat);
  return noun ? `${g.title} · each ${noun}` : g.title;
}

/** A board's payback for one person (board_snapshot's `paybacks`, as lib/snapshot reads it). */
export interface BoardPaybackLike extends PaybackState {
  ruleId: string;
  memberId: string;
  goalId: string;
}

/** [PTS-11] The goal card's lines for one person, by goal: paying back, or paused. */
export function goalPaybacks(
  paybacks: BoardPaybackLike[] | undefined,
  member: { id: string; displayName: string },
): Record<string, { key: string; text: string; paused: boolean }[]> {
  const by: Record<string, { key: string; text: string; paused: boolean }[]> = {};
  for (const p of paybacks ?? []) {
    if (p.memberId !== member.id) continue;
    (by[p.goalId] ??= []).push({
      key: p.ruleId,
      text: goalPaybackLine(p, member.displayName),
      paused: p.owed <= 0,
    });
  }
  return by;
}

/** [PTS-11] The Owes card's lines for one person: each money rule with something owed on it. */
export function owesPaybacks<T extends BoardPaybackLike>(
  paybacks: T[] | undefined,
  memberId: string,
): T[] {
  return (paybacks ?? []).filter((p) => p.memberId === memberId && p.unit === 'money' && p.owed > 0);
}
