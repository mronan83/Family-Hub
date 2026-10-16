import { describe, expect, it } from 'vitest';
import { celebrationLine } from './board-goals';
import {
  bestLine,
  childLine,
  countedLabel,
  countedLine,
  familyMissedLine,
  familyPaid,
  familyWeekDetail,
  familyWonLine,
  makesLine,
} from './goal-perfect';
import type { ChildPeriod, GoalPeriod } from './goal-periods';
import {
  describeRule,
  eventWords,
  type GoalFormValue,
  goalPayload,
  goalRefusal,
  parseGoalForm,
} from './goals';
import { readChildren } from './snapshot';

// Perfect periods, and a family goal every child meets (WP-82, D-103, D-126): the form, and the words
// on Goals and the board.
const GOAL = '0de00000-0000-4000-8000-000000082001';
const HOMEWORK_GOAL = '0de00000-0000-4000-8000-000000080001';
const MAYA = '0de00000-0000-4000-8000-0000000000a1';
const LEO = '0de00000-0000-4000-8000-0000000000b1';
const HOMEWORK = '0de00000-0000-4000-8000-0000000c0003';
const ctx = { icons: ['trophy'], memberIds: [MAYA, LEO] };

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const base = (member: string): [string, string][] => [
  ['id', GOAL],
  ['title', 'A goal'],
  ['member', member],
  ['startDate', '2026-10-15'],
  ['icon', 'trophy'],
  ['eachChildField', 'on'],
];
const counted = (row: 'row' | 'total', source = HOMEWORK_GOAL): [string, string][] => [
  ['rule-keys', 'a'],
  ['rule-a-type', 'PERIODS_WON'],
  ['rule-a-target', '3'],
  ['rule-a-source', source],
  ['rule-a-row', row],
];
const homework: [string, string][] = [
  ['repeat', 'week'],
  ['rule-keys', 'a'],
  ['rule-a-type', 'DAYS_DUE'],
  ['rule-a-scope', 'items'],
  ['rule-a-item', HOMEWORK],
];
const parse = (entries: [string, string][]) => parseGoalForm(form(entries), ctx);
const value = (entries: [string, string][]) => (parse(entries) as { value: GoalFormValue }).value;

describe('[US-414] the form: perfect weeks', () => {
  it('[RWD-19-h] reads the goal it counts, in a row or in total, and the target', () => {
    const row = value([...base(MAYA), ...counted('row')]);
    expect(row.rules).toEqual([
      {
        type: 'PERIODS_WON',
        target: 3,
        scope: { all: true },
        params: { goal_id: HOMEWORK_GOAL, in_a_row: true },
      },
    ]);
    expect(value([...base(MAYA), ...counted('total')]).rules[0]!.params.in_a_row).toBe(false);
    expect(parse([...base(MAYA), ...counted('row', 'nope')])).toEqual({
      ok: false,
      message: 'Rule: choose the repeating goal it counts.',
    });
    expect(
      parse([
        ...base(MAYA),
        ...counted('row').map(([k, v]): [string, string] => [k, k.endsWith('target') ? '0' : v]),
      ]),
    ).toMatchObject({ ok: false, message: 'Rule needs a target from 1 to 100,000.' });
    expect(goalPayload(row, 'h1').rules).toEqual(row.rules);
  });

  it('[RWD-19-f] names a refusal of the goal it counts', () => {
    expect(goalRefusal({ hint: 'rule_source' })).toMatch(/repeating goal for the same person/);
  });
});

describe('[US-415] the form: every child meets it', () => {
  it('[RWD-20-h] reads the option on a family goal, and sends it', () => {
    const on = value([...base('family'), ...homework, ['eachChild', 'on']]);
    expect(on.eachChild).toBe(true);
    expect(goalPayload(on, 'h1')).toMatchObject({ member_id: null, each_child: true });
    expect(value([...base('family'), ...homework]).eachChild).toBe(false);
    // On a child's goal it is never on.
    expect(value([...base(MAYA), ...homework, ['eachChild', 'on']]).eachChild).toBe(false);
    // A form loaded before the option sends nothing: the goal keeps its own.
    const old = value([...base('family').filter(([k]) => k !== 'eachChildField'), ...homework]);
    expect(old.eachChild).toBeUndefined();
    expect(goalPayload(old, 'h1')).not.toHaveProperty('each_child');
  });

  it('[RWD-20-e] refuses steps and a counted rule with it, and names the database’s refusals', () => {
    expect(
      parse([
        ...base('family'),
        ...homework,
        ['eachChild', 'on'],
        ['payout', 'points'],
        ['payoutPoints', '20'],
        ['payoutSteps', 'on'],
        ['step-1-at', '1'],
        ['step-1-amount', '10'],
      ]),
    ).toEqual({ ok: false, message: 'Pay in steps isn’t offered when every child meets it.' });
    expect(parse([...base('family'), ...counted('row'), ['eachChild', 'on']])).toEqual({
      ok: false,
      message: 'When every child meets it, the goal can’t count another goal’s weeks.',
    });
    for (const hint of ['each_child_family', 'each_child_steps', 'each_child_counted']) {
      expect(goalRefusal({ hint })).toMatch(/every child meets it/i);
    }
    expect(goalRefusal({ hint: 'each_child_fixed' })).toBe(
      'This goal has started, so every child meets it stays as it is.',
    );
  });
});

describe('[US-414] perfect weeks in words', () => {
  const inARow = {
    current: 1,
    target: 3,
    inARow: true,
    best: 1,
    met: false,
    repeat: 'week' as const,
  };
  const going = [
    { start: '2026-09-28', end: '2026-10-04', outcome: 'won' as const },
    { start: '2026-10-05', end: '2026-10-11', outcome: 'missed' as const },
    { start: '2026-10-12', end: '2026-10-18', outcome: 'open' as const },
  ];

  it('[RWD-19-i] "1 of 3 weeks in a row", best so far, what this week makes', () => {
    expect(countedLine(inARow)).toBe('1 of 3 weeks in a row');
    expect(countedLine({ ...inARow, inARow: false, current: 2, target: 4, best: null })).toBe(
      '2 of 4 weeks won',
    );
    expect(countedLine({ ...inARow, repeat: 'month', target: 1, current: 0 })).toBe(
      '0 of 1 month in a row',
    );
    expect(countedLabel(inARow, '20 points')).toBe('Weeks in a row · 20 points');
    expect(countedLabel({ inARow: false, repeat: 'term' }, null)).toBe('Terms won');
    expect(bestLine(inARow)).toBe('best so far 1');
    expect(bestLine({ ...inARow, inARow: false, best: null })).toBeNull();
    expect(makesLine(inARow, going, 'board')).toBe('This week makes 2 in a row.');
    expect(makesLine(inARow, going, 'admin')).toBe('This week makes 2 in a row if it’s won');
    expect(makesLine({ ...inARow, inARow: false }, going, 'board')).toBe('This week makes 2.');
    // Reached, or nothing going: nothing to say.
    expect(makesLine({ ...inARow, met: true }, going, 'board')).toBeNull();
    expect(makesLine(inARow, going.slice(0, 2), 'board')).toBeNull();
  });

  it('[RWD-19-i] the rule on Goals names the goal it counts', () => {
    const names = {
      tags: new Map(),
      items: new Map(),
      goals: new Map([[HOMEWORK_GOAL, { title: 'Homework home', repeat: 'week' as const }]]),
    };
    const rule = (in_a_row: boolean) => ({
      type: 'PERIODS_WON' as const,
      target: 3,
      scope: { all: true as const },
      params: { goal_id: HOMEWORK_GOAL, in_a_row },
    });
    expect(describeRule(rule(true), names)).toBe('3 weeks won in a row, of Homework home');
    expect(describeRule(rule(false), names)).toBe('3 weeks won, of Homework home');
    expect(describeRule(rule(false), { ...names, goals: new Map() })).toBe(
      '3 weeks won, of a removed goal',
    );
  });
});

describe('[US-415] every child meets it in words', () => {
  const day = (date: string, mark: 'done' | 'missed' | 'today' | 'none') => ({ date, mark });
  const kid = (memberId: string, o: Partial<ChildPeriod> = {}): ChildPeriod => ({
    memberId,
    contributes: true,
    outcome: 'open',
    pct: 75,
    daysDue: 4,
    daysDone: 3,
    daysMissed: 0,
    days: [
      day('2026-10-12', 'done'),
      day('2026-10-13', 'done'),
      day('2026-10-14', 'done'),
      day('2026-10-15', 'today'),
    ],
    ...o,
  });
  const leoMissed = kid(LEO, {
    outcome: 'missed',
    daysDone: 2,
    daysMissed: 1,
    days: [
      day('2026-10-12', 'done'),
      day('2026-10-13', 'missed'),
      day('2026-10-14', 'done'),
      day('2026-10-15', 'today'),
    ],
  });
  const period = (outcome: GoalPeriod['outcome'], children: ChildPeriod[]): GoalPeriod => ({
    start: '2026-10-12',
    end: '2026-10-18',
    outcome,
    nextStart: '2026-10-19',
    daysDue: null,
    daysDone: null,
    daysMissed: null,
    missesAllowed: 0,
    days: null,
    children,
  });
  const name = (id: string) => (id === MAYA ? 'Maya' : 'Leo');

  it('[RWD-20-i] each child’s line, who missed it and when it starts again', () => {
    const p = period('missed', [kid(MAYA), leoMissed]);
    expect(childLine(kid(MAYA), p, 'week')).toBe('3 of 4 days');
    expect(childLine(leoMissed, p, 'week')).toBe('Missed Tuesday');
    expect(childLine(kid(LEO, { contributes: false, outcome: 'neutral' }), p, 'week')).toBe(
      'Nothing due this week',
    );
    expect(childLine(kid(LEO, { daysDue: null, days: null, pct: 40 }), p, 'week')).toBe(
      '40% there',
    );
    expect(familyMissedLine(p, name)).toBe('Leo missed Tuesday. Starts again Monday, Oct 19.');
    expect(familyMissedLine(period('open', [kid(MAYA)]), name)).toBeNull();
  });

  it('[RWD-20-i] won: everyone, or only the children with something due, as they are paid (D-126)', () => {
    const both = period('won', [kid(MAYA, { outcome: 'won' }), kid(LEO, { outcome: 'won' })]);
    expect(familyWonLine(both, name, 20)).toBe('Everyone made it! 20 points each.');
    expect(familyPaid(both, 20)).toBe(40);
    const mayaAlone = period('won', [
      kid(MAYA, { outcome: 'won' }),
      kid(LEO, { contributes: false, outcome: 'neutral' }),
    ]);
    expect(familyWonLine(mayaAlone, name, 20)).toBe('Maya made it! 20 points.');
    expect(familyPaid(mayaAlone, 20)).toBe(20);
    expect(familyWonLine(mayaAlone, name, null)).toBe('Maya made it!');
    expect(familyPaid(period('missed', [kid(MAYA)]), 20)).toBe(0);
  });

  it('[RWD-20-i] a week’s row on the goal’s Weeks', () => {
    expect(familyWeekDetail(period('missed', [kid(MAYA), leoMissed]), name, 'week')).toBe(
      'Missed · Maya 3 of 4 days · Leo missed Tuesday',
    );
    expect(
      familyWeekDetail(
        period('won', [
          kid(MAYA, { outcome: 'won', daysDone: 4 }),
          kid(LEO, { contributes: false, outcome: 'neutral' }),
        ]),
        name,
        'week',
      ),
    ).toBe('Won · Maya 4 of 4 days · Leo had nothing due');
    expect(familyWeekDetail(period('neutral', []), name, 'week')).toBe('Nothing due for anyone');
  });

  it('[RWD-20-g] reads each child from the database, leaving out what it can’t read', () => {
    expect(
      readChildren([
        {
          member_id: MAYA,
          contributes: true,
          outcome: 'won',
          pct: 100,
          days_due: 4,
          days_done: 4,
          days_missed: 0,
          days: [
            { date: '2026-10-12', mark: 'done' },
            { date: 'x', mark: 'done' },
          ],
        },
        { member_id: LEO, outcome: 'sideways' },
      ]),
    ).toEqual([
      {
        memberId: MAYA,
        contributes: true,
        outcome: 'won',
        pct: 100,
        daysDue: 4,
        daysDone: 4,
        daysMissed: 0,
        days: [{ date: '2026-10-12', mark: 'done', dayType: null }],
      },
    ]);
    expect(readChildren(null)).toBeNull();
  });

  it('[RWD-20-f] What happened says when who is paid changed', () => {
    expect(
      eventWords({
        type: 'payees_changed',
        payload: { n: 2, points: 20, period_start: '2026-10-05', period_end: '2026-10-11' },
      }),
    ).toBe('Oct 5 to 11: who had something due changed, 20 points more paid');
    expect(
      celebrationLine(
        {
          id: 'g',
          memberId: null,
          title: 'Everyone’s homework home',
          icon: 'family',
          photo: null,
          status: 'active',
          n: 1,
          achievedAt: null,
          celebrate: true,
          endDate: null,
          logic: 'all',
          pct: 100,
          rules: [],
          repeat: 'week',
          period: null,
          history: [],
          eachChild: true,
        },
        name,
      ),
    ).toBe('The family won this week of Everyone’s homework home!');
  });
});
