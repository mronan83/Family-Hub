import { describe, expect, it } from 'vitest';
import { done, missed, open, pending, skipped } from './fixtures';
import { daysDueParams, evaluateGoal } from './goal';
import { nextSpanStart, spansBetween } from './periods';
import type { GoalInput, OccurrenceFact, Repeat, Rule } from './types';

// Repeating goals (WP-80, D-101). Thursday, Oct 15, 2026 is today; the family's week starts Monday.
// Oct 5 and Oct 12 are Mondays; Oct 19 is the next.
const TODAY = '2026-10-15';
const MON = 1;

const homework = (o: Partial<Rule> = {}): Rule => ({
  id: 'r-days',
  type: 'DAYS_DUE',
  target: 1,
  scope: { chore_ids: ['homework'] },
  params: { misses_allowed: 0 },
  ...o,
});
const hw = { chore_id: 'homework' };
/** Homework on each date, done unless the date is listed in `as`. */
const week = (dates: string[], as: Record<string, (d: string) => OccurrenceFact> = {}) =>
  dates.map((d) => (as[d] ? as[d]!(d) : done(d, hw)));

function evaluate(
  rules: Rule[],
  occurrences: OccurrenceFact[],
  goal: Partial<GoalInput['goal']> = {},
  { asOf = TODAY, terms }: { asOf?: string; terms?: GoalInput['terms'] } = {},
) {
  return evaluateGoal({
    goal: {
      id: 'g1',
      member_id: 'maya',
      start_date: '2026-10-05',
      end_date: null,
      rule_logic: 'all',
      status: 'active',
      repeat: 'week',
      ...goal,
    },
    rules,
    occurrences,
    asOf,
    weekStart: MON,
    terms,
  });
}

const LAST_WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

describe('every day it’s due, each week', () => {
  it('[RWD-16-a] a 5-day week with everything done every day is won', () => {
    const [p] = evaluate([homework()], week(LAST_WEEK)).periods;
    expect(p).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-11',
      outcome: 'won',
      days_due: 5,
      days_done: 5,
      days_missed: 0,
      misses_allowed: 0,
      next_start: '2026-10-12',
    });
    expect(p!.rules[0]).toMatchObject({ current_value: 5, target_value: 5, is_met: true });
  });

  it('[RWD-16-b] a 4-day week (Friday a closure, nothing due) is won with 4', () => {
    // This week: Monday to Thursday due; Friday no school, so no homework is planned.
    const e = evaluate(
      [homework()],
      week(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']),
    );
    const now = e.periods.at(-1)!;
    expect(now).toMatchObject({ start: '2026-10-12', outcome: 'won', days_due: 4, days_done: 4 });
    expect(now.days!.map((d) => d.mark)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'none',
      'none',
      'none',
    ]);
    expect(e).toMatchObject({ is_achieved: true, pct: 100, transitions: [] });
  });

  it('[RWD-16-b] the week is not won while a day due is still to come', () => {
    const e = evaluate(
      [homework()],
      [
        ...week(['2026-10-12', '2026-10-13', '2026-10-14']),
        open('2026-10-15', hw),
        open('2026-10-16', hw),
      ],
    );
    const now = e.periods.at(-1)!;
    expect(now).toMatchObject({ outcome: 'open', days_due: 5, days_done: 3 });
    expect(now.days!.slice(0, 5).map((d) => d.mark)).toEqual([
      'done',
      'done',
      'done',
      'today',
      'later',
    ]);
    expect(e.rules[0]).toMatchObject({ current_value: 3, target_value: 5, pct: 60 });
  });

  it('[RWD-16-c] Tuesday missed with 0 allowed loses the week when Tuesday closes; the next week starts afresh', () => {
    const facts = [
      ...week(LAST_WEEK, { '2026-10-06': (d) => missed(d, hw) }),
      ...week(['2026-10-12', '2026-10-13']),
      ...['2026-10-14', '2026-10-15', '2026-10-16'].map((d) => open(d, hw)),
    ];
    // On Tuesday itself the miss isn't settled: the week is still open.
    const onTuesday = evaluate(
      [homework()],
      [done('2026-10-05', hw), open('2026-10-06', hw)],
      {},
      { asOf: '2026-10-06' },
    );
    expect(onTuesday.periods[0]!.outcome).toBe('open');
    // From Wednesday it is lost at once, with no part count and no restart mid-week.
    const onWednesday = evaluate(
      [homework()],
      [done('2026-10-05', hw), missed('2026-10-06', hw), done('2026-10-07', hw)],
      {},
      { asOf: '2026-10-07' },
    );
    expect(onWednesday.periods[0]).toMatchObject({
      outcome: 'missed',
      next_start: '2026-10-12',
    });
    const [lastWeek, thisWeek] = evaluate([homework()], facts, {}, { asOf: '2026-10-13' }).periods;
    expect(lastWeek).toMatchObject({ outcome: 'missed', days_missed: 1 });
    expect(thisWeek).toMatchObject({ outcome: 'open', days_done: 2, days_missed: 0 });
  });

  it('[RWD-16-d] with 1 miss allowed one miss is forgiven, and two lose the week', () => {
    const one = evaluate(
      [homework({ params: { misses_allowed: 1 } })],
      week(LAST_WEEK, { '2026-10-07': (d) => missed(d, hw) }),
    ).periods[0]!;
    expect(one).toMatchObject({ outcome: 'won', days_done: 4, misses_allowed: 1 });
    expect(one.rules[0]).toMatchObject({ target_value: 4 });
    const two = evaluate(
      [homework({ params: { misses_allowed: 1 } })],
      week(LAST_WEEK, {
        '2026-10-07': (d) => missed(d, hw),
        '2026-10-08': (d) => missed(d, hw),
      }),
    ).periods[0]!;
    expect(two).toMatchObject({ outcome: 'missed', days_missed: 2 });
  });

  it('[RWD-16-e] a break week, with nothing due, is neither won nor missed', () => {
    const e = evaluate([homework()], week(['2026-10-12']), {}, { asOf: '2026-10-12' });
    expect(e.periods[0]).toMatchObject({ outcome: 'neutral', days_due: 0 });
    expect(e.periods[0]!.rules[0]).toMatchObject({ target_value: 0, is_met: false });
  });

  it('[RWD-16-f] a day a parent skipped is neutral: not due, not missed', () => {
    const p = evaluate([homework()], week(LAST_WEEK, { '2026-10-08': (d) => skipped(d, hw) }))
      .periods[0]!;
    expect(p).toMatchObject({ outcome: 'won', days_due: 4, days_missed: 0 });
    expect(p.days![3]!.mark).toBe('none');
  });

  it('[RWD-16-g] today is never a miss, whatever is still to do', () => {
    const e = evaluate(
      [homework()],
      [...week(['2026-10-12', '2026-10-13', '2026-10-14']), open(TODAY, hw)],
    );
    expect(e.periods.at(-1)).toMatchObject({ outcome: 'open', days_missed: 0 });
    // Waiting for a parent on a past day is open too, never a miss.
    const waiting = evaluate(
      [homework()],
      [pending('2026-10-12', hw), ...week(['2026-10-13', '2026-10-14'])],
    ).periods.at(-1)!;
    expect(waiting).toMatchObject({ outcome: 'open', days_missed: 0 });
    expect(waiting.days![0]!.mark).toBe('open');
  });

  it('[RWD-16-h] a parent’s late tick after the week closed turns it from missed to won, and an uncheck back', () => {
    const missedTuesday = week(LAST_WEEK, { '2026-10-06': (d) => missed(d, hw) });
    expect(evaluate([homework()], missedTuesday).periods[0]!.outcome).toBe('missed');
    // Ticked late on Wednesday of the next week: the week is worked out again from the facts.
    expect(evaluate([homework()], week(LAST_WEEK)).periods[0]!.outcome).toBe('won');
    // Unchecked again: back to missed.
    expect(evaluate([homework()], missedTuesday).periods[0]!.outcome).toBe('missed');
  });

  it('[RWD-16-i] every day it’s due needs a repeating goal, and 0 to 3 misses allowed', () => {
    expect(() => evaluate([homework()], [], { repeat: 'none' })).toThrow(/repeats/);
    expect(() => evaluate([homework()], [], { repeat: undefined })).toThrow(/repeats/);
    expect(daysDueParams({})).toEqual({ misses_allowed: 0 });
    expect(daysDueParams({ misses_allowed: 3 })).toEqual({ misses_allowed: 3 });
    for (const bad of [4, -1, 1.5, '1']) {
      expect(() => daysDueParams({ misses_allowed: bad })).toThrow(RangeError);
    }
  });

  it('[RWD-16] with any one rule, a lost DAYS_DUE rule doesn’t lose the week while another can still be met', () => {
    const facts = week(LAST_WEEK.slice(0, 3), { '2026-10-06': (d) => missed(d, hw) });
    const both = [homework(), { ...homework(), id: 'r-count', type: 'COUNT' as const, target: 2 }];
    expect(
      evaluate(both, facts, { rule_logic: 'any' }, { asOf: '2026-10-08' }).periods[0]!.outcome,
    ).toBe('won');
    expect(
      evaluate(both, facts, { rule_logic: 'all' }, { asOf: '2026-10-08' }).periods[0]!.outcome,
    ).toBe('missed');
  });
});

describe('periods', () => {
  it('[RWD-15-a] a part first week counts only the days due inside it', () => {
    // Starts Wednesday, Oct 7: Monday and Tuesday's homework (not done) is before the goal.
    const p = evaluate(
      [homework()],
      [
        missed('2026-10-05', hw),
        missed('2026-10-06', hw),
        ...week(['2026-10-07', '2026-10-08', '2026-10-09']),
      ],
      { start_date: '2026-10-07' },
    ).periods[0]!;
    expect(p).toMatchObject({
      start: '2026-10-07',
      end: '2026-10-11',
      outcome: 'won',
      days_due: 3,
    });
    expect(p.days).toHaveLength(5);
  });

  it('[RWD-15-a] a part last week ends with the goal, and nothing follows it', () => {
    const e = evaluate([homework()], week(LAST_WEEK), { end_date: '2026-10-07' });
    expect(e.periods).toHaveLength(1);
    expect(e.periods[0]).toMatchObject({
      end: '2026-10-07',
      days_due: 3,
      outcome: 'won',
      next_start: null,
    });
    expect(e.transitions.map((t) => t.type)).toEqual(['expired']);
  });

  it('[RWD-15-b] each calendar month is its own period', () => {
    const e = evaluate(
      [{ ...homework(), type: 'COUNT', target: 2, params: {} }],
      [done('2026-09-29', hw), done('2026-09-30', hw), done('2026-10-01', hw)],
      { start_date: '2026-09-15', repeat: 'month' },
    );
    expect(e.periods.map((p) => [p.start, p.end, p.outcome])).toEqual([
      ['2026-09-15', '2026-09-30', 'won'],
      ['2026-10-01', '2026-10-31', 'open'],
    ]);
    expect(e.periods[0]!.days).toBeNull();
    expect(e.periods[1]).toMatchObject({ next_start: '2026-11-01' });
    expect(e.rules[0]).toMatchObject({ current_value: 1, target_value: 2 });
  });

  it('[RWD-15-c] each school term is a period, and days between terms belong to none', () => {
    const terms = [
      { start_date: '2026-10-19', end_date: '2026-12-18' },
      { start_date: '2026-08-19', end_date: '2026-10-09' },
    ];
    const e = evaluate(
      [homework()],
      // Oct 12 to 16 is between terms: its homework counts for no period.
      [...week(['2026-10-08', '2026-10-09']), missed('2026-10-12', hw)],
      { start_date: '2026-10-01', repeat: 'term' },
      { terms },
    );
    expect(e.periods.map((p) => [p.start, p.end, p.outcome, p.next_start])).toEqual([
      ['2026-10-01', '2026-10-09', 'won', '2026-10-19'],
    ]);
    // Between terms, the goal shows the last term.
    expect(e.is_achieved).toBe(true);
    // No terms: no periods, and nothing counts.
    expect(evaluate([homework()], [], { repeat: 'term' }).periods).toEqual([]);
    expect(nextSpanStart('term', { from: '2026-10-19', to: '2026-12-18' }, terms)).toBeNull();
    expect(() =>
      spansBetween('term', '2026-01-01', '2026-12-31', MON, [
        { start_date: '2026-05-01', end_date: '2026-04-01' },
      ]),
    ).toThrow(RangeError);
  });

  it('[RWD-15-d] every rule is worked out inside each period: 3 things done each week', () => {
    const count: Rule = {
      id: 'r-count',
      type: 'COUNT',
      target: 3,
      scope: { all: true },
      params: {},
    };
    const e = evaluate(
      [count],
      [done('2026-10-05'), done('2026-10-06'), done('2026-10-07'), done('2026-10-12')],
    );
    expect(e.periods.map((p) => [p.start, p.outcome])).toEqual([
      ['2026-10-05', 'won'],
      ['2026-10-12', 'open'],
    ]);
    expect(e.rules[0]).toMatchObject({ current_value: 1, target_value: 3 });
    expect(e.periods[0]).toMatchObject({ days_due: null, days: null, misses_allowed: null });
  });

  it('[RWD-15-d] a week closed unmet is missed, and one with nothing in scope due is neutral', () => {
    const count: Rule = {
      id: 'r-count',
      type: 'COUNT',
      target: 3,
      scope: { all: true },
      params: {},
    };
    const e = evaluate([count], [done('2026-10-05'), skipped('2026-10-13')], {
      start_date: '2026-09-28',
    });
    expect(e.periods.map((p) => p.outcome)).toEqual(['neutral', 'missed', 'open']);
  });

  it('[RWD-15] a goal not started yet has no periods and nothing done', () => {
    const e = evaluate([homework()], [], { start_date: '2026-10-19', status: 'scheduled' });
    expect(e).toMatchObject({ periods: [], pct: 0, is_achieved: false, transitions: [] });
    expect(e.rules[0]).toMatchObject({ current_value: 0, target_value: 0 });
    const streak: Rule = { id: 'r-s', type: 'STREAK', target: 3, scope: { all: true }, params: {} };
    expect(
      evaluate([streak], [], { start_date: '2026-10-19', status: 'scheduled' }).rules[0],
    ).toMatchObject({ current_streak: 0, best_streak: 0, target_value: 3 });
  });

  it('[RWD-15] a started goal starts; an unknown repeat is refused', () => {
    expect(
      evaluate([homework()], [], { status: 'scheduled' }).transitions.map((t) => t.type),
    ).toEqual(['started']);
    expect(() => evaluate([homework()], [], { repeat: 'year' as Repeat })).toThrow(/repeat/);
  });

  it('[RWD-15] weeks follow the family’s week start, and months their own lengths', () => {
    expect(spansBetween('week', '2026-10-15', '2026-10-15', 0)).toEqual([
      { from: '2026-10-11', to: '2026-10-17' },
    ]);
    expect(spansBetween('month', '2028-02-10', '2028-03-01', 0)).toEqual([
      { from: '2028-02-01', to: '2028-02-29' },
      { from: '2028-03-01', to: '2028-03-31' },
    ]);
    expect(spansBetween('week', '2026-10-15', '2026-10-14', 0)).toEqual([]);
  });
});
