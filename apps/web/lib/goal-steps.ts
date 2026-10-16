import type { OnTime, RuleType, Step, StepResult } from '@familywise/rules-engine';
import { weekday } from './goal-periods';

// [RWD-17][RWD-18] A goal done by a time, and goals that pay in steps (WP-81, D-102, D-124), in
// words: the same lines in the admin app and on the board.

/** A lower step as the database stores it (the payout's `steps`): days missed, or where it's reached. */
export interface LowerStep {
  misses?: number;
  at?: number;
  amount: number;
}

/** What the steps read: days missed (one "every day it's due" rule), a number, or the goal's %. */
export type StepKind = 'misses' | 'number' | 'weighted';

export function stepKind(rules: readonly { type: RuleType }[]): StepKind {
  return rules.length > 1 ? 'weighted' : rules[0]?.type === 'DAYS_DUE' ? 'misses' : 'number';
}

/**
 * [RWD-18] A goal's steps for the engine, highest first: the top is the goal's own target and points
 * (0 missed, the rule's target, or 100%), then its lower steps. Empty without steps.
 */
export function goalSteps(
  payout: { type: string; amount?: number; steps?: LowerStep[] } | null | undefined,
  rules: readonly { type: RuleType; target: number }[],
): Step[] {
  if (!payout || payout.type !== 'points' || !payout.steps?.length || !payout.amount) return [];
  const kind = stepKind(rules);
  const top: Step =
    kind === 'misses'
      ? { misses: 0, amount: payout.amount }
      : { at: kind === 'weighted' ? 100 : (rules[0]?.target ?? 0), amount: payout.amount };
  return [top, ...payout.steps.map((s) => ({ ...s }))];
}

const pts = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'point' : 'points'}`;

/**
 * [RWD-18] Each step's chip, highest first: "All 5: 20", "4: 10" (days missed, with the period's days
 * due; "All days: 20", "1 missed: 10" without), "20: 20" (a number), "100%: 20" (weighted).
 */
export function stepChips(
  steps: readonly Step[],
  kind: StepKind,
  daysDue?: number | null,
): string[] {
  return steps.map((s, i) => {
    if (kind === 'misses') {
      const m = s.misses ?? 0;
      if (daysDue)
        return i === 0 ? `All ${daysDue}: ${s.amount}` : `${Math.max(0, daysDue - m)}: ${s.amount}`;
      return i === 0 ? `All days: ${s.amount}` : `${m} missed: ${s.amount}`;
    }
    return kind === 'weighted' ? `${s.at}%: ${s.amount}` : `${s.at}: ${s.amount}`;
  });
}

/** [RWD-18] "Pays 20, 10 or 5 points" for a goal's line. */
export function stepsPayWords(steps: readonly Step[], family = false): string {
  const amounts = steps.map((s) => s.amount.toLocaleString('en-US'));
  const list =
    amounts.length <= 2
      ? amounts.join(' or ')
      : `${amounts.slice(0, -1).join(', ')} or ${amounts.at(-1)}`;
  return `${list} points${family ? ' each' : ''}`;
}

/** [RWD-18] The step that pays as a goal's or period's line: "Won at 1 missed: 10 points". */
export function stepWonWords(
  steps: readonly Step[],
  kind: StepKind,
  step: number | null,
): string | null {
  if (step === null || !steps[step]) return null;
  const s = steps[step]!;
  if (step === 0) return `Won, all of it: ${pts(s.amount)}`;
  const at =
    kind === 'misses' ? `${s.misses} missed` : kind === 'weighted' ? `${s.at}%` : `${s.at}`;
  return `Won at ${at}: ${pts(s.amount)}`;
}

/**
 * [RWD-18] The nudge for a period or goal going: on days missed, what it makes if the rest is on
 * time ("On course for 10 points.") or what it has made; counted another way, what it has made so
 * far. Null when nothing is in reach or reached.
 */
export function stepNudge(
  steps: readonly Step[],
  step: Pick<StepResult, 'reached' | 'best'> | null,
  kind: StepKind = 'misses',
): string | null {
  if (!step) return null;
  if (kind !== 'misses') {
    return step.reached !== null && steps[step.reached]
      ? `${pts(steps[step.reached]!.amount)} so far.`
      : null;
  }
  if (step.best === null || !steps[step.best]) return null;
  if (step.reached !== null && step.reached === step.best) {
    return `${pts(steps[step.reached]!.amount)} so far.`;
  }
  return `On course for ${pts(steps[step.best]!.amount)}.`;
}

/** [RWD-18] The chip to mark: the step won at; else, on days missed, the best in reach; else the one reached. */
export function markedStep(
  kind: StepKind,
  step: { won: boolean; reached: number | null; best: number | null },
): number | null {
  if (step.won || kind !== 'misses') return step.reached;
  return step.best;
}

/** [RWD-17] "by 6:00 pm" or "by each chore’s due time" for a rule's time; null for any time. */
export function onTimeWords(on: OnTime | string | null | undefined): string | null {
  if (!on) return null;
  if (on === 'due_time') return 'by each chore’s due time';
  return `by ${clockWords(on)}`;
}

/** "6:00 pm" for "18:00". */
export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** [RWD-17] "Wednesday was after 6:00 pm." for each day of a week ticked after the rule's time. */
export function lateLine(
  days: readonly { date: string; mark: string }[] | null,
  on: OnTime | string | null | undefined,
): string | null {
  const late = (days ?? []).filter((d) => d.mark === 'late').map((d) => weekday(d.date));
  if (late.length === 0 || !on) return null;
  const when = on === 'due_time' ? 'its due time' : clockWords(on);
  const list =
    late.length <= 2 ? late.join(' and ') : `${late.slice(0, -1).join(', ')} and ${late.at(-1)}`;
  return `${list} ${late.length === 1 ? 'was' : 'were'} after ${when}.`;
}

/** [RWD-18] A board goal's steps, highest first, and how they read; empty without steps. */
export function boardSteps(goal: {
  pays?: number | null;
  steps?: LowerStep[];
  rules: readonly { type: RuleType; target: number }[];
}): { steps: Step[]; kind: StepKind } {
  return {
    steps: goalSteps(
      goal.pays ? { type: 'points', amount: goal.pays, steps: goal.steps } : null,
      goal.rules,
    ),
    kind: stepKind(goal.rules),
  };
}
