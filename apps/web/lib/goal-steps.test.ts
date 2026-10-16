import { describe, expect, it } from 'vitest';
import {
  boardSteps,
  clockWords,
  goalSteps,
  lateLine,
  onTimeWords,
  stepChips,
  stepKind,
  stepNudge,
  stepsPayWords,
  stepWonWords,
} from './goal-steps';
import {
  describeRule,
  evaluateRead,
  eventWords,
  type GoalFormValue,
  goalPayload,
  goalRefusal,
  type GoalRead,
  parseGoalForm,
  payoutWords,
} from './goals';

// A goal done by a time, and goals that pay in steps (WP-81, D-102): the form, and the words.
const GOAL = '0de00000-0000-4000-8000-000000081001';
const MAYA = '0de00000-0000-4000-8000-0000000000a1';
const HOMEWORK = '0de00000-0000-4000-8000-0000000c0003';
const ctx = { icons: ['trophy'], memberIds: [MAYA] };

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const base: [string, string][] = [
  ['id', GOAL],
  ['title', 'Homework before 6 pm'],
  ['member', MAYA],
  ['startDate', '2026-10-12'],
  ['icon', 'trophy'],
];
const homework: [string, string][] = [
  ['repeat', 'week'],
  ['rule-keys', 'a'],
  ['rule-a-type', 'DAYS_DUE'],
  ['rule-a-scope', 'items'],
  ['rule-a-item', HOMEWORK],
];
const points20: [string, string][] = [
  ['payout', 'points'],
  ['payoutPoints', '20'],
];
const parse = (extra: [string, string][]) => parseGoalForm(form([...base, ...extra]), ctx);
const value = (extra: [string, string][]) => (parse(extra) as { value: GoalFormValue }).value;

describe('[US-412] the form: done by a time', () => {
  it('[RWD-17-g] reads by a time, by each chore’s due time, or any time; nothing else', () => {
    expect(
      value([...homework, ['rule-a-ontime', 'by'], ['rule-a-ontime-at', '18:00']]).rules[0]!.params,
    ).toEqual({ on_time: '18:00', misses_allowed: 0 });
    expect(value([...homework, ['rule-a-ontime', 'due_time']]).rules[0]!.params.on_time).toBe(
      'due_time',
    );
    expect(value([...homework, ['rule-a-ontime', 'any']]).rules[0]!.params.on_time).toBeUndefined();
    expect(value(homework).rules[0]!.params.on_time).toBeUndefined();
    for (const bad of ['', '6 pm', '25:00']) {
      expect(parse([...homework, ['rule-a-ontime', 'by'], ['rule-a-ontime-at', bad]])).toEqual({
        ok: false,
        message: 'Rule: choose the time it counts by.',
      });
    }
    expect(goalRefusal({ hint: 'rule_on_time' })).toMatch(/due time, or by a time of day/);
  });

  it('[RWD-17-g] says a rule’s time in its line', () => {
    const names = {
      tags: new Map<string, string>(),
      items: new Map([[HOMEWORK, 'Homework home']]),
    };
    const rule = {
      type: 'DAYS_DUE' as const,
      target: 1,
      scope: { chore_ids: [HOMEWORK] },
      params: { misses_allowed: 0, on_time: '18:00' },
    };
    expect(describeRule(rule, names)).toBe(
      'Every day it’s due, from Homework home (no misses allowed), by 6:00 pm',
    );
    expect(onTimeWords('due_time')).toBe('by each chore’s due time');
    expect(onTimeWords(null)).toBeNull();
    expect(clockWords('07:05')).toBe('7:05 am');
    expect(clockWords('12:00')).toBe('12:00 pm');
    expect(clockWords('00:30')).toBe('12:30 am');
  });
});

describe('[US-413] the form: steps and weights', () => {
  it('[RWD-18-j] reads steps by days missed, and the lowest sets the misses allowed', () => {
    const v = value([
      ...homework,
      ...points20,
      ['payoutSteps', 'on'],
      ['step-1-at', '1'],
      ['step-1-amount', '10'],
      ['step-2-at', '2'],
      ['step-2-amount', '5'],
      ['step-3-at', '3'],
      ['step-3-amount', ''],
    ]);
    expect(v.payout).toEqual({
      type: 'points',
      amount: 20,
      steps: [
        { misses: 1, amount: 10 },
        { misses: 2, amount: 5 },
      ],
    });
    expect(v.rules[0]!.params.misses_allowed).toBe(2);
    expect(goalPayload(v, 'h1')).toMatchObject({ payout: v.payout });
    // Unticked, no steps.
    expect(
      value([...homework, ...points20, ['step-1-at', '1'], ['step-1-amount', '10']]).payout,
    ).toEqual({ type: 'points', amount: 20 });
  });

  it('[RWD-18-j] reads steps by number on a one-off goal with an end date', () => {
    const count: [string, string][] = [
      ['endDate', '2026-12-20'],
      ['rule-keys', 'a'],
      ['rule-a-type', 'COUNT'],
      ['rule-a-target', '20'],
    ];
    expect(
      value([
        ...count,
        ...points20,
        ['payoutSteps', 'on'],
        ['step-1-at', '15'],
        ['step-1-amount', '10'],
        ['step-2-at', '10'],
        ['step-2-amount', '5'],
      ]).payout,
    ).toEqual({
      type: 'points',
      amount: 20,
      steps: [
        { at: 15, amount: 10 },
        { at: 10, amount: 5 },
      ],
    });
  });

  it('[RWD-18-j] reads each rule’s weight on a goal with two rules in steps; reached at 100%', () => {
    const two: [string, string][] = [
      ['repeat', 'week'],
      ['logic', 'any'],
      ['rule-keys', 'a,b'],
      ['rule-a-type', 'DAYS_DUE'],
      ['rule-a-weight', '60'],
      ['rule-b-type', 'COUNT'],
      ['rule-b-target', '5'],
      ['rule-b-weight', '40'],
      ...points20,
      ['payoutSteps', 'on'],
      ['step-1-at', '75%'],
      ['step-1-amount', '10'],
    ];
    const v = value(two);
    expect(v.rules.map((r) => r.weight)).toEqual([60, 40]);
    expect(v.logic).toBe('all');
    expect(v.payout).toEqual({ type: 'points', amount: 20, steps: [{ at: 75, amount: 10 }] });
    // Without steps, the weights aren't kept and all or any stays.
    const plain = value(two.filter(([k]) => k !== 'payoutSteps'));
    expect(plain.rules.map((r) => r.weight)).toEqual([undefined, undefined]);
    expect(plain.logic).toBe('any');
  });

  it('[RWD-18-h] says what to fix in the steps and weights', () => {
    const steps = (rows: [string, string][]) =>
      parse([...homework, ...points20, ['payoutSteps', 'on'], ...rows]);
    expect(
      steps([
        ['step-1-at', '1'],
        ['step-1-amount', '20'],
      ]),
    ).toMatchObject({
      ok: false,
      message: 'Step 2 pays fewer points than the step above it, 1 or more.',
    });
    expect(
      steps([
        ['step-1-at', '2'],
        ['step-1-amount', '10'],
        ['step-2-at', '1'],
        ['step-2-amount', '5'],
      ]),
    ).toMatchObject({
      ok: false,
      message: 'Step 3: more days missed than the step above, up to 3.',
    });
    expect(steps([])).toMatchObject({
      ok: false,
      message: 'Add at least one lower step, or untick Pay in steps.',
    });
    const once = parse([
      ['rule-keys', 'a'],
      ['rule-a-type', 'COUNT'],
      ['rule-a-target', '20'],
      ...points20,
      ['payoutSteps', 'on'],
      ['step-1-at', '15'],
      ['step-1-amount', '10'],
    ]);
    expect(once).toMatchObject({ ok: false, message: /needs an end date/ });
    expect(
      parse([
        ['endDate', '2026-12-20'],
        ['rule-keys', 'a'],
        ['rule-a-type', 'COUNT'],
        ['rule-a-target', '20'],
        ...points20,
        ['payoutSteps', 'on'],
        ['step-1-at', '20'],
        ['step-1-amount', '10'],
      ]),
    ).toMatchObject({ ok: false, message: 'Step 2 is reached at less than the step above.' });
    expect(
      parse([
        ['repeat', 'week'],
        ['rule-keys', 'a,b'],
        ['rule-a-type', 'COUNT'],
        ['rule-a-target', '5'],
        ['rule-a-weight', '50'],
        ['rule-b-type', 'COUNT'],
        ['rule-b-target', '5'],
        ['rule-b-weight', '40'],
        ...points20,
        ['payoutSteps', 'on'],
        ['step-1-at', '50'],
        ['step-1-amount', '10'],
      ]),
    ).toEqual({
      ok: false,
      message: 'Give each rule a weight; together they make 100% (now 90%).',
    });
    for (const hint of [
      'payout_steps',
      'payout_steps_points',
      'steps_end_date',
      'rule_weights',
      'rule_weight',
    ]) {
      expect(goalRefusal({ hint })).not.toMatch(/didn’t save/);
    }
  });

  it('[RWD-18-j] gives the engine the goal’s steps from its payout', () => {
    const read: GoalRead = {
      read_at: '2026-10-15T12:00:00Z',
      as_of: '2026-10-15',
      week_start: 1,
      rules_version: 1,
      goal: {
        id: GOAL,
        member_id: MAYA,
        start_date: '2026-10-05',
        end_date: null,
        rule_logic: 'all',
        status: 'active',
        repeat: 'week',
        payout: { type: 'points', amount: 20, steps: [{ misses: 1, amount: 10 }] },
      },
      rules: [
        {
          id: 'r1',
          type: 'DAYS_DUE',
          target: 1,
          scope: { all: true },
          params: { misses_allowed: 1 },
        },
      ],
      facts: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d, i) => ({
        id: `o${i}`,
        chore_id: HOMEWORK,
        member_id: MAYA,
        kind: 'chore',
        tag_ids: [],
        due_date: d,
        credit_date: d,
        status: 'completed',
        credited: true,
        points: 2,
        done_at: `${d}T${i === 0 ? '18:05' : '17:00'}`,
      })),
    };
    read.rules[0]!.params.on_time = '18:00';
    const [p] = evaluateRead(read).periods;
    expect(p!.step).toMatchObject({ reached: 1, final: true, amount: 10 });
    expect(goalSteps(read.goal.payout, read.rules)).toEqual([
      { misses: 0, amount: 20 },
      { misses: 1, amount: 10 },
    ]);
    expect(goalSteps({ type: 'points', amount: 20 }, read.rules)).toEqual([]);
  });
});

describe('[US-413] the steps in words', () => {
  const byMisses = [
    { misses: 0, amount: 20 },
    { misses: 1, amount: 10 },
    { misses: 2, amount: 5 },
  ];
  it('[RWD-18-k] the steps as chips: days missed, a number, the goal’s %', () => {
    expect(stepChips(byMisses, 'misses', 5)).toEqual(['All 5: 20', '4: 10', '3: 5']);
    expect(stepChips(byMisses, 'misses', 4)).toEqual(['All 4: 20', '3: 10', '2: 5']);
    expect(stepChips(byMisses, 'misses')).toEqual(['All days: 20', '1 missed: 10', '2 missed: 5']);
    expect(
      stepChips(
        [
          { at: 20, amount: 20 },
          { at: 15, amount: 10 },
        ],
        'number',
      ),
    ).toEqual(['20: 20', '15: 10']);
    expect(
      stepChips(
        [
          { at: 100, amount: 20 },
          { at: 75, amount: 10 },
        ],
        'weighted',
      ),
    ).toEqual(['100%: 20', '75%: 10']);
    expect(stepKind([{ type: 'DAYS_DUE' }])).toBe('misses');
    expect(stepKind([{ type: 'COUNT' }])).toBe('number');
    expect(stepKind([{ type: 'COUNT' }, { type: 'DAYS_DUE' }])).toBe('weighted');
  });

  it('[RWD-18-k] what a week makes, what it was won at, and a tick after the time', () => {
    expect(stepNudge(byMisses, { reached: null, best: 1 })).toBe('On course for 10 points.');
    expect(stepNudge(byMisses, { reached: 1, best: 1 })).toBe('10 points so far.');
    expect(stepNudge(byMisses, { reached: null, best: null })).toBeNull();
    expect(stepWonWords(byMisses, 'misses', 1)).toBe('Won at 1 missed: 10 points');
    expect(stepWonWords(byMisses, 'misses', 0)).toBe('Won, all of it: 20 points');
    expect(stepsPayWords(byMisses)).toBe('20, 10 or 5 points');
    const days = [
      { date: '2026-10-12', mark: 'done' },
      { date: '2026-10-14', mark: 'late' },
    ];
    expect(lateLine(days, '18:00')).toBe('Wednesday was after 6:00 pm.');
    expect(lateLine(days, 'due_time')).toBe('Wednesday was after its due time.');
    expect(lateLine(days, null)).toBeNull();
    expect(lateLine([{ date: '2026-10-12', mark: 'missed' }], '18:00')).toBeNull();
  });

  it('[RWD-18-k] the payout, a step changed, and a board goal’s steps', () => {
    expect(
      payoutWords(
        {
          type: 'points',
          amount: 20,
          steps: [
            { misses: 1, amount: 10 },
            { misses: 2, amount: 5 },
          ],
        },
        true,
        () => undefined,
      ),
    ).toBe('20, 10 or 5 points each');
    expect(
      eventWords({
        type: 'step_changed',
        payload: {
          n: 1,
          from: 1,
          to: 0,
          points: 10,
          amount: 20,
          period_start: '2026-10-05',
          period_end: '2026-10-11',
        },
      }),
    ).toBe('Oct 5 to 11 now pays 20 points: 10 points more paid');
    expect(eventWords({ type: 'step_changed', payload: { points: -10, amount: 10 } })).toBe(
      'Its step now pays 10 points: 10 points taken back',
    );
    expect(
      boardSteps({
        pays: 20,
        steps: [{ misses: 1, amount: 10 }],
        rules: [{ type: 'DAYS_DUE', target: 1 }],
      }),
    ).toEqual({
      steps: [
        { misses: 0, amount: 20 },
        { misses: 1, amount: 10 },
      ],
      kind: 'misses',
    });
    expect(boardSteps({ pays: null, rules: [{ type: 'COUNT', target: 3 }] }).steps).toEqual([]);
  });
});
