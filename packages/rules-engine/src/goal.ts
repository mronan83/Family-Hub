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
import { nextSpanStart, spansBetween } from './periods';
import type {
  DayMark,
  DaysDueParams,
  GoalEvaluation,
  GoalInput,
  GoalStatus,
  GoalTransition,
  PeriodResult,
  Qualify,
  Repeat,
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

/** [RWD-16] A DAYS_DUE rule's params with their default; anything present but malformed is refused. */
export function daysDueParams(params: Record<string, unknown>): DaysDueParams {
  const m = params.misses_allowed ?? 0;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 3) {
    throw new RangeError('misses_allowed must be a whole number from 0 to 3');
  }
  return { misses_allowed: m };
}

interface Window {
  /** The days that count: from the goal's (or period's) start to its end or today, whichever is first. */
  days: string[];
  from: string;
  to: string;
  /** The last day of the goal or period, today or later: a DAYS_DUE rule counts the days due up to it. */
  until: string;
}

/** [RWD-16] Each day of `from` to `until` for the routines in scope: due or not, and how it went. */
function daysDueTally(units: Unit[], from: string, until: string, asOf: string) {
  const tally = tallyRoutines(units);
  let due = 0;
  let good = 0;
  let bad = 0;
  let last: string | null = null;
  const marks: { date: string; mark: DayMark }[] = [];
  for (const date of datesBetween(from, until)) {
    const t = tally.get(date);
    // Skipped and covered aren't due (neutral, D-30); a day with nothing due isn't either.
    const cls = t ? classifyDay(date, t, asOf, ALL_DONE) : 'neutral';
    let mark: DayMark;
    if (cls === 'neutral') mark = 'none';
    else if (cls === 'good') mark = 'done';
    else if (cls === 'bad') mark = 'missed';
    else mark = date === asOf ? 'today' : date > asOf ? 'later' : 'open';
    if (cls !== 'neutral') due += 1;
    if (cls === 'good') {
      good += 1;
      last = date;
    } else if (cls === 'bad') bad += 1;
    marks.push({ date, mark });
  }
  return { due, good, bad, last, marks };
}

/**
 * [RWD-16] The days a DAYS_DUE rule needs: every day due less the misses allowed, and at least one
 * when anything is due (a short week with as many misses allowed as days still needs a day done).
 */
const daysNeeded = (due: number, misses: number) => (due === 0 ? 0 : Math.max(1, due - misses));

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
    target = rule.target,
  ): RuleProgress => ({
    rule_id: rule.id,
    type: rule.type,
    current_value: current,
    target_value: target,
    pct: met ? 100 : pctOf(current, target),
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
    case 'DAYS_DUE': {
      // [RWD-16] Every day it's due, this period: a day counts when everything in scope due that day
      // is done; the target is the days due less the misses allowed.
      const { misses_allowed } = daysDueParams(rule.params);
      const t = daysDueTally(units, w.from, w.until, asOf);
      const needed = daysNeeded(t.due, misses_allowed);
      return progress(
        t.good,
        t.due > 0 && t.good >= needed,
        { last_qualifying_date: t.last },
        needed,
      );
    }
    default:
      throw new RangeError(`rule ${rule.id}: unknown type ${String(rule.type)}`);
  }
}

/** [RWD-02] The goal's (or a period's) progress from its rules', and whether they are met. */
function combine(progress: RuleProgress[], logic: 'all' | 'any') {
  const met = progress.filter((p) => p.is_met).length;
  const isAchieved = progress.length > 0 && (logic === 'all' ? met === progress.length : met > 0);
  const pcts = progress.map((p) => p.pct);
  const pct =
    pcts.length === 0
      ? 0
      : logic === 'all'
        ? round2(pcts.reduce((a, b) => a + b, 0) / pcts.length)
        : Math.max(...pcts);
  return { pct, isAchieved };
}

const REPEATS: readonly Repeat[] = ['none', 'week', 'month', 'term'];
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * [RWD-15][RWD-16] A repeating goal's periods from its start to the one holding today (or its end),
 * each worked out on its own: every rule inside the period (cut to the goal's dates), then
 *   won: the rules are met (all or any); missed: a DAYS_DUE rule has more misses than allowed (the
 *   period is lost at once, "starts again" the next period), or the period closed unmet; neutral: it
 *   closed unmet with nothing in scope due (a break); open: still going.
 */
function evaluatePeriods(input: GoalInput, units: Unit[], repeat: Exclude<Repeat, 'none'>) {
  const { goal, rules, asOf, weekStart, terms = [] } = input;
  if (goal.start_date > asOf) return [];
  const last = goal.end_date !== null && goal.end_date < asOf ? goal.end_date : asOf;
  return spansBetween(repeat, goal.start_date, last, weekStart, terms).map((span): PeriodResult => {
    const from = later(span.from, goal.start_date);
    const until = goal.end_date === null ? span.to : earlier(span.to, goal.end_date);
    const to = earlier(until, asOf);
    const w: Window = { from, to, until, days: datesBetween(from, to) };
    const progress = rules.map((r) => evaluateRule(r, units, w, asOf, weekStart));
    const { pct, isAchieved } = combine(progress, goal.rule_logic);

    let first: ReturnType<typeof daysDueTally> | null = null;
    let allowed: number | null = null;
    const lost = rules.map((r) => {
      if (r.type !== 'DAYS_DUE') return false;
      const t = daysDueTally(
        units.filter((u) => inScope(u.fact, r.scope)),
        from,
        until,
        asOf,
      );
      const { misses_allowed } = daysDueParams(r.params);
      if (!first) {
        first = t;
        allowed = misses_allowed;
      }
      return t.bad > misses_allowed;
    });
    const isLost = goal.rule_logic === 'all' ? lost.some(Boolean) : lost.every(Boolean);
    const closed = until < asOf;
    // Nothing in scope due in the period: no routine (skipped and covered aren't due) for any rule.
    const nothingDue = rules.every(
      (r) =>
        !units.some(
          (u) =>
            u.fact.kind === 'chore' &&
            u.fact.due_date >= from &&
            u.fact.due_date <= until &&
            u.state !== 'skipped' &&
            u.state !== 'covered' &&
            inScope(u.fact, r.scope),
        ),
    );
    const outcome = isAchieved
      ? 'won'
      : isLost
        ? 'missed'
        : closed
          ? nothingDue
            ? 'neutral'
            : 'missed'
          : 'open';
    const next = nextSpanStart(repeat, span, terms);
    const f = first as ReturnType<typeof daysDueTally> | null;
    return {
      start: from,
      end: until,
      outcome,
      next_start: next !== null && (goal.end_date === null || next <= goal.end_date) ? next : null,
      pct: outcome === 'won' ? 100 : pct,
      rules: progress,
      days_due: f ? f.due : null,
      days_done: f ? f.good : null,
      days_missed: f ? f.bad : null,
      misses_allowed: allowed,
      days: f && repeat === 'week' ? f.marks : null,
    };
  });
}

/** A rule's progress before its goal's first period: nothing done yet. */
const notStarted = (r: Rule): RuleProgress => ({
  rule_id: r.id,
  type: r.type,
  current_value: 0,
  target_value: r.type === 'DAYS_DUE' ? 0 : r.target,
  pct: 0,
  is_met: false,
  current_streak: r.type === 'STREAK' ? 0 : null,
  best_streak: r.type === 'STREAK' ? 0 : null,
  last_qualifying_date: null,
});

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

  const repeat = goal.repeat ?? 'none';
  if (!REPEATS.includes(repeat)) throw new RangeError(`unknown repeat ${String(repeat)}`);
  const units =
    goal.member_id === null
      ? familyUnits(input.occurrences)
      : memberUnits(input.occurrences, goal.member_id);
  const started = goal.start_date <= asOf;
  const ended = goal.end_date !== null && goal.end_date < asOf;

  if (repeat !== 'none') {
    // [RWD-15] Each period is reached and pays on its own; the goal itself is never "achieved", it
    // goes on until its end date (or a parent stops it). Its progress is the period going now.
    const periods = evaluatePeriods(input, units, repeat);
    const current = periods.find((p) => p.start <= asOf && asOf <= p.end) ?? periods.at(-1);
    return {
      goal_id: goal.id,
      pct: current?.pct ?? 0,
      is_achieved: current?.outcome === 'won',
      rules: current?.rules ?? rules.map(notStarted),
      transitions: transitionsFor(goal.status, false, started, ended),
      periods,
    };
  }
  if (rules.some((r) => r.type === 'DAYS_DUE')) {
    throw new RangeError('every day it’s due is for a goal that repeats');
  }

  const to = ended ? goal.end_date! : asOf;
  const w: Window = {
    from: goal.start_date,
    to,
    until: goal.end_date ?? asOf,
    days: datesBetween(goal.start_date, to),
  };
  const progress = rules.map((r) => evaluateRule(r, units, w, asOf, weekStart));
  const { pct, isAchieved } = combine(progress, goal.rule_logic);

  return {
    goal_id: goal.id,
    pct,
    is_achieved: isAchieved,
    rules: progress,
    transitions: transitionsFor(goal.status, isAchieved, started, ended),
    periods: [],
  };
}
