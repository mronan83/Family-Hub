import { describe, expect, it } from 'vitest';
import {
  boardActivity,
  defaultDoers,
  itemsFor,
  nameList,
  optimistic,
  pickerOrder,
  pointsHeld,
  progress,
  sections,
  tileView,
  type TodayItem,
  undoUntil,
} from './today';

const TODAY = '2026-10-09';
const item = (o: Partial<TodayItem>): TodayItem => ({
  id: 'o1',
  choreId: 'c1',
  title: 'Make bed',
  icon: 'chore-bed',
  kind: 'chore',
  dueDate: TODAY,
  dueTime: null,
  memberId: null,
  assignees: ['maya'],
  status: 'scheduled',
  doneBy: [],
  rewarded: [],
  points: 5,
  requiresApproval: false,
  checkedAt: null,
  ...o,
});
const NAMES: Record<string, string> = { maya: 'Maya', leo: 'Leo', alex: 'Alex', sam: 'Sam' };
const name = (id: string) => NAMES[id] ?? '?';

describe('whose items', () => {
  it('[BRD-02][CHR-18] a person sees their own items and the shared ones they are on', () => {
    const items = [
      item({ id: 'bed-maya', memberId: 'maya', assignees: ['maya'] }),
      item({ id: 'bed-leo', memberId: 'leo', assignees: ['leo'] }),
      item({ id: 'dog', assignees: ['maya', 'alex'] }),
      item({ id: 'table', assignees: ['leo'] }),
    ];
    expect(itemsFor(items, 'maya').map((i) => i.id)).toEqual(['bed-maya', 'dog']);
    expect(itemsFor(items, 'alex').map((i) => i.id)).toEqual(['dog']);
  });
});

describe('the day in parts', () => {
  it('[CHR-11][CHR-12] overdue tasks first, then morning, after school, evening and anytime', () => {
    const s = sections(
      [
        item({ id: 'any', title: 'Read' }),
        item({ id: 'eve', dueTime: '19:00' }),
        item({ id: 'old', kind: 'task', dueDate: '2026-10-07', title: 'Call the plumber' }),
        item({ id: 'am2', dueTime: '07:45', title: 'Brush teeth' }),
        item({ id: 'am1', dueTime: '07:30', title: 'Make bed' }),
        item({ id: 'pm', dueTime: '16:00' }),
      ],
      TODAY,
    );
    expect(s.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Overdue', ['old']],
      ['Morning', ['am1', 'am2']],
      ['After school', ['pm']],
      ['Evening', ['eve']],
      ['Anytime', ['any']],
    ]);
  });

  it('[CHR-11] leaves out a part with nothing in it', () => {
    expect(sections([item({ dueTime: '08:00' })], TODAY).map((x) => x.key)).toEqual(['morning']);
    expect(sections([], TODAY)).toEqual([]);
  });
});

describe('how a tile reads', () => {
  it('[CHR-09][D-30] a shared item done by someone else is covered for the rest', () => {
    const dog = item({ assignees: ['maya', 'alex'], status: 'completed', doneBy: ['alex'] });
    expect(tileView(dog, 'maya', TODAY, '12:00', name)).toEqual({
      status: 'completed',
      display: 'covered',
      coveredBy: 'Alex',
    });
    expect(tileView(dog, 'alex', TODAY, '12:00', name)).toEqual({ status: 'completed' });
  });

  it('[CHR-18] someone else doing my own item says who; doing it myself says nothing more', () => {
    const bed = item({
      memberId: 'leo',
      assignees: ['leo'],
      status: 'completed',
      doneBy: ['maya'],
    });
    expect(tileView(bed, 'leo', TODAY, '12:00', name)).toEqual({
      status: 'completed',
      doneBy: 'Maya',
    });
    const together = item({
      assignees: ['maya', 'leo'],
      status: 'completed',
      doneBy: ['leo', 'maya'],
    });
    expect(tileView(together, 'maya', TODAY, '12:00', name).doneBy).toBe('Leo and Maya');
  });

  it('[CHR-12] an open task from before today is overdue', () => {
    expect(
      tileView(item({ kind: 'task', dueDate: '2026-10-08' }), 'maya', TODAY, '08:00', name).display,
    ).toBe('overdue');
  });

  it("[CHR-11] today's open item after its due time is past its time; done or before, not", () => {
    const due = item({ dueTime: '07:30' });
    expect(tileView(due, 'maya', TODAY, '07:31', name).display).toBe('past-time');
    expect(tileView(due, 'maya', TODAY, '07:30', name).display).toBeUndefined();
    expect(
      tileView({ ...due, status: 'completed', doneBy: ['maya'] }, 'maya', TODAY, '09:00', name)
        .display,
    ).toBeUndefined();
  });

  it('names people the way people say them', () => {
    expect(nameList(['Maya'])).toBe('Maya');
    expect(nameList(['Maya', 'Leo'])).toBe('Maya and Leo');
    expect(nameList(['Maya', 'Leo', 'Sam'])).toBe('Maya, Leo and Sam');
  });
});

describe('who a tap credits', () => {
  it("[CHR-04][US-304] on a person's own screen, it is them", () => {
    expect(defaultDoers(item({ assignees: ['maya', 'leo'] }), 'member', 'leo')).toEqual(['leo']);
  });

  it('[BRD-07] in the Family view: the owner of their own item, a lone assignee, or ask', () => {
    expect(defaultDoers(item({ memberId: 'leo', assignees: ['leo'] }), 'family', 'leo')).toEqual([
      'leo',
    ]);
    expect(defaultDoers(item({ assignees: ['maya'] }), 'family', 'maya')).toEqual(['maya']);
    expect(defaultDoers(item({ assignees: ['maya', 'alex'] }), 'family', 'maya')).toBeNull();
  });

  it("[BRD-07][US-1006] the picker lists the item's people first, then everyone else", () => {
    const members = ['leo', 'maya', 'alex', 'sam'].map((id) => ({ id }));
    expect(pickerOrder(item({ assignees: ['maya', 'alex'] }), members).map((m) => m.id)).toEqual([
      'maya',
      'alex',
      'leo',
      'sam',
    ]);
  });
});

describe('what a check-off will do', () => {
  const earns = (id: string) => id === 'maya' || id === 'leo';

  it('[CHR-04][D-32] done at once, rewarding only those who earn rewards', () => {
    expect(optimistic(item({}), ['alex', 'maya'], earns)).toEqual({
      status: 'completed',
      doneBy: ['alex', 'maya'],
      rewarded: ['maya'],
    });
  });

  it('[CHR-05][D-32] waits for a parent when it needs approval and someone credited earns', () => {
    const homework = item({ requiresApproval: true });
    expect(optimistic(homework, ['maya'], earns).status).toBe('pending_approval');
    expect(optimistic(homework, ['alex'], earns).status).toBe('completed');
  });

  it("[PTS-01] a member holds an item's points only while it is done and theirs", () => {
    const done = { status: 'completed' as const, rewarded: ['maya'], points: 5 };
    expect(pointsHeld(done, 'maya')).toBe(5);
    expect(pointsHeld(done, 'leo')).toBe(0);
    expect(pointsHeld({ ...done, status: 'pending_approval' }, 'maya')).toBe(0);
  });

  it('[US-305][D-46] a check-off can be undone on the board until the window closes', () => {
    const done = item({ status: 'completed', doneBy: ['maya'], checkedAt: '2026-10-09T13:00:00Z' });
    expect(undoUntil(done, 120)).toBe(Date.parse('2026-10-09T13:02:00Z'));
    expect(undoUntil({ ...done, checkedAt: null }, 120)).toBeNull();
    expect(undoUntil({ ...done, status: 'approved' }, 120)).toBeNull();
    expect(undoUntil(item({}), 120)).toBeNull();
  });

  it('[US-303] progress counts done and waiting, and leaves skipped out', () => {
    expect(
      progress([
        item({ status: 'completed' }),
        item({ status: 'pending_approval' }),
        item({ status: 'scheduled' }),
        item({ status: 'skipped' }),
      ]),
    ).toEqual({ done: 2, total: 3 });
  });
});

describe('points on the board', () => {
  it('[PTS-02][D-50] says what each entry was for, and never why points were taken away', () => {
    expect(boardActivity({ type: 'earn', amount: 5, label: 'Make bed' })).toBe('Make bed');
    expect(boardActivity({ type: 'earn', amount: 7, label: null })).toBe('A chore');
    expect(boardActivity({ type: 'reversal', amount: -5, label: 'Make bed' })).toBe(
      'Make bed, undone',
    );
    expect(
      boardActivity({ type: 'adjustment', amount: 10, label: 'Helped carry the shopping' }),
    ).toBe('Helped carry the shopping');
    expect(boardActivity({ type: 'adjustment', amount: -5, label: 'Hit his sister' })).toBe(
      'A parent changed your points',
    );
  });
});
