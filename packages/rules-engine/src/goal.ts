import { datesBetween, dayNumber, weekOf } from './dates';
import {
  ALL_DONE,
  classifyDay,
  creditDate,
  familyUnits,
  inScope,
  memberUnits,
  tallyRoutines,
  type Unit,
} from './facts';
import type {
  GoalEvaluation,
  GoalInput,
  GoalStatus,
  GoalTransition,
  Qualify,
  Rule,
  RuleProgress,
  StreakParams,
} from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (value: number, target: number) =>
  target <= 0 ? 100 : round2(Math.min(100, (value / target) * 100));

const QUALIFY_MODES: readonly Qualify['mode'][] = ['all_scheduled', 'min_count', 'min_pct'];

/** [RWD-05] A STREAK rule's params with their defaults; anything present but malformed is refused. */
export function streakParams(params: Record<string, unknown>): StreakParams {
  const grace = params.grace_per_week ?? 1;
  if (typeof grace !== 'number' || !Number.isInteger(grace) || grace < 0) {
    throw new RangeError('grace_per_week must be a whole number, 0 or more');
  }
  const raw = (params.qualify ?? ALL_DONE) as Partial<Qualify>;
  if (typeof raw !== 'object' || raw === null || !QUALIFY_MODES.includes(raw.mode!)) {
    throw new RangeError('qualify.mode must be all_scheduled, min_count or min_pct');
  }
  const v = raw.value;
  if (raw.mode === 'min_count' && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) {
    throw new RangeError('qualify.value must be a whole number, 1 or more');
  }
  if (raw.mode === 'min_pct' && (typeof v !== 'number' || !(v > 0 && v <= 100))) {
    throw new RangeError('qualify.value must be a percentage above 0, up to 100');
  }
  return {
    grace_per_week: grace,
    qualify: raw.mode === 'all_scheduled' ? ALL_DONE : { mode: raw.mode!, value: v },
  };
}

interface Window {
  /** The days that count: from the goal's start to its end or today, whichever is first. */
  days: string[];
  from: string;
  to: string;
}

function evaluateRule(
  rule: Rule,
  all: Unit[],
  w: Window,
  asOf: string,
  weekStart: number,
): RuleProgress {
  if (!Number.isFinite(rule.target) || rule.target < 0) {
    throw new RangeError(`rule ${rule.id}: target must be 0 or more`);
  }
  const units = all.filter((u) => inScope(u.fact, rule.scope));
  const progress = (
    current: number,
    met: boolean,
    extra: Partial<RuleProgress> = {},
  ): RuleProgress => ({
    rule_id: rule.id,
    type: rule.type,
    current_value: current,
    target_value: rule.target,
    pct: met ? 100 : pctOf(current, rule.target),
    is_met: met,
    current_streak: null,
    best_streak: null,
    last_qualifying_date: null,
    ...extra,
  });

  switch (rule.type) {
    case 'COUNT':
    case 'POINTS': {
      // [RWD-02][D-31] Done and credited, on the day it counts for: tasks too.
      const done = units.filter((u) => {
        const d = creditDate(u.fact);
        return u.state === 'done' && d >= w.from && d <= w.to;
      });
      const value =
        rule.type === 'COUNT' ? done.length : done.reduce((sum, u) => sum + u.fact.points, 0);
      return progress(value, value >= rule.target);
    }
    case 'DAILY_ALL_DONE': {
      // [RWD-02] Days where every routine that counts is done; skipped and covered are neutral,
      // a day with none is not counted, and today counts once it is all done.
      const tally = tallyRoutines(units);
      let value = 0;
      let last: string | null = null;
      for (const date of w.days) {
        const t = tally.get(date);
        if (t && classifyDay(date, t, asOf, ALL_DONE) === 'good') {
          value += 1;
          last = date;
        }
      }
      return progress(value, value >= rule.target, { last_qualifying_date: last });
    }
    case 'STREAK': {
      // [RWD-05] Good days in a row. Neutral and open days pass over; up to grace_per_week bad days
      // in a household week are forgiven (they neither extend nor break the run); the next resets it.
      const { grace_per_week, qualify } = streakParams(rule.params);
      const tally = tallyRoutines(units);
      const forgiven = new Map<string, number>();
      let current = 0;
      let best = 0;
      let last: string | null = null;
      for (const date of w.days) {
        const t = tally.get(date);
        const cls = t ? classifyDay(date, t, asOf, qualify) : 'neutral';
        if (cls === 'good') {
          current += 1;
          best = Math.max(best, current);
          last = date;
        } else if (cls === 'bad') {
          const week = weekOf(date, weekStart);
          const used = forgiven.get(week) ?? 0;
          if (used < grace_per_week) forgiven.set(week, used + 1);
          else current = 0;
        }
      }
      // Once reached, the target stays met while the days that reached it stay done; until then
      // progress is the run going now.
      const met = best >= rule.target;
      return progress(met ? best : current, met, {
        current_streak: current,
        best_streak: best,
        last_qualifying_date: last,
      });
    }
    default:
      throw new RangeError(`rule ${rule.id}: unknown type ${String(rule.type)}`);
  }
}

/**
 * [RWD-04] The status changes this evaluation calls for, applied in turn until none applies:
 * a scheduled goal starts on its start date; an active goal is achieved while its rules are met,
 * or expires after its end date; an achieved goal whose rules are no longer met (a check-off was
 * reversed) goes back to active; a redeemed one stays redeemed and needs a parent's review.
 */
function transitionsFor(
  status: GoalStatus,
  achieved: boolean,
  started: boolean,
  ended: boolean,
): GoalTransition[] {
  const step = (s: GoalStatus): Omit<GoalTransition, 'from'> | null => {
    switch (s) {
      case 'scheduled':
        return started ? { type: 'started', to: 'active' } : null;
      case 'active':
        if (achieved) return { type: 'achieved', to: 'achieved' };
        return ended ? { type: 'expired', to: 'expired' } : null;
      case 'expired':
        // A parent's late credit inside the window can still achieve it.
        return achieved ? { type: 'achieved', to: 'achieved' } : null;
      case 'achieved':
        return achieved ? null : { type: 'unachieved', to: 'active' };
      case 'redeemed':
        return achieved ? null : { type: 'needs_review', to: 'redeemed' };
      case 'draft':
      case 'cancelled':
        return null;
    }
  };
  const out: GoalTransition[] = [];
  let s = status;
  // At most three steps apply (scheduled → active → achieved; achieved → active → expired).
  for (let i = 0; i < 3; i++) {
    const next = step(s);
    if (!next) break;
    out.push({ ...next, from: s });
    if (next.to === s) break;
    s = next.to;
  }
  return out;
}

/**
 * [RWD-02][RWD-03][RWD-04][RWD-05] A goal's progress from the facts as they stand (02 §5). Pure:
 * the same input always gives the same result, whatever order the facts come in.
 *
 * A member's goal counts only what was credited to them; a family goal counts each done
 * occurrence once. Achievement follows the facts, so a reversed check-off can un-achieve a goal.
 */
export function evaluateGoal(input: GoalInput): GoalEvaluation {
  const { goal, rules, asOf, weekStart } = input;
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) {
    throw new RangeError('weekStart must be 0 (Sunday) to 6 (Saturday)');
  }
  dayNumber(asOf);
  dayNumber(goal.start_date);
  if (goal.end_date !== null) dayNumber(goal.end_date);

  const to = goal.end_date !== null && goal.end_date < asOf ? goal.end_date : asOf;
  const w: Window = { from: goal.start_date, to, days: datesBetween(goal.start_date, to) };
  const units =
    goal.member_id === null
      ? familyUnits(input.occurrences)
      : memberUnits(input.occurrences, goal.member_id);

  const progress = rules.map((r) => evaluateRule(r, units, w, asOf, weekStart));
  const met = progress.filter((p) => p.is_met).length;
  const isAchieved =
    progress.length > 0 && (goal.rule_logic === 'all' ? met === progress.length : met > 0);
  const pcts = progress.map((p) => p.pct);
  const pct =
    pcts.length === 0
      ? 0
      : goal.rule_logic === 'all'
        ? round2(pcts.reduce((a, b) => a + b, 0) / pcts.length)
        : Math.max(...pcts);

  return {
    goal_id: goal.id,
    pct,
    is_achieved: isAchieved,
    rules: progress,
    transitions: transitionsFor(
      goal.status,
      isAchieved,
      goal.start_date <= asOf,
      goal.end_date !== null && goal.end_date < asOf,
    ),
  };
}
