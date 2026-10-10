import { describe, expect, it } from 'vitest';
import { covered, done, fact, missed, open, pending, skipped, taskDone } from './fixtures';
import { evaluateGoal, streakParams } from './goal';
import type { GoalInput, GoalStatus, OccurrenceFact, Rule, RuleType } from './types';

// Friday, Oct 9, 2026 is today. Oct 4 is a Sunday, Oct 5 a Monday.
const TODAY = '2026-10-09';

const rule = (type: RuleType, target: number, o: Partial<Rule> = {}): Rule => ({
  id: `r-${type}`,
  type,
  target,
  scope: { all: true },
  params: {},
  ...o,
});

function evaluate(
  rules: Rule[],
  occurrences: OccurrenceFact[],
  goal: Partial<GoalInput['goal']> = {},
  { asOf = TODAY, weekStart = 0 } = {},
) {
  return evaluateGoal({
    goal: {
      id: 'g1',
      member_id: 'maya',
      start_date: '2026-10-01',
      end_date: null,
      rule_logic: 'all',
      status: 'active',
      ...goal,
    },
    rules,
    occurrences,
    asOf,
    weekStart,
  });
}
const progressOf = (r: Rule, occurrences: OccurrenceFact[], goal = {}, opts = {}) =>
  evaluate([r], occurrences, goal, opts).rules[0]!;

describe('COUNT and POINTS', () => {
  it('[RWD-02] count what was done and credited between the start date and today', () => {
    const p = progressOf(rule('COUNT', 4), [
      done('2026-09-30'), // before the start
      done('2026-10-02'),
      fact('2026-10-05', 'approved'),
      open('2026-10-08'),
    ]);
    expect(p).toMatchObject({ current_value: 2, target_value: 4, pct: 50, is_met: false });
  });

  it('[RWD-02] waiting for a parent, sent back, missed and covered do not count; an undone check-off no longer does', () => {
    const p = progressOf(rule('COUNT', 1), [
      pending('2026-10-02'),
      fact('2026-10-03', 'rejected'),
      missed('2026-10-04'),
      covered('2026-10-05'),
      // Checked off, then undone: back to scheduled.
      open('2026-10-06'),
    ]);
    expect(p).toMatchObject({ current_value: 0, is_met: false });
  });

  it('[RWD-02][D-31] tasks count on the day they were done, even when due before the goal began', () => {
    const p = progressOf(rule('COUNT', 2), [
      taskDone('2026-09-28', '2026-10-02'),
      taskDone('2026-10-08', '2026-10-10'), // done after today: not yet
      fact('2026-10-03', 'scheduled', { kind: 'task' }),
    ]);
    expect(p.current_value).toBe(1);
  });

  it('[RWD-02] points add up each occurrence’s own points, so later edits to an item change nothing', () => {
    const p = progressOf(rule('POINTS', 10), [
      done('2026-10-02', { points: 5 }),
      done('2026-10-03', { points: 8 }), // the item was worth more later
      taskDone('2026-10-04', '2026-10-04', { points: 2 }),
    ]);
    expect(p).toMatchObject({ current_value: 15, pct: 100, is_met: true });
  });

  it('[RWD-02][D-30][D-32] a member’s goal counts only what was credited to them', () => {
    const p = progressOf(rule('COUNT', 5), [
      done('2026-10-02'),
      covered('2026-10-03'), // her brother did it for her
      done('2026-10-04', { member_id: 'leo' }),
      fact('2026-10-05', 'completed', { credited: false }),
    ]);
    expect(p.current_value).toBe(1);
  });

  it('[RWD-02][D-30] a family goal counts each done occurrence once, whoever and however many did it', () => {
    const together = { id: 'dog-0402', points: 5 };
    const occurrences = [
      done('2026-10-02', { ...together }),
      done('2026-10-02', { ...together, member_id: 'leo' }),
      covered('2026-10-03', { id: 'bins', member_id: 'maya' }),
      done('2026-10-03', { id: 'bins', member_id: 'alex', points: 0 }),
      missed('2026-10-04', { id: 'table', member_id: 'leo' }),
    ];
    const family = { member_id: null };
    expect(progressOf(rule('COUNT', 5), occurrences, family).current_value).toBe(2);
    expect(progressOf(rule('POINTS', 5), occurrences, family).current_value).toBe(5);
  });
});

describe('DAILY_ALL_DONE', () => {
  it('[RWD-02] counts days where every routine is done; tasks are ignored; skipped and covered are neutral', () => {
    const p = progressOf(rule('DAILY_ALL_DONE', 5), [
      done('2026-10-02'),
      done('2026-10-02'),
      fact('2026-10-02', 'scheduled', { kind: 'task' }), // an open task spoils nothing
      done('2026-10-03'),
      skipped('2026-10-03'),
      done('2026-10-04'),
      covered('2026-10-04'),
      done('2026-10-05'),
      missed('2026-10-05'), // not all done
      done('2026-10-06'),
      pending('2026-10-06'), // waiting is not done yet
    ]);
    expect(p).toMatchObject({ current_value: 3, last_qualifying_date: '2026-10-04' });
  });

  it('[RWD-02] a day with no routines is neither counted nor held against anyone', () => {
    const p = progressOf(rule('DAILY_ALL_DONE', 2), [
      done('2026-10-02'),
      skipped('2026-10-03'),
      covered('2026-10-04'),
      done('2026-10-05'),
    ]);
    expect(p).toMatchObject({ current_value: 2, is_met: true });
  });

  it('[RWD-02][D-51] today counts as soon as everything due today is done', () => {
    expect(progressOf(rule('DAILY_ALL_DONE', 1), [done(TODAY)]).current_value).toBe(1);
    expect(progressOf(rule('DAILY_ALL_DONE', 1), [done(TODAY), open(TODAY)]).current_value).toBe(0);
  });
});

describe('STREAK', () => {
  const streak = (target: number, params: Record<string, unknown> = {}) =>
    rule('STREAK', target, { params });

  it('[RWD-05] one missed day in a week is forgiven: the streak is kept, not extended', () => {
    const p = progressOf(streak(7), [
      done('2026-10-05'),
      done('2026-10-06'),
      missed('2026-10-07'),
      done('2026-10-08'),
      open(TODAY),
    ]);
    expect(p).toMatchObject({ current_streak: 3, best_streak: 3, current_value: 3 });
  });

  it('[RWD-05] a further bad day in the same week resets the streak; the best is still reported', () => {
    const p = progressOf(streak(7), [
      done('2026-10-05'),
      missed('2026-10-06'),
      done('2026-10-07'),
      missed('2026-10-08'),
    ]);
    expect(p).toMatchObject({
      current_streak: 0,
      best_streak: 2,
      last_qualifying_date: '2026-10-07',
    });
  });

  it('[RWD-05] grace is per household week, so the first day of the week decides', () => {
    // Fri Oct 2 good, Sat Oct 3 and Sun Oct 4 missed, Mon Oct 5 good.
    const days = [
      done('2026-10-02'),
      missed('2026-10-03'),
      missed('2026-10-04'),
      done('2026-10-05'),
    ];
    // Weeks start on Sunday: Saturday and Sunday are in different weeks, each forgiven.
    expect(progressOf(streak(7), days, {}, { weekStart: 0 }).current_streak).toBe(2);
    // Weeks start on Monday: both are in one week, so the second resets the streak.
    expect(progressOf(streak(7), days, {}, { weekStart: 1 }).current_streak).toBe(1);
  });

  it('[RWD-05] with no grace, any bad day resets the streak', () => {
    const p = progressOf(streak(3, { grace_per_week: 0 }), [
      done('2026-10-05'),
      missed('2026-10-06'),
      done('2026-10-07'),
    ]);
    expect(p).toMatchObject({ current_streak: 1, best_streak: 1 });
  });

  it('[RWD-05] days with no chores (a weekend) neither extend nor break a streak', () => {
    const p = progressOf(streak(4), [
      done('2026-10-01'),
      done('2026-10-02'),
      done('2026-10-05'),
      done('2026-10-06'),
    ]);
    expect(p).toMatchObject({ current_streak: 4, is_met: true });
  });

  it('[RWD-05] at 2 pm with today’s chores unfinished, today is not a miss', () => {
    const p = progressOf(streak(7, { grace_per_week: 0 }), [
      done('2026-10-08'),
      done(TODAY),
      open(TODAY),
    ]);
    expect(p).toMatchObject({ current_streak: 1, best_streak: 1 });
  });

  it('[RWD-05] a miss already recorded for today does not reset the streak before the day is closed', () => {
    const p = progressOf(streak(7, { grace_per_week: 0 }), [done('2026-10-08'), missed(TODAY)]);
    expect(p).toMatchObject({ current_streak: 1, best_streak: 1 });
  });

  it('[RWD-05] a day qualifies by all done (default), at least a count, or at least a percentage', () => {
    // Each day: 3 routines, 2 done.
    const days = ['2026-10-05', '2026-10-06', '2026-10-07'].flatMap((d) => [
      done(d),
      done(d),
      missed(d),
    ]);
    const run = (params: Record<string, unknown>) =>
      progressOf(streak(3, { grace_per_week: 0, ...params }), days).current_streak;
    expect(run({})).toBe(0);
    expect(run({ qualify: { mode: 'min_count', value: 2 } })).toBe(3);
    expect(run({ qualify: { mode: 'min_count', value: 5 } })).toBe(0);
    expect(run({ qualify: { mode: 'min_pct', value: 66 } })).toBe(3);
    expect(run({ qualify: { mode: 'min_pct', value: 70 } })).toBe(0);
  });

  it('[RWD-05] a day with fewer routines than the count qualifies when all of them are done', () => {
    const p = progressOf(streak(1, { qualify: { mode: 'min_count', value: 3 } }), [
      done('2026-10-05'),
    ]);
    expect(p.current_streak).toBe(1);
  });

  it('[RWD-05][RWD-04] once reached, the target stays met while those days stay done; before that, progress is the run now', () => {
    const reached = progressOf(streak(2, { grace_per_week: 0 }), [
      done('2026-10-05'),
      done('2026-10-06'),
      missed('2026-10-07'),
    ]);
    expect(reached).toMatchObject({ is_met: true, current_streak: 0, best_streak: 2, pct: 100 });
    const notYet = progressOf(streak(4, { grace_per_week: 0 }), [
      done('2026-10-05'),
      done('2026-10-06'),
      done('2026-10-07'),
      missed('2026-10-08'),
      done(TODAY),
    ]);
    expect(notYet).toMatchObject({ is_met: false, current_value: 1, pct: 25, best_streak: 3 });
  });

  it('[RWD-05] the streak params default to one forgiven day a week and all done', () => {
    expect(streakParams({})).toEqual({ grace_per_week: 1, qualify: { mode: 'all_scheduled' } });
    // A stored null (jsonb) is the same as not set.
    expect(streakParams({ grace_per_week: null, qualify: null })).toEqual(streakParams({}));
    expect(streakParams({ grace_per_week: 2, qualify: { mode: 'min_pct', value: 80 } })).toEqual({
      grace_per_week: 2,
      qualify: { mode: 'min_pct', value: 80 },
    });
  });

  it('[RWD-05] malformed streak params are refused, not guessed', () => {
    for (const params of [
      { grace_per_week: -1 },
      { grace_per_week: 1.5 },
      { grace_per_week: '1' },
      { qualify: { mode: 'most' } },
      { qualify: 'all' },
      { qualify: { mode: 'min_count' } },
      { qualify: { mode: 'min_count', value: 0 } },
      { qualify: { mode: 'min_pct', value: 0 } },
      { qualify: { mode: 'min_pct', value: 101 } },
    ]) {
      expect(() => streakParams(params as Record<string, unknown>)).toThrow(RangeError);
    }
  });
});

describe('a goal: rules combined, scope, window', () => {
  const twoDone = [done('2026-10-02'), done('2026-10-03')];

  it('[RWD-03] with all, every rule must be met; progress is the mean of the rules', () => {
    const e = evaluate([rule('COUNT', 2), rule('POINTS', 20, { id: 'r-pts' })], twoDone);
    expect(e).toMatchObject({ is_achieved: false, pct: 75 });
  });

  it('[RWD-03] with any, one met rule achieves it; progress is the best rule, capped at 100', () => {
    const e = evaluate([rule('COUNT', 1), rule('POINTS', 20, { id: 'r-pts' })], twoDone, {
      rule_logic: 'any',
    });
    expect(e).toMatchObject({ is_achieved: true, pct: 100 });
  });

  it('[RWD-03] a goal with no rules is never achieved', () => {
    expect(evaluate([], twoDone)).toMatchObject({ is_achieved: false, pct: 0, rules: [] });
  });

  it('[CHR-10][RWD-02] scope by tag id or by item, either one counting; renaming a tag changes nothing', () => {
    const occurrences = [
      done('2026-10-02', { chore_id: 'make-bed', tag_ids: ['t-morning'] }),
      done('2026-10-02', { chore_id: 'teeth', tag_ids: ['t-morning', 't-health'] }),
      done('2026-10-03', { chore_id: 'dishes', tag_ids: ['t-kitchen'] }),
      done('2026-10-03', { chore_id: 'homework', tag_ids: [] }),
    ];
    const count = (scope: Rule['scope']) =>
      progressOf(rule('COUNT', 10, { scope }), occurrences).current_value;
    expect(count({ tag_ids: ['t-morning'] })).toBe(2);
    expect(count({ tag_ids: ['t-health', 't-kitchen'] })).toBe(2);
    expect(count({ chore_ids: ['homework'] })).toBe(1);
    expect(count({ chore_ids: ['homework'], tag_ids: ['t-morning'] })).toBe(3);
    expect(count({ all: true })).toBe(4);
    expect(count({})).toBe(0);
  });

  it('[RWD-02] only days from the start date to the end date count, and never after today', () => {
    const occurrences = [
      done('2026-10-01'),
      done('2026-10-03'),
      done('2026-10-05'),
      done('2026-10-08'),
    ];
    expect(
      progressOf(rule('COUNT', 9), occurrences, { end_date: '2026-10-04' }).current_value,
    ).toBe(2);
    expect(
      progressOf(rule('COUNT', 9), occurrences, { start_date: '2026-10-12' }).current_value,
    ).toBe(0);
  });

  it('[RWD-02] a rule with a target of 0 is met at once; a negative target is refused', () => {
    expect(progressOf(rule('COUNT', 0), [])).toMatchObject({ is_met: true, pct: 100 });
    expect(() => evaluate([rule('COUNT', -1)], [])).toThrow(RangeError);
    expect(() => evaluate([rule('COUNT', Number.NaN)], [])).toThrow(RangeError);
    expect(() => evaluate([rule('TOTAL' as RuleType, 1)], [])).toThrow(RangeError);
  });

  it('[RWD-02] refuses a bad date or week start rather than guess', () => {
    expect(() => evaluate([], [], {}, { asOf: '2026-10-32' })).toThrow(RangeError);
    expect(() => evaluate([], [], { start_date: 'soon' })).toThrow(RangeError);
    expect(() => evaluate([], [], { end_date: '2026-02-30' })).toThrow(RangeError);
    expect(() => evaluate([], [], {}, { weekStart: 7 })).toThrow(RangeError);
  });
});

describe('the status changes an evaluation calls for', () => {
  const met = [rule('COUNT', 1)];
  const transitions = (status: GoalStatus, occurrences: OccurrenceFact[], goal = {}) =>
    evaluate(met, occurrences, { status, ...goal }).transitions.map(
      (t) => `${t.from}>${t.type}>${t.to}`,
    );

  it('[RWD-04] a goal is achieved while its rules are met', () => {
    expect(transitions('active', [done('2026-10-02')])).toEqual(['active>achieved>achieved']);
    expect(transitions('achieved', [done('2026-10-02')])).toEqual([]);
  });

  it('[RWD-04] a reversed check-off un-achieves it: back to active, or expired once the window has passed', () => {
    expect(transitions('achieved', [open('2026-10-02')])).toEqual(['achieved>unachieved>active']);
    expect(transitions('achieved', [open('2026-10-02')], { end_date: '2026-10-05' })).toEqual([
      'achieved>unachieved>active',
      'active>expired>expired',
    ]);
  });

  it('[RWD-01] a scheduled goal starts on its start date, and may be achieved at once', () => {
    expect(transitions('scheduled', [], { start_date: '2026-10-12' })).toEqual([]);
    expect(transitions('scheduled', [], { start_date: TODAY })).toEqual([
      'scheduled>started>active',
    ]);
    expect(transitions('scheduled', [done(TODAY)], { start_date: TODAY })).toEqual([
      'scheduled>started>active',
      'active>achieved>achieved',
    ]);
  });

  it('[RWD-01] a goal not met by its end date expires; a parent’s late credit can still achieve it', () => {
    expect(transitions('active', [], { end_date: '2026-10-05' })).toEqual([
      'active>expired>expired',
    ]);
    expect(transitions('active', [], { end_date: TODAY })).toEqual([]);
    expect(transitions('expired', [done('2026-10-04')], { end_date: '2026-10-05' })).toEqual([
      'expired>achieved>achieved',
    ]);
  });

  it('[RWD-04] a redeemed goal whose rules are no longer met stays redeemed and needs review', () => {
    expect(transitions('redeemed', [open('2026-10-02')])).toEqual([
      'redeemed>needs_review>redeemed',
    ]);
    expect(transitions('redeemed', [done('2026-10-02')])).toEqual([]);
  });

  it('[RWD-01] draft and cancelled goals change nothing', () => {
    expect(transitions('draft', [done('2026-10-02')])).toEqual([]);
    expect(transitions('cancelled', [done('2026-10-02')])).toEqual([]);
  });
});
