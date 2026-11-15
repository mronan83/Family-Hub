import {
  evaluateGoal,
  type GoalEvaluation,
  type OccurrenceFact,
  type Rule,
} from '@familywise/rules-engine';
import { describe, expect, it } from 'vitest';
import {
  canMarkOnTime,
  type CheckOff,
  countingGoals,
  factsMarkedOnTime,
  householdNow,
  isLateTick,
  lateWords,
  latestTime,
  missedOrLate,
  onTimeInstant,
  onTimeNotice,
  onTimeState,
  onTimeTrace,
  readOnTime,
  settledChange,
} from './on-time';

// [CHR-24] Mark done on time (WP-117, D-151). Sunday, Nov 15, 2026 is today in New York; the family's
// week starts Monday: Nov 9 to 15 is the week going (it ends tonight), Nov 2 to 8 the one before.
const NOW = '2026-11-15T10:00';
const TZ = 'America/New_York';

const chore = (o: Partial<Parameters<typeof onTimeState>[0]> = {}) => ({
  kind: 'chore' as const,
  status: 'missed' as const,
  dueDate: '2026-11-12',
  dueTime: '15:30' as string | null,
  ...o,
});
const tick = (checkedAt: string, o: Partial<CheckOff> = {}): CheckOff => ({
  checkedAt,
  markedOnTime: false,
  onTimeAt: null,
  markedBy: null,
  markedOn: null,
  ...o,
});

/** Maya's homework folder, due 3:30 pm each school day, as goal_facts gives it. */
const fact = (date: string, o: Partial<OccurrenceFact> = {}): OccurrenceFact => ({
  id: `occ-${date}`,
  chore_id: 'homework',
  member_id: 'maya',
  kind: 'chore',
  tag_ids: [],
  due_date: date,
  credit_date: date,
  status: 'approved',
  credited: true,
  points: 5,
  due_time: '15:30',
  done_at: `${date}T15:10`,
  ...o,
});
const missed = (date: string) =>
  fact(date, { status: 'missed', credited: false, credit_date: null, done_at: null });

const rule = (onTime: string | null): Rule => ({
  id: 'r1',
  type: 'DAYS_DUE',
  target: 1,
  scope: { chore_ids: ['homework'] },
  params: { misses_allowed: 0, ...(onTime ? { on_time: onTime } : {}) },
});

function evaluate(facts: OccurrenceFact[], onTime: string | null = 'due_time', asOf = NOW) {
  return evaluateGoal({
    goal: {
      id: 'g',
      member_id: 'maya',
      start_date: '2026-11-02',
      end_date: null,
      rule_logic: 'all',
      status: 'active',
      repeat: 'week',
    },
    rules: [rule(onTime)],
    occurrences: facts,
    asOf: asOf.slice(0, 10),
    weekStart: 1,
  });
}

const LAST_WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];

describe('[CHR-24] what a parent can mark on time', () => {
  it('[CHR-24-f] Done on time… is offered on a missed chore, one done late and one open past its time today', () => {
    expect(onTimeState(chore(), null, NOW)).toBe('missed');
    // Still open on a day gone by: the day close hasn't run yet.
    expect(onTimeState(chore({ status: 'scheduled' }), null, NOW)).toBe('missed');
    // Ticked at 8:10 pm, after 3:30 pm; and a parent's tick the next morning.
    const done = chore({ status: 'completed' });
    expect(onTimeState(done, tick('2026-11-12T20:10'), NOW)).toBe('late');
    expect(onTimeState(chore({ status: 'approved' }), tick('2026-11-13T07:05'), NOW)).toBe('late');
    // Today, open after its time: offered; before it: not yet.
    const today = chore({ status: 'scheduled', dueDate: '2026-11-15', dueTime: '09:30' });
    expect(onTimeState(today, null, NOW)).toBe('overdue');
    expect(onTimeState({ ...today, dueTime: '15:30' }, null, NOW)).toBeNull();
    // Waiting for a parent, ticked late, is late too.
    expect(onTimeState(chore({ status: 'pending_approval' }), tick('2026-11-12T20:10'), NOW)).toBe(
      'late',
    );
  });

  it('[CHR-24-f] not on a task, a chore not due yet, one done on time, one skipped or one already marked on time', () => {
    expect(onTimeState(chore({ kind: 'task' }), null, NOW)).toBeNull();
    expect(
      onTimeState(chore({ dueDate: '2026-11-16', status: 'scheduled' }), null, NOW),
    ).toBeNull();
    const done = chore({ status: 'completed' });
    expect(onTimeState(done, tick('2026-11-12T15:30'), NOW)).toBeNull();
    expect(onTimeState(chore({ status: 'skipped' }), null, NOW)).toBeNull();
    expect(
      onTimeState(
        chore({ status: 'approved' }),
        tick('2026-11-13T08:00', { markedOnTime: true }),
        NOW,
      ),
    ).toBeNull();
    // A chore without a due time is late only when ticked on a later day.
    const anytime = chore({ status: 'completed', dueTime: null });
    expect(onTimeState(anytime, tick('2026-11-12T23:58'), NOW)).toBeNull();
    expect(onTimeState(anytime, tick('2026-11-13T00:02'), NOW)).toBe('late');
    expect(isLateTick(anytime, tick('2026-11-13T00:02'))).toBe(true);
  });

  it('[CHR-24-f] on a goal’s day, a tick after the goal’s own time is late for it; the action takes any done chore not yet marked', () => {
    const anytime = chore({ status: 'completed', dueTime: null });
    expect(onTimeState(anytime, tick('2026-11-12T19:05'), NOW, '18:00')).toBe('late');
    expect(onTimeState(anytime, tick('2026-11-12T17:55'), NOW, '18:00')).toBeNull();
    expect(canMarkOnTime(anytime, tick('2026-11-12T19:05'), NOW)).toBe(true);
    expect(canMarkOnTime(chore({ kind: 'task' }), null, NOW)).toBe(false);
    expect(canMarkOnTime(chore({ status: 'skipped' }), null, NOW)).toBe(false);
    expect(
      canMarkOnTime(
        chore({ status: 'approved' }),
        tick('2026-11-13T08:00', { markedOnTime: true }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('[CHR-24] the time it records', () => {
  it('[CHR-24-c] "On time", or an earlier time on its day, by its due time and not after now; anything else is refused', () => {
    const item = { dueDate: '2026-11-12', dueTime: '15:30' };
    expect(readOnTime('due', null, item, NOW)).toEqual({ at: null });
    expect(readOnTime('at', '15:15', item, NOW)).toEqual({ at: '15:15' });
    expect(readOnTime('at', '15:30', item, NOW)).toEqual({ at: '15:30' });
    expect(readOnTime('at', '15:31', item, NOW)).toBeNull();
    expect(readOnTime('at', '25:00', item, NOW)).toBeNull();
    expect(readOnTime('at', 'soon', item, NOW)).toBeNull();
    expect(readOnTime('later', '15:00', item, NOW)).toBeNull();
    // Without a due time, up to the end of its day; today, not after now.
    expect(readOnTime('at', '23:59', { ...item, dueTime: null }, NOW)).toEqual({ at: '23:59' });
    const today = { dueDate: '2026-11-15', dueTime: null };
    expect(readOnTime('at', '09:59', today, NOW)).toEqual({ at: '09:59' });
    expect(readOnTime('at', '10:01', today, NOW)).toBeNull();
    expect(latestTime('15:30:00')).toBe('15:30');
    expect(latestTime(null)).toBe('23:59');
  });

  it('[CHR-24-c] a time given is that instant on its day in the household’s zone, across DST and midnight UTC', () => {
    // Standard time (UTC-5) and daylight time (UTC-4).
    expect(onTimeInstant(TZ, '2026-11-12', '15:15')).toBe('2026-11-12T20:15:00.000Z');
    expect(onTimeInstant(TZ, '2026-10-29', '15:15')).toBe('2026-10-29T19:15:00.000Z');
    // The night clocks go back: 11:30 pm is the next day in UTC.
    expect(onTimeInstant(TZ, '2026-11-01', '23:30')).toBe('2026-11-02T04:30:00.000Z');
    expect(householdNow(TZ, new Date('2026-11-16T04:30:00Z'))).toBe('2026-11-15T23:30');
    expect(householdNow(TZ, new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30T23:59');
  });

  it('[CHR-24-b] "On time" counts for a goal done by its due time and by a set time; a parent’s late Mark done doesn’t (D-151)', () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    // Thursday ticked by a parent the next morning: late, so the week is missed.
    const facts = week.map((d) =>
      d === '2026-11-12' ? fact(d, { done_at: '2026-11-13T07:05' }) : fact(d),
    );
    for (const onTime of ['due_time', '18:00']) {
      const before = evaluate(facts, onTime);
      expect(before.periods.at(-1)?.outcome).toBe('missed');
      const marked = factsMarkedOnTime(facts, 'occ-2026-11-12', ['maya'], '2026-11-12', null);
      expect(marked.find((f) => f.id === 'occ-2026-11-12')).toMatchObject({
        status: 'approved',
        credited: true,
        done_at: null,
      });
      expect(evaluate(marked, onTime).periods.at(-1)?.outcome).toBe('won');
    }
    // A chore without a due time, under a goal "by 6:00 pm": "On time" counts too.
    const anytime = week.map((d) => fact(d, { due_time: null, done_at: `${d}T17:00` }));
    anytime[3] = missed('2026-11-12');
    anytime[3]!.due_time = null;
    expect(evaluate(anytime, '18:00').periods.at(-1)?.outcome).toBe('missed');
    const fixed = factsMarkedOnTime(anytime, 'occ-2026-11-12', ['maya'], '2026-11-12', null);
    expect(evaluate(fixed, '18:00').periods.at(-1)?.outcome).toBe('won');
  });

  it('[CHR-24-c] a time given is the tick’s time: after a goal’s time, it is late for that goal', () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    const facts = week.map((d) => (d === '2026-11-12' ? missed(d) : fact(d)));
    const at1545 = factsMarkedOnTime(facts, 'occ-2026-11-12', ['maya'], '2026-11-12', '15:15');
    expect(at1545.find((f) => f.id === 'occ-2026-11-12')?.done_at).toBe('2026-11-12T15:15');
    expect(evaluate(at1545, 'due_time').periods.at(-1)?.outcome).toBe('won');
    expect(evaluate(at1545, '15:00').periods.at(-1)?.outcome).toBe('missed');
  });

  it('[CHR-24-a] marked on time, a shared chore is covered for those who didn’t do it', () => {
    const shared = [
      fact('2026-11-12', { id: 'occ-s', member_id: 'maya', status: 'missed', credited: false }),
      fact('2026-11-12', { id: 'occ-s', member_id: 'leo', status: 'missed', credited: false }),
    ];
    const marked = factsMarkedOnTime(shared, 'occ-s', ['leo'], '2026-11-12', null);
    expect(marked.map((f) => [f.member_id, f.status, f.credited])).toEqual([
      ['maya', 'covered', false],
      ['leo', 'approved', true],
    ]);
  });
});

describe('[CHR-24] the words', () => {
  it('[CHR-24-g] the trace says who marked it on time and when, with the time when one was given', () => {
    expect(
      onTimeTrace(
        tick('2026-11-13T08:05', { markedOnTime: true, markedBy: 'Alex', markedOn: '2026-11-13' }),
      ),
    ).toBe('Marked on time by Alex, Nov 13');
    expect(
      onTimeTrace(
        tick('2026-11-05T07:40', {
          markedOnTime: true,
          onTimeAt: '15:45',
          markedBy: 'Sam',
          markedOn: '2026-11-05',
        }),
      ),
    ).toBe('Marked on time (3:45 pm) by Sam, Nov 5');
    expect(onTimeTrace(tick('2026-11-13T08:05', { markedOnTime: true }))).toBe(
      'Marked on time by a parent',
    );
    expect(onTimeTrace(tick('2026-11-12T20:10'))).toBeNull();
    expect(onTimeTrace(null)).toBeNull();
  });

  it('[CHR-24-g] a late tick says when, after its time; on a later day, which day', () => {
    const done = chore({ status: 'completed' });
    expect(lateWords(done, tick('2026-11-12T20:10'))).toBe(
      'done late · ticked 8:10 pm, after 3:30 pm',
    );
    expect(lateWords(done, tick('2026-11-13T07:05'))).toBe(
      'done late · ticked Fri, Nov 13 at 7:05 am',
    );
    expect(onTimeNotice('Homework folder home', ['Maya'])).toBe(
      'Marked Homework folder home done on time. It counts for Maya’s goals.',
    );
    expect(onTimeNotice('Feed the dog', ['Alex', 'Maya'])).toBe(
      'Marked Feed the dog done on time. It counts for their goals.',
    );
  });
});

describe('[CHR-24] a week or goal already settled', () => {
  const goal = {
    title: 'Homework home every school day',
    repeat: 'week' as const,
    status: 'active',
    endDate: null,
    name: 'Maya',
    pays: '10 points',
  };
  const lastWeek = LAST_WEEK.map((d) => (d === '2026-11-05' ? missed(d) : fact(d)));

  it('[CHR-24-h] a settled week the fix wins asks first, saying what it pays', () => {
    const before = evaluate(lastWeek);
    const after = evaluate(
      factsMarkedOnTime(lastWeek, 'occ-2026-11-05', ['maya'], '2026-11-05', null),
    );
    expect(settledChange(before, after, goal, '2026-11-15')).toEqual({
      text: 'This makes Maya’s week of Nov 2 a win: 10 points.',
      pays: '10 points',
    });
  });

  it('[CHR-24-h] the week going now, or a change that doesn’t move a result, doesn’t ask', () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    const facts = week.map((d) => (d === '2026-11-12' ? missed(d) : fact(d)));
    const before = evaluate(facts);
    const after = evaluate(
      factsMarkedOnTime(facts, 'occ-2026-11-12', ['maya'], '2026-11-12', null),
    );
    expect(after.periods.at(-1)?.outcome).toBe('won');
    expect(settledChange(before, after, goal, '2026-11-15')).toBeNull();
    // Two misses last week: one fixed still leaves it missed.
    const twice = lastWeek.map((f) => (f.due_date === '2026-11-03' ? missed('2026-11-03') : f));
    const b2 = evaluate(twice);
    const a2 = evaluate(factsMarkedOnTime(twice, 'occ-2026-11-05', ['maya'], '2026-11-05', null));
    expect(settledChange(b2, a2, goal, '2026-11-15')).toBeNull();
  });

  it('[CHR-24-h] a goal that doesn’t repeat asks once reached or ended; steps say the difference', () => {
    const e = (o: Partial<GoalEvaluation>) =>
      ({ periods: [], is_achieved: false, step: null, ...o }) as GoalEvaluation;
    const one = { ...goal, repeat: 'none' as const, status: 'expired', endDate: '2026-11-13' };
    expect(settledChange(e({}), e({ is_achieved: true }), one, '2026-11-15')).toEqual({
      text: 'This makes Maya reach “Homework home every school day”: 10 points.',
      pays: '10 points',
    });
    // Going, with its end ahead: the payout follows at once, with no confirm.
    const going = { ...one, status: 'active', endDate: '2026-11-30' };
    expect(settledChange(e({}), e({ is_achieved: true }), going, '2026-11-15')).toBeNull();
    // Reached already at a lower step: the fix moves it up, paying the difference.
    const step = (reached: number, amount: number) => ({
      reached,
      best: reached,
      final: true,
      amount,
      value: 0,
    });
    expect(
      settledChange(
        e({ is_achieved: true, step: step(1, 10) }),
        e({ is_achieved: true, step: step(0, 20) }),
        { ...going, status: 'achieved' },
        '2026-11-15',
      ),
    ).toEqual({
      text: 'This moves “Homework home every school day” up a step: 10 points more.',
      pays: '10 points',
    });
  });
});

describe('[CHR-24] where it shows', () => {
  it('[CHR-24-j] a child’s page lists the last 14 days’ missed or late chores, newest first, each marked one with its trace', () => {
    const items = [
      { id: 'a', title: 'Homework folder home', ...chore() },
      {
        id: 'b',
        title: 'Piano practice',
        ...chore({ dueDate: '2026-11-10', dueTime: '16:30', status: 'completed' }),
      },
      {
        id: 'c',
        title: 'Homework folder home',
        ...chore({ dueDate: '2026-11-04', status: 'approved' }),
      },
      {
        id: 'd',
        title: 'Make bed',
        ...chore({ dueDate: '2026-11-14', dueTime: '07:30', status: 'completed' }),
      },
      { id: 'e', title: 'Old one', ...chore({ dueDate: '2026-11-01' }) },
      { id: 'f', title: 'Reading', ...chore({ dueTime: '08:00' }) },
    ];
    const checks = new Map<string, CheckOff>([
      ['b', tick('2026-11-10T18:05')],
      [
        'c',
        tick('2026-11-05T07:40', { markedOnTime: true, markedBy: 'Sam', markedOn: '2026-11-05' }),
      ],
      ['d', tick('2026-11-14T07:10')],
    ]);
    const rows = missedOrLate(items, checks, NOW, '2026-11-02');
    expect(rows.map((r) => [r.item.id, r.state])).toEqual([
      ['f', 'missed'],
      ['a', 'missed'],
      ['b', 'late'],
      ['c', 'marked'],
    ]);
    expect(onTimeTrace(rows.at(-1)!.checkOff)).toBe('Marked on time by Sam, Nov 5');
  });

  it('[CHR-24-f] the panel names the goals that count a chore: its person’s or the family’s, in its dates and scope', () => {
    const goals = [
      {
        title: 'Homework home',
        memberId: 'maya',
        startDate: '2026-11-01',
        endDate: null,
        scopes: [{ chore_ids: ['hw'] }],
      },
      {
        title: 'Everything done',
        memberId: null,
        startDate: '2026-11-01',
        endDate: null,
        scopes: [{ all: true }],
      },
      {
        title: 'Leo’s reading',
        memberId: 'leo',
        startDate: '2026-11-01',
        endDate: null,
        scopes: [{ all: true }],
      },
      {
        title: 'Tagged school',
        memberId: 'maya',
        startDate: '2026-11-01',
        endDate: null,
        scopes: [{ tag_ids: ['school'] }],
      },
      {
        title: 'Over',
        memberId: 'maya',
        startDate: '2026-10-01',
        endDate: '2026-11-01',
        scopes: [{ all: true }],
      },
    ];
    const item = { choreId: 'hw', dueDate: '2026-11-12', memberId: 'maya', assignees: ['maya'] };
    expect(countingGoals(item, [], goals)).toEqual(['Homework home', 'Everything done']);
    expect(countingGoals(item, ['school'], goals)).toEqual([
      'Homework home',
      'Everything done',
      'Tagged school',
    ]);
  });
});
