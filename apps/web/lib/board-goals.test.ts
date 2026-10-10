import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  celebratedSchema,
  celebrationKey,
  celebrationLine,
  endsLine,
  goalNudge,
  goalsFor,
  nudgeFor,
  postCelebrated,
  ruleMeter,
  ruleNote,
  toCelebrate,
} from './board-goals';
import type { BoardGoal, BoardGoalRule } from './snapshot';

const rule = (o: Partial<BoardGoalRule>): BoardGoalRule => ({
  id: 'r',
  type: 'COUNT',
  target: 10,
  current: 0,
  pct: 0,
  met: false,
  streak: null,
  best: null,
  ...o,
});
const goal = (o: Partial<BoardGoal>): BoardGoal => ({
  id: 'g',
  memberId: 'leo',
  title: 'Bike ride',
  icon: 'star',
  photo: null,
  status: 'active',
  n: 0,
  achievedAt: null,
  celebrate: false,
  endDate: null,
  logic: 'all',
  pct: 0,
  rules: [rule({})],
  ...o,
});

describe('goals on the board', () => {
  it('[RWD-07] a child’s own goals first, then the family’s; not someone else’s', () => {
    const goals = [
      goal({ id: 'family', memberId: null }),
      goal({ id: 'maya', memberId: 'maya' }),
      goal({ id: 'leo' }),
    ];
    expect(goalsFor(goals, 'leo').map((g) => g.id)).toEqual(['leo', 'family']);
  });

  it('[RWD-07][US-403] a meter per rule in a child’s words; a streak says its run now', () => {
    expect(ruleMeter(rule({ type: 'COUNT', target: 10, current: 12 }))).toEqual({
      label: 'Things done',
      value: 10,
      target: 10,
    });
    expect(ruleMeter(rule({ type: 'STREAK', target: 5, current: 3 })).label).toBe(
      'Good days in a row',
    );
    expect(ruleNote(rule({ type: 'STREAK', streak: 2, best: 3 }))).toBe('2 in a row now, best 3');
    expect(ruleNote(rule({ type: 'STREAK', streak: 3, best: 3 }))).toBe('3 in a row now');
    expect(ruleNote(rule({ type: 'STREAK', streak: 5, best: 5, met: true }))).toBeNull();
    expect(ruleNote(rule({ type: 'COUNT' }))).toBeNull();
  });

  it('[RWD-07] when a goal ends, in household days', () => {
    expect(endsLine(null, '2026-10-10')).toBeNull();
    expect(endsLine('2026-10-10', '2026-10-10')).toBe('Ends today');
    expect(endsLine('2026-10-11', '2026-10-10')).toBe('Ends tomorrow');
    expect(endsLine('2026-10-13', '2026-10-10')).toBe('Ends Tuesday');
    expect(endsLine('2026-10-24', '2026-10-10')).toBe('Ends Oct 24');
    expect(endsLine('2026-10-09', '2026-10-10')).toBeNull();
  });
});

describe('nudges', () => {
  it('[RWD-07][US-403] one thing from finishing: a nudge naming the goal', () => {
    expect(goalNudge(goal({ rules: [rule({ current: 9 })] }))).toBe(
      'One more thing to do for Bike ride!',
    );
    expect(goalNudge(goal({ rules: [rule({ type: 'STREAK', target: 5, streak: 4 })] }))).toBe(
      'One more good day in a row for Bike ride!',
    );
    expect(
      goalNudge(goal({ rules: [rule({ type: 'DAILY_ALL_DONE', target: 5, current: 4 })] })),
    ).toBe('One more day with everything done for Bike ride!');
    expect(goalNudge(goal({ rules: [rule({ type: 'POINTS', target: 100, current: 92 })] }))).toBe(
      '8 more points for Bike ride!',
    );
    expect(goalNudge(goal({ rules: [rule({ type: 'POINTS', target: 20, current: 19 })] }))).toBe(
      '1 more point for Bike ride!',
    );
  });

  it('[RWD-07] with "all", only when every other rule is met; with "any", any close one', () => {
    const close = rule({ id: 'a', current: 9 });
    const far = rule({ id: 'b', current: 2 });
    expect(goalNudge(goal({ rules: [close, far] }))).toBeNull();
    expect(goalNudge(goal({ rules: [close, { ...far, met: true }] }))).toBe(
      'One more thing to do for Bike ride!',
    );
    expect(goalNudge(goal({ logic: 'any', rules: [far, close] }))).toBe(
      'One more thing to do for Bike ride!',
    );
  });

  it('[RWD-07] 90% of the way is "almost there"; far off, reached, or met is no nudge', () => {
    expect(goalNudge(goal({ pct: 90, rules: [rule({ target: 20, current: 18 })] }))).toBe(
      'Almost there with Bike ride!',
    );
    expect(goalNudge(goal({ pct: 50, rules: [rule({ current: 5 })] }))).toBeNull();
    expect(goalNudge(goal({ status: 'achieved', rules: [rule({ current: 9 })] }))).toBeNull();
    expect(goalNudge(goal({ rules: [rule({ current: 10, met: true })] }))).toBeNull();
  });

  it('[RWD-07] a child’s first nudge: their own goals, then the family’s', () => {
    const family = goal({
      id: 'f',
      memberId: null,
      title: 'Pizza night',
      rules: [rule({ current: 9 })],
    });
    const far = goal({ id: 'l', rules: [rule({ current: 1 })] });
    expect(nudgeFor([family, far], 'leo')).toBe('One more thing to do for Pizza night!');
    expect(nudgeFor([far], 'leo')).toBeNull();
    // Everyone's view: a child's own goals only (the family's have their own place).
    expect(nudgeFor([family, far], 'leo', { own: true })).toBeNull();
  });
});

describe('celebrating once', () => {
  it('[RWD-08][US-404] reached goals not yet celebrated, first reached first, less those done here', () => {
    const a = goal({
      id: 'a',
      status: 'achieved',
      n: 1,
      celebrate: true,
      achievedAt: '2026-10-10T10:00:00Z',
    });
    const b = goal({
      id: 'b',
      status: 'achieved',
      n: 2,
      celebrate: true,
      achievedAt: '2026-10-10T09:00:00Z',
    });
    const done = goal({ id: 'c', status: 'achieved', n: 1, celebrate: false });
    expect(toCelebrate([a, b, done], new Set()).map((g) => g.id)).toEqual(['b', 'a']);
    expect(toCelebrate([a, b], new Set([celebrationKey(b)])).map((g) => g.id)).toEqual(['a']);
    // Reached again: a new achievement is celebrated on its own.
    expect(toCelebrate([{ ...b, n: 3 }], new Set([celebrationKey(b)])).map((g) => g.id)).toEqual([
      'b',
    ]);
  });

  it('[RWD-08] names who reached it', () => {
    const name = (id: string) => (id === 'leo' ? 'Leo' : 'someone');
    expect(celebrationLine(goal({}), name)).toBe('Leo reached Bike ride!');
    expect(celebrationLine(goal({ memberId: null, title: 'Pizza night' }), name)).toBe(
      'The family reached Pizza night!',
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('[RWD-08] tells the server which goal and which time it was reached', async () => {
    const ID = '0de00000-0000-4000-8000-0000000c0001';
    expect(celebratedSchema.safeParse({ goal_id: ID, n: 1 }).success).toBe(true);
    expect(celebratedSchema.safeParse({ goal_id: ID, n: 0 }).success).toBe(false);
    expect(celebratedSchema.safeParse({ goal_id: ID }).success).toBe(false);
    const fetch = vi.fn(async () => Response.json({ marked: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await postCelebrated(ID, 2)).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/goals/celebrated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal_id: ID, n: 2 }),
    });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await postCelebrated(ID, 2)).toBe(false);
  });
});
