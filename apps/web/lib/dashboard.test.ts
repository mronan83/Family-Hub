import { describe, expect, it } from 'vitest';
import {
  chipState,
  comingUp,
  dotsOn,
  familyList,
  inDays,
  spanDates,
  waitingFor,
} from './dashboard';
import type { BoardCalendar, BoardEvent, BoardMember } from './snapshot';
import type { TodayItem } from './today';

// [BRD-01][BRD-07][US-1006] The family dashboard (WP-35, D-66): one list of today's items with the
// faces of whose they are, the calendar's dates, and the cards under it.
const TODAY = '2026-10-13';
const LEO = 'leo';
const MAYA = 'maya';
const ALEX = 'alex';
const members = [{ id: LEO }, { id: MAYA }, { id: ALEX }];
const item = (id: string, o: Partial<TodayItem> = {}): TodayItem => ({
  id,
  choreId: `c-${id}`,
  title: id,
  icon: null,
  kind: 'chore',
  dueDate: TODAY,
  dueTime: null,
  memberId: null,
  assignees: [],
  status: 'scheduled',
  doneBy: [],
  rewarded: [],
  points: 5,
  requiresApproval: false,
  checkedAt: null,
  ...o,
});

describe('today’s list', () => {
  it('[BRD-07][D-66] an item everyone does their own is one row with a face each, in the board’s order', () => {
    const [part] = familyList(
      [
        item('bed-maya', { choreId: 'bed', title: 'Make bed', memberId: MAYA, assignees: [MAYA] }),
        item('bed-leo', {
          choreId: 'bed',
          title: 'Make bed',
          memberId: LEO,
          assignees: [LEO],
          status: 'completed',
          doneBy: [LEO],
        }),
      ],
      members,
      TODAY,
      '12:00',
    );
    expect(part?.rows).toHaveLength(1);
    expect(part?.rows[0]?.chips.map((c) => [c.memberId, c.state, c.item.id])).toEqual([
      [LEO, 'done', 'bed-leo'],
      [MAYA, 'open', 'bed-maya'],
    ]);
  });

  it('[CHR-04] a shared item shows its people (a tap credits that one), or "Anyone"; done, who did it', () => {
    const [part] = familyList(
      [
        item('dog', { title: 'Feed the dog', assignees: [ALEX, MAYA] }),
        item('bins', { title: 'Bins' }),
        item('plants', { title: 'Plants', status: 'completed', doneBy: [LEO] }),
      ],
      members,
      TODAY,
      '12:00',
    );
    const faces = (title: string) =>
      part?.rows.find((r) => r.title === title)?.chips.map((c) => [c.memberId, c.state]);
    expect(faces('Feed the dog')).toEqual([
      [MAYA, 'open'],
      [ALEX, 'open'],
    ]);
    expect(faces('Bins')).toEqual([[null, 'open']]);
    expect(faces('Plants')).toEqual([[LEO, 'done']]);
  });

  it('[CHR-11][CHR-12] grouped by part of the day, overdue first; a face says how it stands', () => {
    const list = familyList(
      [
        item('books', {
          title: 'Return books',
          kind: 'task',
          dueDate: '2026-10-11',
          assignees: [MAYA],
        }),
        item('table', { title: 'Set the table', dueTime: '17:30', assignees: [LEO] }),
        item('bed', { title: 'Make bed', dueTime: '07:30', assignees: [LEO] }),
      ],
      members,
      TODAY,
      '16:00',
    );
    expect(list.map((s) => [s.label, s.rows.map((r) => r.title)])).toEqual([
      ['Overdue', ['Return books']],
      ['Morning', ['Make bed']],
      ['Evening', ['Set the table']],
    ]);
    expect(list.map((s) => s.rows[0]?.chips[0]?.state)).toEqual(['overdue', 'late', 'open']);
  });

  it('[CHR-05][D-30] waiting for a parent, done for someone else, or skipped', () => {
    const shared = item('dog', { assignees: [ALEX, MAYA], status: 'completed', doneBy: [MAYA] });
    expect(chipState(shared, ALEX, TODAY, '12:00')).toBe('covered');
    expect(chipState(shared, MAYA, TODAY, '12:00')).toBe('done');
    expect(
      chipState(item('hw', { status: 'pending_approval', doneBy: [MAYA] }), MAYA, TODAY, '12:00'),
    ).toBe('waiting');
    expect(chipState(item('x', { status: 'skipped' }), null, TODAY, '12:00')).toBe('skipped');
  });
});

describe('the calendar panel', () => {
  it('[BRD-05] three, five or seven days from today, or today’s month as whole weeks', () => {
    expect(spanDates('3', TODAY, 0)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
    expect(spanDates('5', TODAY, 0)).toHaveLength(5);
    const month = spanDates('month', TODAY, 0);
    expect([month[0], month.at(-1), month.length]).toEqual(['2026-09-27', '2026-10-31', 35]);
  });

  it('[CAL-05] a dot per calendar with something on a day, up to four', () => {
    const calendars = new Map(
      ['a', 'b', 'c', 'd', 'e'].map((id, n) => [
        id,
        {
          id,
          name: id,
          color: `member-${n + 1}` as BoardCalendar['calendars'][number]['color'],
          memberId: null,
          status: 'ok' as const,
          lastSuccessAt: null,
        },
      ]),
    );
    const ev = (id: string, cal: string): BoardEvent => ({
      id,
      calendarId: cal,
      title: id,
      allDay: true,
      start: '',
      end: '',
      startDate: TODAY,
      endDate: TODAY,
      changed: false,
    });
    expect(dotsOn([ev('1', 'a'), ev('2', 'a'), ev('3', 'b')], TODAY, calendars)).toEqual([
      'member-1',
      'member-2',
    ]);
    expect(
      dotsOn(
        ['a', 'b', 'c', 'd', 'e'].map((c) => ev(c, c)),
        TODAY,
        calendars,
      ),
    ).toHaveLength(4);
    expect(dotsOn([ev('1', 'a')], '2026-10-14', calendars)).toEqual([]);
  });
});

describe('the cards', () => {
  it('[PTS-04][CHR-05] waiting for a parent: rewards asked for, then check-offs to approve', () => {
    const maya = {
      id: MAYA,
      requests: [
        {
          id: 'r1',
          itemId: 'i',
          title: 'Pick the dinner',
          icon: 'utensils',
          cost: 30,
          status: 'requested',
          at: '',
        },
        {
          id: 'r2',
          itemId: 'j',
          title: 'Ice cream',
          icon: 'snack',
          cost: 40,
          status: 'denied',
          at: '',
        },
      ],
    } as unknown as BoardMember;
    expect(
      waitingFor({ members: [maya] }, [
        item('hw', { title: 'Homework', status: 'pending_approval', doneBy: [MAYA] }),
        item('bed', { title: 'Make bed', status: 'completed', doneBy: [MAYA] }),
      ]),
    ).toEqual([
      { key: 'r1', memberIds: [MAYA], text: 'Asked for Pick the dinner', cost: 30 },
      { key: 'hw', memberIds: [MAYA], text: 'Homework: check it’s done', cost: null },
    ]);
  });

  it('[CAL-04][D-66] coming up: all-day events after today within three weeks, soonest first', () => {
    const allDay = (id: string, date: string, cal = 'fam'): BoardEvent => ({
      id,
      calendarId: cal,
      title: id,
      allDay: true,
      start: '',
      end: '',
      startDate: date,
      endDate: date,
      changed: false,
    });
    const cal: BoardCalendar = {
      from: '2026-10-12',
      to: '2026-11-03',
      calendars: [
        {
          id: 'fam',
          name: 'Family',
          color: 'member-6',
          memberId: null,
          status: 'ok',
          lastSuccessAt: null,
        },
      ],
      events: [
        allDay('Party', '2026-10-17'),
        allDay('Today', TODAY),
        allDay('Trip', '2026-10-14'),
        allDay('Far', '2026-11-04'),
        allDay('Hidden', '2026-10-15', 'gone'),
        { ...allDay('Swim', '2026-10-16'), allDay: false },
      ],
    };
    expect(comingUp(cal, TODAY).map((u) => [u.event.title, u.days])).toEqual([
      ['Trip', 1],
      ['Party', 4],
    ]);
    expect(comingUp(null, TODAY)).toEqual([]);
    expect([inDays(1), inDays(4)]).toEqual(['Tomorrow', 'In 4 days']);
  });
});
