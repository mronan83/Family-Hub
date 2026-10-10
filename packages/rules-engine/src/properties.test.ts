import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayNumber, toDate } from './dates';
import { evaluateGoal } from './goal';
import { evaluateHistory } from './history';
import type { GoalInput, MemberStatus, OccurrenceFact, Rule } from './types';

// [NFR-12] Properties over random families: whatever the facts, the engine is deterministic, blind to
// the order facts arrive in and to the machine's time zone, stable when replayed later, monotone in
// what gets done, and its two halves (goals and history) agree where they overlap.

const STATUSES: MemberStatus[] = [
  'scheduled',
  'completed',
  'pending_approval',
  'approved',
  'rejected',
  'skipped',
  'missed',
  'covered',
];
const MEMBERS = ['maya', 'leo', 'alex'];

// Today somewhere from March to November 2026, across both daylight-saving changes.
const asOfArb = fc
  .integer({ min: dayNumber('2026-03-01'), max: dayNumber('2026-11-30') })
  .map(toDate);

const shapeArb = fc.record({
  offset: fc.integer({ min: -24, max: 3 }),
  status: fc.constantFrom(...STATUSES),
  routine: fc.boolean(),
  member: fc.constantFrom(...MEMBERS),
  chore: fc.constantFrom('a', 'b', 'c'),
  tags: fc.subarray(['t1', 't2']),
  points: fc.integer({ min: 0, max: 10 }),
  late: fc.integer({ min: 0, max: 4 }),
});
type Shape = typeof shapeArb extends fc.Arbitrary<infer T> ? T : never;

/** Facts as v_member_occurrence gives them: credited when done or waiting, tasks never missed. */
function toFacts(asOf: string, shapes: Shape[], prefix = 'o'): OccurrenceFact[] {
  const today = dayNumber(asOf);
  return shapes.map((s, i) => {
    const kind = s.routine ? 'chore' : 'task';
    const status: MemberStatus = kind === 'task' && s.status === 'missed' ? 'scheduled' : s.status;
    const credited = ['completed', 'approved', 'pending_approval'].includes(status);
    const due = today + s.offset;
    const doneNow = status === 'completed' || status === 'approved';
    return {
      id: `${prefix}${i}`,
      chore_id: s.chore,
      member_id: s.member,
      kind,
      tag_ids: s.tags,
      due_date: toDate(due),
      credit_date: doneNow ? toDate(kind === 'chore' ? due : due + s.late) : null,
      status,
      credited,
      points: s.points,
    };
  });
}

const factsArb = fc
  .tuple(asOfArb, fc.array(shapeArb, { maxLength: 60 }))
  .map(([asOf, shapes]) => ({ asOf, facts: toFacts(asOf, shapes) }));

const ruleArb: fc.Arbitrary<Rule> = fc
  .record({
    type: fc.constantFrom('COUNT', 'POINTS', 'DAILY_ALL_DONE', 'STREAK' as const),
    target: fc.integer({ min: 0, max: 12 }),
    scope: fc.oneof(
      fc.constant({ all: true }),
      fc.record({ chore_ids: fc.subarray(['a', 'b', 'c']), tag_ids: fc.subarray(['t1', 't2']) }),
    ),
    grace: fc.integer({ min: 0, max: 2 }),
    qualify: fc.oneof(
      fc.constant({ mode: 'all_scheduled' as const }),
      fc.integer({ min: 1, max: 3 }).map((value) => ({ mode: 'min_count' as const, value })),
      fc.integer({ min: 1, max: 100 }).map((value) => ({ mode: 'min_pct' as const, value })),
    ),
  })
  .map((r) => ({
    id: 'r',
    type: r.type,
    target: r.target,
    scope: r.scope,
    params: { grace_per_week: r.grace, qualify: r.qualify },
  }));

const goalArb = fc
  .tuple(
    factsArb,
    fc.array(ruleArb, { minLength: 1, maxLength: 3 }),
    fc.record({
      member: fc.constantFrom<string | null>(null, ...MEMBERS),
      start: fc.integer({ min: -30, max: 2 }),
      end: fc.option(fc.integer({ min: -10, max: 5 }), { nil: null }),
      logic: fc.constantFrom('all' as const, 'any' as const),
      status: fc.constantFrom('scheduled' as const, 'active' as const, 'achieved' as const),
      weekStart: fc.integer({ min: 0, max: 6 }),
    }),
  )
  .map(([{ asOf, facts }, rules, g]): GoalInput => {
    const today = dayNumber(asOf);
    return {
      goal: {
        id: 'g',
        member_id: g.member,
        start_date: toDate(today + g.start),
        end_date: g.end === null ? null : toDate(today + Math.max(g.start, g.end)),
        rule_logic: g.logic,
        status: g.status,
      },
      rules: rules.map((r, i) => ({ ...r, id: `r${i}` })),
      occurrences: facts,
      asOf,
      weekStart: g.weekStart,
    };
  });

/** The input with its facts in another order. */
const shuffled = <T>(items: T[], seed: number) =>
  items
    .map((item, i) => ({ item, key: (i * 7919 + seed * 104729) % 1000003 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item);

describe('rules engine properties', () => {
  it('[NFR-12][RWD-04] same input, same result, whatever order the facts arrive in (a replayed event changes nothing)', () => {
    fc.assert(
      fc.property(goalArb, fc.nat(), (input, seed) => {
        const a = evaluateGoal(input);
        expect(evaluateGoal(JSON.parse(JSON.stringify(input)) as GoalInput)).toEqual(a);
        expect(evaluateGoal({ ...input, occurrences: shuffled(input.occurrences, seed) })).toEqual(
          a,
        );
        const h = { memberId: 'maya', occurrences: input.occurrences, asOf: input.asOf };
        expect(evaluateHistory({ ...h, occurrences: shuffled(h.occurrences, seed) })).toEqual(
          evaluateHistory(h),
        );
      }),
    );
  });

  it('[NFR-12][RWD-05] the machine’s time zone, daylight saving included, changes nothing', () => {
    const zones = ['America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'Australia/Lord_Howe'];
    // The package has no Node types (the engine itself never touches Node); the test reaches
    // the runner's environment directly. Node reads TZ again whenever it changes.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
      .process.env;
    const before = env.TZ;
    try {
      fc.assert(
        fc.property(goalArb, (input) => {
          env.TZ = 'UTC';
          const goal = evaluateGoal(input);
          const history = evaluateHistory({
            memberId: 'maya',
            occurrences: input.occurrences,
            asOf: input.asOf,
          });
          for (const tz of zones) {
            env.TZ = tz;
            expect(evaluateGoal(input)).toEqual(goal);
            expect(
              evaluateHistory({
                memberId: 'maya',
                occurrences: input.occurrences,
                asOf: input.asOf,
              }),
            ).toEqual(history);
          }
        }),
        { numRuns: 40 },
      );
    } finally {
      env.TZ = before;
    }
  });

  it('[RWD-11][RWD-04] replayed later, settled days and finished runs come out the same', () => {
    fc.assert(
      fc.property(factsArb, fc.integer({ min: 1, max: 10 }), ({ asOf, facts }, later) => {
        const next = toDate(dayNumber(asOf) + later);
        const now = evaluateHistory({ memberId: 'maya', occurrences: facts, asOf });
        const then = evaluateHistory({ memberId: 'maya', occurrences: facts, asOf: next });
        const settled = (days: typeof now.days) => days.filter((d) => d.date < asOf);
        expect(settled(then.days)).toEqual(settled(now.days));
        for (const s of now.segments.filter((x) => x.end !== null)) {
          expect(then.segments).toContainEqual(s);
        }
      }),
    );
  });

  it('[RWD-11] runs are exactly the stretches of good and bad days, neutral and open days passed over', () => {
    fc.assert(
      fc.property(factsArb, ({ asOf, facts }) => {
        const h = evaluateHistory({ memberId: 'maya', occurrences: facts, asOf });
        // An independent reading: the day classes as letters, runs by regular expression.
        const letters = h.days
          .map((d) => (d.dayClass === 'good' ? 'G' : d.dayClass === 'bad' ? 'B' : ''))
          .join('');
        const runs = letters.match(/G+|B+/g) ?? [];
        expect(h.segments.map((s) => `${s.kind === 'good' ? 'G' : 'B'}${s.length}`)).toEqual(
          runs.map((r) => `${r[0]}${r.length}`),
        );
        expect(h.segments.filter((s) => s.end === null).length).toBe(h.segments.length ? 1 : 0);
        expect(h.segments.at(-1)?.end ?? null).toBeNull();
        expect(h.bestGood).toBe(
          Math.max(0, ...runs.filter((r) => r[0] === 'G').map((r) => r.length)),
        );
        expect(h.worstBad).toBe(
          Math.max(0, ...runs.filter((r) => r[0] === 'B').map((r) => r.length)),
        );
        // Today is never bad.
        expect(h.days.find((d) => d.date === asOf)?.dayClass).not.toBe('bad');
      }),
    );
  });

  it('[RWD-05][RWD-11] goal streaks with no grace agree with the raw history', () => {
    fc.assert(
      fc.property(factsArb, ({ asOf, facts }) => {
        const goal = evaluateGoal({
          goal: {
            id: 'g',
            member_id: 'maya',
            start_date: toDate(dayNumber(asOf) - 30),
            end_date: null,
            rule_logic: 'all',
            status: 'active',
          },
          rules: [
            {
              id: 'r',
              type: 'STREAK',
              target: 99,
              scope: { all: true },
              params: { grace_per_week: 0 },
            },
          ],
          occurrences: facts,
          asOf,
          weekStart: 0,
        });
        const h = evaluateHistory({ memberId: 'maya', occurrences: facts, asOf });
        expect(goal.rules[0]!.best_streak).toBe(h.bestGood);
        expect(goal.rules[0]!.current_streak).toBe(
          h.current.kind === 'good' ? h.current.length : 0,
        );
      }),
    );
  });

  it('[RWD-05] with grace for every day of the week, nothing resets: the streak is every good day', () => {
    fc.assert(
      fc.property(goalArb, (input) => {
        const rules: Rule[] = [
          {
            id: 'r',
            type: 'STREAK',
            target: 1,
            scope: { all: true },
            params: { grace_per_week: 7 },
          },
          { id: 'd', type: 'DAILY_ALL_DONE', target: 1, scope: { all: true }, params: {} },
        ];
        const [streak, days] = evaluateGoal({ ...input, rules }).rules;
        expect(streak!.current_streak).toBe(days!.current_value);
        expect(streak!.best_streak).toBe(days!.current_value);
      }),
    );
  });

  it('[RWD-02][RWD-05] doing more never lowers progress: a missed or open routine done instead', () => {
    fc.assert(
      fc.property(goalArb, fc.nat(), (input, pick) => {
        const member = input.goal.member_id ?? 'maya';
        const candidates = input.occurrences.filter(
          (f) =>
            f.member_id === member &&
            f.kind === 'chore' &&
            (f.status === 'missed' || f.status === 'scheduled'),
        );
        if (candidates.length === 0) return;
        const flip = candidates[pick % candidates.length]!;
        const better = input.occurrences.map((f) =>
          f === flip
            ? { ...f, status: 'completed' as const, credited: true, credit_date: f.due_date }
            : f,
        );
        const before = evaluateGoal(input).rules;
        const after = evaluateGoal({ ...input, occurrences: better }).rules;
        after.forEach((r, i) => {
          const was = before[i]!;
          if (r.type === 'STREAK') expect(r.best_streak!).toBeGreaterThanOrEqual(was.best_streak!);
          else expect(r.current_value).toBeGreaterThanOrEqual(was.current_value);
          if (was.is_met) expect(r.is_met).toBe(true);
        });
      }),
    );
  });

  it('[D-31][RWD-11] tasks, skipped and covered routines never change how a day went', () => {
    fc.assert(
      fc.property(factsArb, fc.array(shapeArb, { maxLength: 20 }), ({ asOf, facts }, extra) => {
        const neutral = toFacts(asOf, extra, 'x').map((f): OccurrenceFact =>
          f.kind === 'task'
            ? f
            : {
                ...f,
                status: f.status === 'skipped' ? 'skipped' : 'covered',
                credited: false,
                credit_date: null,
              },
        );
        const classes = (occurrences: OccurrenceFact[]) =>
          new Map(
            evaluateHistory({ memberId: 'maya', occurrences, asOf }).days.map((d) => [
              d.date,
              d.dayClass,
            ]),
          );
        const before = classes(facts);
        const after = classes([...facts, ...neutral]);
        for (const [date, cls] of after) expect(cls).toBe(before.get(date) ?? 'neutral');
      }),
    );
  });

  it('[RWD-03][D-30] progress stays within 0–100; any is at least all; a family goal counts at least any one member', () => {
    fc.assert(
      fc.property(goalArb, (input) => {
        const all = evaluateGoal({ ...input, goal: { ...input.goal, rule_logic: 'all' } });
        const any = evaluateGoal({ ...input, goal: { ...input.goal, rule_logic: 'any' } });
        for (const e of [all, any]) {
          expect(e.pct).toBeGreaterThanOrEqual(0);
          expect(e.pct).toBeLessThanOrEqual(100);
          for (const r of e.rules) expect(r.pct >= 0 && r.pct <= 100).toBe(true);
        }
        expect(any.pct).toBeGreaterThanOrEqual(all.pct);
        if (all.is_achieved) expect(any.is_achieved).toBe(true);

        const counts = input.rules.filter((r) => r.type === 'COUNT' || r.type === 'POINTS');
        if (counts.length === 0) return;
        const family = evaluateGoal({
          ...input,
          rules: counts,
          goal: { ...input.goal, member_id: null },
        });
        for (const m of MEMBERS) {
          const one = evaluateGoal({
            ...input,
            rules: counts,
            goal: { ...input.goal, member_id: m },
          });
          one.rules.forEach((r, i) =>
            expect(family.rules[i]!.current_value).toBeGreaterThanOrEqual(r.current_value),
          );
        }
      }),
    );
  });
});
