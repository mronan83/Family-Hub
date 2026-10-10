import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  doersFor,
  EVENT_OF,
  eventId,
  myTaskGroups,
  noticeFor,
  parseAct,
} from './admin-day';

const TODAY = '2026-10-09';
const ID = '0de00000-0000-4000-8000-0000000c0001';

describe('a parent’s actions', () => {
  it('[CHR-06] an open, sent-back or missed item can be marked done or skipped', () => {
    for (const status of ['scheduled', 'rejected', 'missed'] as const) {
      expect(actionsFor({ status, kind: 'chore', dueDate: TODAY }, TODAY)).toEqual([
        'done',
        'skip',
      ]);
    }
    // Late credit for a past day.
    expect(actionsFor({ status: 'missed', kind: 'chore', dueDate: '2026-10-05' }, TODAY)).toEqual([
      'done',
      'skip',
    ]);
  });

  it('[CHR-06][D-31] a routine is done no sooner than its day (it may be skipped ahead); a task any time', () => {
    expect(
      actionsFor({ status: 'scheduled', kind: 'chore', dueDate: '2026-10-10' }, TODAY),
    ).toEqual(['skip']);
    expect(actionsFor({ status: 'scheduled', kind: 'task', dueDate: '2026-10-12' }, TODAY)).toEqual(
      ['done', 'skip'],
    );
  });

  it('[CHR-05][CHR-06] done can be unchecked, waiting approved or sent back, skipped put back', () => {
    const at = { kind: 'chore' as const, dueDate: TODAY };
    expect(actionsFor({ ...at, status: 'completed' }, TODAY)).toEqual(['uncheck']);
    expect(actionsFor({ ...at, status: 'approved' }, TODAY)).toEqual(['uncheck']);
    expect(actionsFor({ ...at, status: 'pending_approval' }, TODAY)).toEqual(['approve', 'reject']);
    expect(actionsFor({ ...at, status: 'skipped' }, TODAY)).toEqual(['unskip']);
  });

  it('[CHR-06][D-46] each action records a parent’s kind of event', () => {
    expect(EVENT_OF).toEqual({
      done: 'admin_complete',
      uncheck: 'admin_uncomplete',
      skip: 'skip',
      unskip: 'admin_uncomplete',
      approve: 'approve',
      reject: 'reject',
    });
  });

  it('[CHR-09][D-47] marking done credits the item’s person, or its one assignee; several means asking', () => {
    expect(doersFor({ memberId: 'maya', assignees: ['maya'] })).toEqual(['maya']);
    expect(doersFor({ memberId: null, assignees: ['leo'] })).toEqual(['leo']);
    expect(doersFor({ memberId: null, assignees: ['maya', 'alex'] })).toBeNull();
  });
});

describe('forms', () => {
  it('[NFR-06] the same form, item and action always make the same event id; anything else a new one', () => {
    const a = eventId('req-1', ID, 'admin_complete');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(eventId('req-1', ID, 'admin_complete')).toBe(a);
    expect(eventId('req-2', ID, 'admin_complete')).not.toBe(a);
    expect(eventId('req-1', ID, 'skip')).not.toBe(a);
  });

  it('[CHR-06][CHR-08] reads which button was pressed, and nothing it does not know', () => {
    expect(parseAct(`done:${ID}`)).toEqual({ action: 'done', id: ID });
    expect(parseAct(`reject:${ID}`)).toEqual({ action: 'reject', id: ID });
    expect(parseAct('batch')).toEqual({ action: 'batch' });
    for (const bad of [
      null,
      '',
      'done',
      `delete:${ID}`,
      'done:not-an-id',
      `done:${ID}:x`.slice(0, 5),
    ]) {
      expect(parseAct(bad)).toBeNull();
    }
  });

  it('[CHR-08] says what was done, plainly', () => {
    expect(noticeFor('batch', '', 4)).toBe('Unchecked 4 items. Their points are taken back.');
    expect(noticeFor('batch', '', 1)).toBe('Unchecked 1 item. Its points are taken back.');
    expect(noticeFor('reject', 'Homework')).toBe(
      'Sent Homework back. It shows as open to try again.',
    );
    expect(noticeFor('done', 'Make bed')).toBe('Marked Make bed done.');
    for (const a of ['uncheck', 'skip', 'unskip', 'approve'] as const) {
      expect(noticeFor(a, 'Dishes')).toContain('Dishes');
    }
  });
});

describe('My tasks', () => {
  const item = (
    id: string,
    dueDate: string,
    o: Partial<Parameters<typeof myTaskGroups>[0][0]> = {},
  ) => ({
    id,
    title: id,
    dueDate,
    dueTime: null,
    kind: 'task' as const,
    status: 'scheduled' as const,
    ...o,
  });

  it('[CHR-14][US-316] overdue first, then today’s, then the next days’, each by date and time', () => {
    const g = myTaskGroups(
      [
        item('later', '2026-10-12'),
        item('evening', TODAY, { dueTime: '18:00' }),
        item('old', '2026-10-01'),
        item('morning', TODAY, { dueTime: '07:30' }),
        item('anytime', TODAY),
        item('tomorrow', '2026-10-10'),
        item('older', '2026-09-28'),
      ],
      TODAY,
    );
    expect(g.overdue.map((i) => i.id)).toEqual(['older', 'old']);
    expect(g.today.map((i) => i.id)).toEqual(['morning', 'evening', 'anytime']);
    expect(g.upcoming.map((i) => i.id)).toEqual(['tomorrow', 'later']);
  });

  it('[CHR-14][D-31] only open tasks are overdue: a past routine or a done task is not', () => {
    const g = myTaskGroups(
      [
        item('routine', '2026-10-05', { kind: 'chore', status: 'missed' }),
        item('done', '2026-10-05', { status: 'completed' }),
        item('sent back', '2026-10-05', { status: 'rejected' }),
      ],
      TODAY,
    );
    expect(g.overdue.map((i) => i.id)).toEqual(['sent back']);
  });
});
