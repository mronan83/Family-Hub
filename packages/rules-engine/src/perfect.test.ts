import { describe, expect, it } from 'vitest';
import { done, missed, open, skipped, taskDone } from './fixtures';
import { evaluateGoal, periodsWonParams } from './goal';
import type { GoalInput, OccurrenceFact, PeriodOutcome, Rule, SourcePeriod } from './types';

// Perfect periods and a family goal every child meets (WP-82, D-103, D-126). Thursday, Oct 15, 2026
// is today; the family's week starts Monday. Sep 14, 21, 28, Oct 5 and 12 are Mondays.
const TODAY = '2026-10-15';
const MON = 1;
const MONDAYS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
const plus = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The homework goal's weeks, from Sep 14, with these outcomes in turn. */
const weeks = (...outcomes: PeriodOutcome[]): SourcePeriod[] =>
  outcomes.map((outcome, i) => ({
    start: MONDAYS[i]!,
    end: plus(MONDAYS[i]!, 6),
    outcome,
  }));

const counted = (target: number, in_a_row: boolean): Rule => ({
  id: 'r-weeks',
  type: 'PERIODS_WON',
  target,
  scope: { all: true },
  params: { goal_id: 'homework-goal', in_a_row },
});

function count(
  rule: Rule,
  periods: SourcePeriod[],
  goal: Partial<GoalInput['goal']> = {},
  asOf = TODAY,
) {
  return evaluateGoal({
    goal: {
      id: 'g-perfect',
      member_id: 'maya',
      start_date: '2026-09-14',
      end_date: null,
      rule_logic: 'all',
      status: 'active',
      ...goal,
    },
    rules: [rule],
    occurrences: [],
    sources: { 'homework-goal': periods },
    asOf,
    weekStart: MON,
  });
}

describe('[US-414] perfect weeks, in total or in a row', () => {
  it('[RWD-19-a] in total: won weeks count, a missed or break week doesn’t; reached at the target', () => {
    const four = counted(4, false);
    const going = count(four, weeks('won', 'missed', 'neutral', 'won', 'won'));
    expect(going.rules[0]).toMatchObject({ current_value: 3, target_value: 4, is_met: false });
    expect(going.pct).toBe(75);
    expect(going.is_achieved).toBe(false);

    const three = count(counted(3, false), weeks('won', 'missed', 'neutral', 'won', 'won'));
    expect(three.rules[0]).toMatchObject({ current_value: 3, is_met: true, pct: 100 });
    expect(three.is_achieved).toBe(true);
    expect(three.transitions.map((t) => t.type)).toEqual(['achieved']);
  });

  it('[RWD-19-b] in a row: a break week neither counts nor breaks the run, a missed week starts it again, a week going doesn’t break it', () => {
    const rule = counted(3, true);
    const pastBreak = count(rule, weeks('won', 'neutral', 'won'));
    expect(pastBreak.rules[0]).toMatchObject({
      current_value: 2,
      current_streak: 2,
      is_met: false,
    });

    const broken = count(rule, weeks('won', 'won', 'missed', 'won'));
    expect(broken.rules[0]).toMatchObject({
      current_value: 1,
      current_streak: 1,
      best_streak: 2,
      is_met: false,
    });

    const going = count(rule, weeks('missed', 'won', 'won', 'open'));
    expect(going.rules[0]).toMatchObject({ current_value: 2, current_streak: 2, is_met: false });
  });

  it('[RWD-19-c] in a row stays reached once a run reaches the target, while those weeks stay won', () => {
    const ev = count(counted(3, true), weeks('won', 'won', 'won', 'missed', 'open'));
    expect(ev.rules[0]).toMatchObject({
      current_value: 3,
      current_streak: 0,
      best_streak: 3,
      is_met: true,
    });
    expect(ev.is_achieved).toBe(true);
  });

  it('[RWD-19-d] only weeks that start on or after the goal’s start date count; a repeating counted goal counts each period’s', () => {
    // Set up on Thursday, Oct 8: the week of Oct 5 had begun, so it doesn't count.
    const ev = count(counted(2, false), weeks('won', 'won', 'won', 'won', 'open'), {
      start_date: '2026-10-08',
    });
    expect(ev.rules[0]).toMatchObject({ current_value: 0, is_met: false });

    // Counting each month: September's weeks for September, October's for October.
    const monthly = count(counted(2, false), weeks('won', 'won', 'missed', 'won', 'open'), {
      start_date: '2026-09-01',
      repeat: 'month',
    });
    expect(monthly.periods.map((p) => [p.start, p.outcome, p.rules[0]!.current_value])).toEqual([
      ['2026-09-01', 'won', 2],
      ['2026-10-01', 'open', 1],
    ]);
  });

  it('[RWD-19-e] a won week undone by a parent’s fix takes the counted goal back below its target', () => {
    const before = count(counted(2, true), weeks('won', 'won'), {}, '2026-09-28');
    expect(before.is_achieved).toBe(true);
    const after = count(
      counted(2, true),
      weeks('won', 'missed'),
      { status: 'achieved' },
      '2026-09-28',
    );
    expect(after.is_achieved).toBe(false);
    expect(after.transitions.map((t) => t.type)).toEqual(['unachieved']);
  });

  it('[RWD-19-f] a counted rule names its goal, in total or in a row', () => {
    expect(periodsWonParams({ goal_id: 'g', in_a_row: true })).toEqual({
      goal_id: 'g',
      in_a_row: true,
    });
    expect(periodsWonParams({ goal_id: 'g' })).toEqual({ goal_id: 'g', in_a_row: false });
    expect(() => periodsWonParams({ in_a_row: true })).toThrow(/names the goal/);
    expect(() => periodsWonParams({ goal_id: 'g', in_a_row: 'yes' })).toThrow(/true or false/);
    // A goal with no weeks yet has nothing counted.
    expect(count(counted(3, true), []).rules[0]).toMatchObject({ current_value: 0, is_met: false });
  });
});

// Every child meets it: Maya and Leo, homework every school day of the week.
const homework = (o: Partial<Rule> = {}): Rule => ({
  id: 'r-days',
  type: 'DAYS_DUE',
  target: 1,
  scope: { chore_ids: ['homework'] },
  params: { misses_allowed: 0 },
  ...o,
});
const hw = (member_id: string) => ({ chore_id: 'homework', member_id });
const THIS_WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
const LAST_WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
/** A child's homework on each date: done unless the date is listed in `as`. */
const days = (who: string, dates: string[], as: Record<string, typeof done> = {}) =>
  dates.map((d) => (as[d] ?? done)(d, hw(who)));

function family(
  rules: Rule[],
  occurrences: OccurrenceFact[],
  goal: Partial<GoalInput['goal']> = {},
  members = ['maya', 'leo'],
) {
  return evaluateGoal({
    goal: {
      id: 'g-family',
      member_id: null,
      start_date: '2026-10-05',
      end_date: null,
      rule_logic: 'all',
      status: 'active',
      repeat: 'week',
      each_child: true,
      ...goal,
    },
    rules,
    occurrences,
    members,
    asOf: TODAY,
    weekStart: MON,
  });
}

describe('[US-415] a family goal every child meets', () => {
  it('[RWD-20-a] one child short loses the week at once, though the other made every day', () => {
    const ev = family(
      [homework()],
      [
        ...days('maya', THIS_WEEK, { '2026-10-15': open }),
        ...days('leo', THIS_WEEK, { '2026-10-13': missed, '2026-10-15': open }),
      ],
    );
    const now = ev.periods.at(-1)!;
    expect(now.outcome).toBe('missed');
    expect(now.next_start).toBe('2026-10-19');
    const [leo, maya] = now.children!;
    expect(maya).toMatchObject({ member_id: 'maya', contributes: true, outcome: 'open' });
    expect(leo).toMatchObject({
      member_id: 'leo',
      contributes: true,
      outcome: 'missed',
      days_missed: 1,
    });
    expect(leo!.days!.slice(0, 4).map((d) => d.mark)).toEqual(['done', 'missed', 'done', 'today']);
    expect(ev.is_achieved).toBe(false);
  });

  it('[RWD-20-b] every child meeting it wins the week; its progress is the child furthest behind', () => {
    const won = family([homework()], [...days('maya', LAST_WEEK), ...days('leo', LAST_WEEK)]);
    expect(won.periods[0]).toMatchObject({ start: '2026-10-05', outcome: 'won', pct: 100 });
    expect(won.periods[0]!.children!.map((c) => [c.member_id, c.outcome])).toEqual([
      ['leo', 'won'],
      ['maya', 'won'],
    ]);

    const going = family(
      [homework()],
      [
        ...days('maya', THIS_WEEK),
        ...days('leo', THIS_WEEK, { '2026-10-14': open, '2026-10-15': open }),
      ],
    );
    const now = going.periods.at(-1)!;
    expect(now.outcome).toBe('open');
    expect(now.pct).toBe(now.children!.find((c) => c.member_id === 'leo')!.pct);
    expect(going.pct).toBe(now.pct);
  });

  it('[RWD-20-c] a child with nothing due doesn’t hold it back; with nobody due the week is neither', () => {
    // Leo has no homework last week (a school trip): Maya alone decides it.
    const mayaAlone = family([homework()], days('maya', LAST_WEEK));
    expect(mayaAlone.periods[0]!.outcome).toBe('won');
    expect(mayaAlone.periods[0]!.children!.find((c) => c.member_id === 'leo')).toMatchObject({
      contributes: false,
      outcome: 'neutral',
    });
    // Leo's homework skipped every day: the same.
    const skippedLeo = family(
      [homework()],
      [...days('maya', LAST_WEEK), ...LAST_WEEK.map((d) => skipped(d, hw('leo')))],
    );
    expect(skippedLeo.periods[0]!.outcome).toBe('won');
    // A break: nobody has anything due, so the week is neither won nor missed.
    const brk = family([homework()], []);
    expect(brk.periods[0]!.outcome).toBe('neutral');
    // Nobody earns rewards: nothing is won.
    const nobody = family([homework()], days('maya', LAST_WEEK), {}, []);
    expect(nobody.periods[0]!.outcome).toBe('neutral');
  });

  it('[RWD-20-d] a family goal that doesn’t repeat is reached when each child with something due meets it', () => {
    const reading: Rule = {
      id: 'r-count',
      type: 'COUNT',
      target: 2,
      scope: { tag_ids: ['reading'] },
      params: {},
    };
    const read = (who: string, d: string) =>
      taskDone(d, d, { member_id: who, chore_id: `read-${who}-${d}`, tag_ids: ['reading'] });
    const goal = { repeat: 'none' as const, start_date: '2026-10-05', end_date: '2026-10-18' };
    const short = family(
      [reading],
      [read('maya', '2026-10-06'), read('maya', '2026-10-07'), read('leo', '2026-10-08')],
      goal,
    );
    expect(short.is_achieved).toBe(false);
    expect(short.children!.map((c) => [c.member_id, c.contributes, c.outcome])).toEqual([
      ['leo', true, 'open'],
      ['maya', true, 'won'],
    ]);
    expect(short.pct).toBe(50);

    const both = family(
      [reading],
      [
        read('maya', '2026-10-06'),
        read('maya', '2026-10-07'),
        read('leo', '2026-10-08'),
        read('leo', '2026-10-09'),
      ],
      goal,
    );
    expect(both.is_achieved).toBe(true);
    expect(both.transitions.map((t) => t.type)).toEqual(['achieved']);
    // Leo with nothing in scope at all: Maya alone reaches it.
    const alone = family([reading], [read('maya', '2026-10-06'), read('maya', '2026-10-07')], goal);
    expect(alone.is_achieved).toBe(true);
    expect(alone.children!.find((c) => c.member_id === 'leo')!.contributes).toBe(false);
  });

  it('[RWD-20-e] every child meets it is for a family goal, without steps or a counted rule', () => {
    expect(() => family([homework()], [], { member_id: 'maya' })).toThrow(/family goal/);
    expect(() =>
      family([homework()], [], {
        steps: [
          { misses: 0, amount: 20 },
          { misses: 1, amount: 10 },
        ],
      }),
    ).toThrow(/steps/);
    expect(() => family([counted(3, true)], [])).toThrow(/periods/);
  });
});
