import { describe, expect, it } from 'vitest';
import { done, missed, open, pending } from './fixtures';
import { checkSteps, evaluateGoal, isLate, onTimeParam } from './goal';
import type { GoalInput, OccurrenceFact, Rule, Step } from './types';

// A goal done by a time, and goals that pay in steps (WP-81, D-102). Thursday, Oct 15, 2026 is
// today; the family's week starts Monday. Oct 5 to 11 is last week (closed); Oct 12 to 18 this one.
const TODAY = '2026-10-15';
const MON = 1;
const LAST_WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const hw = { chore_id: 'homework' };

/** Homework done on `date`, ticked at `time` (household clock). */
const at = (date: string, time: string, x: Partial<OccurrenceFact> = {}) =>
  done(date, { ...hw, done_at: `${date}T${time}`, ...x });

const daysRule = (o: Partial<Rule> = {}): Rule => ({
  id: 'r-days',
  type: 'DAYS_DUE',
  target: 1,
  scope: { chore_ids: ['homework'] },
  params: { misses_allowed: 0 },
  ...o,
});
const countRule = (o: Partial<Rule> = {}): Rule => ({
  id: 'r-count',
  type: 'COUNT',
  target: 20,
  scope: { chore_ids: ['homework'] },
  params: {},
  ...o,
});

/** All days 20, 1 missed 10, 2 missed 5 (the owner's case). */
const BY_MISSES: Step[] = [
  { misses: 0, amount: 20 },
  { misses: 1, amount: 10 },
  { misses: 2, amount: 5 },
];

function evaluate(
  rules: Rule[],
  occurrences: OccurrenceFact[],
  goal: Partial<GoalInput['goal']> = {},
  asOf = TODAY,
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
  });
}

const by6 = (o: Partial<Rule> = {}) =>
  daysRule({ params: { misses_allowed: 0, on_time: '18:00' }, ...o });

describe('[US-412] done by a time', () => {
  it('[RWD-17-a] by a time on the rule: a minute after doesn’t count; at the time and a minute before do', () => {
    const f = (t: string) => at('2026-10-05', t);
    expect(isLate(f('17:59'), '18:00')).toBe(false);
    expect(isLate(f('18:00'), '18:00')).toBe(false);
    expect(isLate(f('18:01'), '18:00')).toBe(true);
    // Last week: Monday at 6:01 pm, the rest on time, nothing missed allowed: lost.
    const facts = LAST_WEEK.map((d, i) => at(d, i === 0 ? '18:01' : '17:59'));
    const [p] = evaluate([by6()], facts).periods;
    expect(p).toMatchObject({ outcome: 'missed', days_due: 5, days_done: 4, days_missed: 1 });
    // The same week with Monday a minute earlier is won.
    const onTime = LAST_WEEK.map((d) => at(d, '18:00'));
    expect(evaluate([by6()], onTime).periods[0]!.outcome).toBe('won');
  });

  it('[RWD-17-b] by each chore’s due time: after it doesn’t count, before it does', () => {
    const rule = countRule({ target: 2, params: { on_time: 'due_time' } });
    const facts = [
      at('2026-10-12', '07:59', { due_time: '08:00' }),
      at('2026-10-13', '08:01', { due_time: '08:00' }),
      at('2026-10-14', '07:30', { due_time: '08:00' }),
    ];
    const e = evaluate([rule], facts, { repeat: 'none' });
    expect(e.rules[0]).toMatchObject({ current_value: 2, is_met: true });
    expect(isLate(facts[1]!, 'due_time')).toBe(true);
  });

  it('[RWD-17-c] a chore without a due time, under “its due time”, counts at any time that day', () => {
    const late = at('2026-10-12', '23:58', { due_time: null });
    expect(isLate(late, 'due_time')).toBe(false);
    const e = evaluate([countRule({ target: 1, params: { on_time: 'due_time' } })], [late], {
      repeat: 'none',
    });
    expect(e.rules[0]!.is_met).toBe(true);
  });

  it('[RWD-17-d] an offline tick counts by its own time, not when it reached the server', () => {
    // The board ticked at 5:40 pm offline; the server got it at 9 pm. done_at is the tick's time.
    const offline = at('2026-10-12', '17:40');
    const e = evaluate([countRule({ target: 1, params: { on_time: '18:00' } })], [offline], {
      repeat: 'none',
    });
    expect(e.rules[0]!.is_met).toBe(true);
  });

  it('[RWD-17-e] a late tick doesn’t count; its day is a miss once the day closes, and today is never a miss', () => {
    const facts = [
      at('2026-10-12', '17:00'),
      at('2026-10-13', '18:05'),
      at('2026-10-14', '17:00'),
      at('2026-10-15', '18:30'),
    ];
    const now = evaluate(
      [by6({ params: { misses_allowed: 1, on_time: '18:00' } })],
      facts,
    ).periods.at(-1)!;
    expect(now.days!.map((d) => d.mark)).toEqual([
      'done',
      'late',
      'done',
      'today',
      'none',
      'none',
      'none',
    ]);
    expect(now).toMatchObject({ days_done: 2, days_missed: 1, outcome: 'open' });
    // The chore itself stays done (and keeps its points): only the rule doesn't count it.
    expect(facts[1]!.status).toBe('completed');
    // A count with no time counts all four.
    const all = evaluate([countRule({ target: 4 })], facts, { repeat: 'none' });
    expect(all.rules[0]!.current_value).toBe(4);
  });

  it('[RWD-17-f] a parent’s tick after the time doesn’t count; a chore waiting for approval counts by the child’s tick', () => {
    // A parent ticked Monday's homework on Tuesday morning: its time is Tuesday's.
    const parent = done('2026-10-12', { ...hw, done_at: '2026-10-13T07:30' });
    expect(isLate(parent, '18:00')).toBe(true);
    // Waiting for approval, ticked by the child at 5:50 pm (the approval comes later).
    const waiting = pending('2026-10-14', { ...hw, done_at: '2026-10-14T17:50' });
    expect(isLate(waiting, '18:00')).toBe(false);
    const late = pending('2026-10-13', { ...hw, done_at: '2026-10-13T18:10' });
    const now = evaluate(
      [by6({ params: { misses_allowed: 3, on_time: '18:00' } })],
      [parent, late, waiting],
    ).periods.at(-1)!;
    expect(now.days!.slice(0, 3).map((d) => d.mark)).toEqual(['late', 'late', 'open']);
  });

  it('[RWD-17-g] the time is each chore’s due time or a time of day, nothing else', () => {
    expect(onTimeParam({})).toBeNull();
    expect(onTimeParam({ on_time: 'due_time' })).toBe('due_time');
    expect(onTimeParam({ on_time: '06:30' })).toBe('06:30');
    for (const bad of ['6 pm', '24:00', '18:60', 3, 'due']) {
      expect(() => onTimeParam({ on_time: bad })).toThrow(RangeError);
    }
    expect(() =>
      evaluate([countRule({ params: { on_time: 'later' } })], [], { repeat: 'none' }),
    ).toThrow(RangeError);
  });
});

describe('[US-413] goals that pay in steps', () => {
  const tiered = (o: Partial<Rule> = {}) =>
    by6({ params: { misses_allowed: 2, on_time: '18:00' }, ...o });

  it('[RWD-18-a] a lower step pays when its period closes', () => {
    // Last week: 4 of 5 on time (Tuesday at 6:05 pm). Closed: 1 missed, 10 points.
    const facts = LAST_WEEK.map((d, i) => at(d, i === 1 ? '18:05' : '17:30'));
    const [p] = evaluate([tiered()], facts, { steps: BY_MISSES }).periods;
    expect(p).toMatchObject({ outcome: 'won', days_done: 4, days_missed: 1 });
    expect(p!.step).toEqual({ reached: 1, best: 1, final: true, amount: 10, value: 1 });
  });

  it('[RWD-18-b] the top step pays at once, and only its own points', () => {
    // This week: Monday to Thursday on time, Friday to come. All 5 aren't in yet; with Friday a
    // closure (nothing due), the 4 days are all days: the top step, at once, 20 not 35.
    const facts = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d) =>
      at(d, '17:00'),
    );
    const now = evaluate([tiered()], facts, { steps: BY_MISSES }).periods.at(-1)!;
    expect(now.outcome).toBe('won');
    expect(now.step).toMatchObject({ reached: 0, final: true, amount: 20 });
  });

  it('[RWD-18-c] only the highest step reached pays', () => {
    const facts = LAST_WEEK.map((d) => at(d, '17:00'));
    const [p] = evaluate([tiered()], facts, { steps: BY_MISSES }).periods;
    // All 5 reach every step; the top alone pays.
    expect(p!.step).toMatchObject({ reached: 0, amount: 20 });
  });

  it('[RWD-18-d] a lower step pays as soon as no higher step can still be reached', () => {
    // This week, Friday due: Monday late, Tuesday to Thursday on time, Friday to come. 3 done and 1
    // missed: "all days" is out of reach, "1 missed" needs Friday too.
    const week = [
      at('2026-10-12', '18:30'),
      at('2026-10-13', '17:00'),
      at('2026-10-14', '17:00'),
      at('2026-10-15', '17:00'),
      open('2026-10-16', hw),
    ];
    const going = evaluate([tiered()], week, { steps: BY_MISSES }).periods.at(-1)!;
    expect(going.outcome).toBe('open');
    expect(going.step).toMatchObject({ reached: 2, best: 1, final: false });
    // Friday is done on time (Friday is today): 4 done, 1 missed, and nothing higher is in reach.
    week[4] = at('2026-10-16', '17:00');
    const won = evaluate([tiered()], week, { steps: BY_MISSES }, '2026-10-16').periods.at(-1)!;
    expect(won.outcome).toBe('won');
    expect(won.step).toMatchObject({ reached: 1, best: 1, final: true, amount: 10 });
    // Three misses: every step is out of reach, so the week is lost at once.
    const lost = [
      missed('2026-10-12', hw),
      missed('2026-10-13', hw),
      missed('2026-10-14', hw),
      at('2026-10-15', '17:00'),
      open('2026-10-16', hw),
    ];
    const gone = evaluate([tiered()], lost, { steps: BY_MISSES }).periods.at(-1)!;
    expect(gone.outcome).toBe('missed');
    expect(gone.step).toMatchObject({ reached: null, best: null });
  });

  it('[RWD-18-e] a 4-day week reaches its top step with 4', () => {
    const facts = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) =>
      at(d, '17:00'),
    );
    const [p] = evaluate([tiered()], facts, { steps: BY_MISSES }).periods;
    expect(p).toMatchObject({ outcome: 'won', days_due: 4, days_done: 4 });
    expect(p!.step).toMatchObject({ reached: 0, amount: 20 });
  });

  it('[RWD-18-f] steps by number on a one-off goal: the top at once, a lower step when it ends', () => {
    const steps: Step[] = [
      { at: 20, amount: 20 },
      { at: 15, amount: 10 },
      { at: 10, amount: 5 },
    ];
    const books = (n: number) =>
      Array.from({ length: n }, (_, i) => done(`2026-10-${String(1 + i).padStart(2, '0')}`, hw));
    const goal = { repeat: 'none' as const, start_date: '2026-10-01', end_date: '2026-10-31' };
    // 16 so far, still going: 15 is reached but not final.
    const going = evaluate([countRule()], books(16), { ...goal, steps });
    expect(going.is_achieved).toBe(false);
    expect(going.step).toMatchObject({ reached: 1, best: 0, final: false });
    // Ended with 16: the 15 step pays.
    const ended = evaluate([countRule()], books(16), { ...goal, steps }, '2026-11-01');
    expect(ended.is_achieved).toBe(true);
    expect(ended.step).toMatchObject({ reached: 1, final: true, amount: 10 });
    expect(ended.transitions.map((t) => t.type)).toEqual(['achieved']);
    // 20 before it ends: the top, at once.
    const top = evaluate(
      [countRule()],
      books(20),
      { ...goal, steps, end_date: '2026-12-31' },
      '2026-10-21',
    );
    expect(top.is_achieved).toBe(true);
    expect(top.step).toMatchObject({ reached: 0, amount: 20 });
    // Ended under the lowest step: nothing pays, it ends.
    const short = evaluate([countRule()], books(9), { ...goal, steps }, '2026-11-01');
    expect(short.transitions.map((t) => t.type)).toEqual(['expired']);
  });

  it('[RWD-18-g] two weighted rules: the weighted sum; 100% at once, a lower step at the close', () => {
    const reading = { chore_id: 'reading' };
    const rules: Rule[] = [
      { ...daysRule(), weight: 60 },
      { ...countRule({ target: 5, scope: { chore_ids: ['reading'] } }), id: 'r-read', weight: 40 },
    ];
    const steps: Step[] = [
      { at: 100, amount: 20 },
      { at: 75, amount: 10 },
      { at: 50, amount: 5 },
    ];
    // Last week: homework 4 of 5 (60% × 80 = 48), reading 4 of 5 (40% × 80 = 32): 80%, closed.
    const facts = [
      ...LAST_WEEK.map((d, i) => (i === 2 ? missed(d, hw) : done(d, hw))),
      ...LAST_WEEK.slice(0, 4).map((d) => done(d, reading)),
    ];
    const [p] = evaluate(rules, facts, { steps }).periods;
    expect(p!.step).toMatchObject({ value: 80, reached: 1, final: true, amount: 10 });
    expect(p).toMatchObject({ outcome: 'won', pct: 100 });
    // This week, everything met by Thursday (Friday a closure): 100%, at once.
    const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
    const now = evaluate(
      rules,
      [...week.map((d) => done(d, hw)), ...[...week, '2026-10-15'].map((d) => done(d, reading))],
      { steps },
    ).periods.at(-1)!;
    expect(now.step).toMatchObject({ value: 100, reached: 0, final: true, amount: 20 });
    // Going at 77%: 75 reached but not final until the week closes.
    const part = evaluate(
      rules,
      [...week.slice(0, 3).map((d) => done(d, hw)), ...week.map((d) => done(d, reading))],
      { steps },
    ).periods.at(-1)!;
    expect(part.outcome).toBe('open');
    expect(part.step).toMatchObject({ reached: 1, final: false });
  });

  it('[RWD-18-h] steps and weights are checked', () => {
    const one = [daysRule()];
    expect(checkSteps(BY_MISSES, one)).toBe('misses');
    const bad: [Step[], Rule[]][] = [
      [[{ misses: 0, amount: 20 }], one], // no lower step
      [[...BY_MISSES, { misses: 3, amount: 2 }, { misses: 3, amount: 1 }], one], // 4 lower
      [
        [
          { misses: 0, amount: 20 },
          { misses: 1, amount: 20 },
        ],
        one,
      ], // not fewer points
      [
        [
          { misses: 1, amount: 20 },
          { misses: 2, amount: 10 },
        ],
        one,
      ], // top isn't all days
      [
        [
          { misses: 0, amount: 20 },
          { misses: 4, amount: 10 },
        ],
        one,
      ], // more than 3 missed
      [
        [
          { at: 20, amount: 20 },
          { at: 25, amount: 10 },
        ],
        [countRule()],
      ], // above the target
      [
        [
          { at: 19, amount: 20 },
          { at: 10, amount: 10 },
        ],
        [countRule()],
      ], // top isn't the target
      [
        [
          { at: 100, amount: 20 },
          { at: 50, amount: 10 },
        ],
        [
          { ...countRule(), weight: 50 },
          { ...countRule(), id: 'r2', weight: 40 },
        ],
      ], // weights total 90
      [
        [
          { at: 100, amount: 20 },
          { at: 50, amount: 10 },
        ],
        [countRule(), { ...countRule(), id: 'r2' }],
      ], // no weights
    ];
    for (const [steps, rules] of bad) expect(() => checkSteps(steps, rules)).toThrow(RangeError);
    expect(() => evaluate(one, [], { steps: [{ misses: 0, amount: 5 }] })).toThrow(RangeError);
  });
});
