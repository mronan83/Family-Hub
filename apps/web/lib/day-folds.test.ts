import type { OccurrenceStatus } from '@familywise/rules-engine';
import { describe, expect, it } from 'vitest';
import { comingUpLine, longDay, overdueWaiting, partFacts, partOpen } from './day-folds';
import type { FoldLine } from './setup-facts';

// [NFR-18][D-120] Today's and My tasks' folds (WP-97): a part of the day's count, when it folds, and
// what Coming up says while folded.

/** A line as it reads, the bold parts in **. */
const read = (line: FoldLine) =>
  line.map((p) => (typeof p === 'string' ? p : `**${p.b}**`)).join('');

let n = 0;
const item = (title: string, status: OccurrenceStatus) => ({ id: `i${(n += 1)}`, title, status });

describe('[CHR-12-a] a part of the day’s done count, and when it folds', () => {
  it('counts done, approved and skipped; folds once every item is one of them', () => {
    const part = [
      item('Make bed', 'completed'),
      item('Make bed', 'approved'),
      item('Brush teeth', 'skipped'),
    ];
    const f = partFacts(part);
    expect([f.done, f.total, f.finished, f.count]).toEqual([3, 3, true, '3 of 3 done']);
    // Each name once.
    expect(read(f.line)).toBe('**3 of 3 done** · Make bed and Brush teeth');
  });

  it.each([
    ['sent back', 'rejected'],
    ['waiting for a parent', 'pending_approval'],
    ['missed', 'missed'],
    ['still to do', 'scheduled'],
  ] as const)('one %s keeps it open and isn’t counted done', (_, status) => {
    const f = partFacts([item('Make bed', 'completed'), item('Homework', status)]);
    expect([f.done, f.total, f.finished]).toEqual([1, 2, false]);
    expect(read(f.line)).toBe('**1 of 2 done**');
  });

  it('names the first three and how many more', () => {
    const f = partFacts(
      ['Make bed', 'Brush teeth', 'Feed the dog', 'Get dressed', 'Pack lunch', 'Water plants'].map(
        (t) => item(t, 'completed'),
      ),
    );
    expect(read(f.line)).toBe('**6 of 6 done** · Make bed, Brush teeth, Feed the dog and 3 more');
    expect(read(partFacts([item('Make bed', 'skipped')]).line)).toBe('**1 of 1 done** · Make bed');
  });

  it('an empty part is not done', () => {
    expect(partFacts([]).finished).toBe(false);
  });
});

describe('[CHR-12-b] which parts show open, and Overdue’s count', () => {
  const done = [item('Make bed', 'completed'), item('Brush teeth', 'approved')];
  const open = [item('Reading', 'scheduled'), item('Piano', 'completed')];

  it('a finished part folds; one with anything to do stays open', () => {
    expect(partOpen('morning', done, null)).toBe(false);
    expect(partOpen('after_school', open, null)).toBe(true);
  });

  it('[D-145] the part holding the item just changed stays open until the next load', () => {
    expect(partOpen('morning', done, done[1]!.id)).toBe(true);
    // Another part's change doesn't open it.
    expect(partOpen('morning', done, open[0]!.id)).toBe(false);
  });

  it('Overdue is always open, with how many are still open', () => {
    const overdue = [item('Library book', 'scheduled'), item('Return form', 'rejected')];
    expect(partOpen('overdue', overdue, null)).toBe(true);
    expect(overdueWaiting(overdue)).toBe('2 open');
  });

  it('the day’s heading in full, the same at any hour and across daylight saving', () => {
    expect(longDay('2026-10-16')).toBe('Friday, October 16');
    // The Sunday daylight saving ends in New York, and a midnight UTC date.
    expect(longDay('2026-11-01')).toBe('Sunday, November 1');
    expect(longDay('2027-01-01')).toBe('Friday, January 1');
  });
});

describe('[CHR-14-a] My tasks’ Coming up, folded', () => {
  const TODAY = '2026-10-29';
  it('how many in the next seven days, and the next with its day and time', () => {
    const line = comingUpLine(
      [
        { title: 'Leo’s dentist', dueDate: '2026-10-30', dueTime: '15:30' },
        { title: 'Order Sam’s cake', dueDate: '2026-11-02', dueTime: null },
        { title: 'Pay the water bill', dueDate: '2026-11-03', dueTime: null },
      ],
      TODAY,
    );
    expect(read(line)).toBe('**3 in the next 7 days** · next: Leo’s dentist, Tomorrow 3:30 pm');
  });

  it('a next one later in the week, over the month’s end and daylight saving, names its date', () => {
    const line = comingUpLine(
      [{ title: 'Order Sam’s cake', dueDate: '2026-11-02', dueTime: null }],
      TODAY,
    );
    expect(read(line)).toBe('**1 in the next 7 days** · next: Order Sam’s cake, Mon, Nov 2');
  });

  it('nothing coming up', () => {
    expect(read(comingUpLine([], TODAY))).toBe('Nothing in the next 7 days');
  });
});
