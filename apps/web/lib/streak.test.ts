import { describe, expect, it } from 'vitest';
import { flameDays, flameTier, reachedMilestone, todayClass, todayFacts } from './streak';
import type { TodayItem } from './today';

const TODAY = '2026-10-10';
const item = (o: Partial<TodayItem>): TodayItem => ({
  id: 'i',
  choreId: 'c',
  title: 'Item',
  icon: null,
  kind: 'chore',
  dueDate: TODAY,
  dueTime: null,
  memberId: 'maya',
  assignees: ['maya'],
  status: 'scheduled',
  doneBy: [],
  rewarded: [],
  points: 5,
  requiresApproval: false,
  checkedAt: null,
  ...o,
});
const done = (o: Partial<TodayItem> = {}) =>
  item({ status: 'completed', doneBy: ['maya'], rewarded: ['maya'], ...o });

describe('[RWD-05] the board’s streak flame', () => {
  it('today is good once every routine is done; never bad while some are left (D-51)', () => {
    expect(todayClass([done({ id: 'a' }), done({ id: 'b' })], 'maya', TODAY)).toBe('good');
    expect(todayClass([done({ id: 'a' }), item({ id: 'b' })], 'maya', TODAY)).toBe('open');
    expect(todayClass([], 'maya', TODAY)).toBe('neutral');
    // Waiting for a parent is not done yet.
    expect(
      todayClass([item({ status: 'pending_approval', doneBy: ['maya'] })], 'maya', TODAY),
    ).toBe('open');
  });

  it('reads only the member’s own items; one someone else did is covered, not theirs', () => {
    const leos = done({ id: 'l', memberId: 'leo', assignees: ['leo'], doneBy: ['leo'] });
    const shared = item({
      id: 's',
      memberId: null,
      assignees: ['maya', 'alex'],
      status: 'completed',
      doneBy: ['alex'],
    });
    const facts = todayFacts([leos, shared, done({ id: 'm' })], 'maya', TODAY);
    expect(facts.map((f) => [f.id, f.status, f.credited])).toEqual([
      ['s', 'covered', false],
      ['m', 'completed', true],
    ]);
    // Covered is neutral, so Maya's own bed decides the day.
    expect(todayClass([leos, shared, done({ id: 'm' })], 'maya', TODAY)).toBe('good');
  });

  it('a task done today counts on today; one not done never makes the day', () => {
    const task = item({
      id: 't',
      kind: 'task',
      dueDate: '2026-10-08',
      status: 'completed',
      doneBy: ['maya'],
    });
    expect(todayFacts([task], 'maya', TODAY)[0]!.credit_date).toBe(TODAY);
    expect(
      todayClass([item({ id: 'x', kind: 'task', dueDate: '2026-10-08' })], 'maya', TODAY),
    ).toBe('neutral');
  });

  it('the flame is yesterday’s good run plus today once today is good', () => {
    const good = { kind: 'good' as const, length: 4, best: 9 };
    expect(flameDays(good, [done()], 'maya', TODAY)).toBe(5);
    expect(flameDays(good, [item({})], 'maya', TODAY)).toBe(4);
    // After a bad day, today starts a new run.
    expect(flameDays({ kind: 'bad', length: 2, best: 9 }, [done()], 'maya', TODAY)).toBe(1);
    expect(flameDays({ kind: 'bad', length: 2, best: 9 }, [item({})], 'maya', TODAY)).toBe(0);
    expect(flameDays(null, [], 'maya', TODAY)).toBe(0);
  });

  it('a bigger flame at each milestone, celebrated once as the run reaches it', () => {
    expect([0, 2, 3, 6, 7, 13, 14, 30, 99].map(flameTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 4, 4]);
    expect(reachedMilestone(2, 3)).toBe(true);
    expect(reachedMilestone(3, 3)).toBe(false);
    expect(reachedMilestone(7, 6)).toBe(false);
    expect(reachedMilestone(4, 5)).toBe(false);
  });
});
