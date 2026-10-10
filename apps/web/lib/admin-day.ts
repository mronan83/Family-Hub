import { createHash } from 'node:crypto';
import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { EventType } from './completions';

// A parent's day (WP-12, D-52): what they can do with each item, what each action records, and the
// words for it. Pure, so the rules are tested without a database; the pages draw what they return.
// Server code only (it hashes with node:crypto).

/** One occurrence as a parent sees it on the Today page or in My tasks. */
export interface DayItem {
  id: string;
  choreId: string;
  title: string;
  icon: string | null;
  kind: 'chore' | 'task';
  /** Household-local, YYYY-MM-DD. */
  dueDate: string;
  /** HH:MM, or null for anytime. */
  dueTime: string | null;
  /** Whose own it is (D-47); null when shared. */
  memberId: string | null;
  assignees: string[];
  status: OccurrenceStatus;
  doneBy: string[];
  points: number;
}

export type DayAction = 'done' | 'uncheck' | 'skip' | 'unskip' | 'approve' | 'reject';

/** [CHR-05][CHR-06] The completion event each action records (D-46): a parent's own kinds. */
export const EVENT_OF: Record<DayAction, EventType> = {
  done: 'admin_complete',
  uncheck: 'admin_uncomplete',
  skip: 'skip',
  unskip: 'admin_uncomplete',
  approve: 'approve',
  reject: 'reject',
};

export const isDone = (s: OccurrenceStatus) => s === 'completed' || s === 'approved';

/**
 * [CHR-05][CHR-06] What a parent can do with an item: mark an open, sent-back or missed one done
 * (a routine only once its day has come; a task any time) or skip it; uncheck one that is done;
 * approve or send back one waiting; put a skipped one back.
 */
export function actionsFor(
  i: Pick<DayItem, 'status' | 'kind' | 'dueDate'>,
  today: string,
): DayAction[] {
  switch (i.status) {
    case 'scheduled':
    case 'rejected':
    case 'missed':
      return i.kind === 'task' || i.dueDate <= today ? ['done', 'skip'] : ['skip'];
    case 'completed':
    case 'approved':
      return ['uncheck'];
    case 'pending_approval':
      return ['approve', 'reject'];
    case 'skipped':
      return ['unskip'];
  }
}

/** [CHR-09][D-47] Who "Mark done" credits without asking: its person, or its one assignee. */
export function doersFor(i: Pick<DayItem, 'memberId' | 'assignees'>): string[] | null {
  if (i.memberId) return [i.memberId];
  if (i.assignees.length === 1) return [...i.assignees];
  return null;
}

/**
 * [NFR-06] An event id made from the form's request id, the item and the action, so a form sent
 * twice (a double tap, a retry) records each event once.
 */
export function eventId(request: string, occurrence: string, action: string): string {
  const h = createHash('sha256').update(`${request}:${occurrence}:${action}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ACTIONS: readonly DayAction[] = ['done', 'uncheck', 'skip', 'unskip', 'approve', 'reject'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pressed button's value: "done:<id>" for one item, "batch" for the selected ones. */
export function parseAct(
  value: unknown,
): { action: DayAction; id: string } | { action: 'batch' } | null {
  if (value === 'batch') return { action: 'batch' };
  if (typeof value !== 'string') return null;
  const [action, id] = value.split(':');
  return ACTIONS.includes(action as DayAction) && id && GUID.test(id)
    ? { action: action as DayAction, id }
    : null;
}

/** [CHR-06] The line a parent sees after an action, in the admin's voice (06 §2). */
export function noticeFor(action: DayAction | 'batch', title: string, count = 1): string {
  switch (action) {
    case 'done':
      return `Marked ${title} done.`;
    case 'uncheck':
      return `Unchecked ${title}. Its points are taken back.`;
    case 'skip':
      return `Skipped ${title}. It won’t count for or against anyone.`;
    case 'unskip':
      return `${title} is back on the list.`;
    case 'approve':
      return `Approved ${title}.`;
    case 'reject':
      return `Sent ${title} back. It shows as open to try again.`;
    case 'batch':
      return count === 1
        ? 'Unchecked 1 item. Its points are taken back.'
        : `Unchecked ${count} items. Their points are taken back.`;
  }
}

/** [CHR-14][US-316] My tasks in three groups: overdue, today's, and the next days', each in order. */
export function myTaskGroups<
  T extends Pick<DayItem, 'id' | 'title' | 'dueDate' | 'dueTime' | 'kind' | 'status'>,
>(items: T[], today: string): { overdue: T[]; today: T[]; upcoming: T[] } {
  const order = (a: T, b: T) =>
    a.dueDate.localeCompare(b.dueDate) ||
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
  const sorted = [...items].sort(order);
  return {
    // Only a task is ever overdue (D-31); a past routine is done, missed or for a parent to settle.
    overdue: sorted.filter(
      (i) =>
        i.dueDate < today &&
        i.kind === 'task' &&
        (i.status === 'scheduled' || i.status === 'rejected'),
    ),
    today: sorted.filter((i) => i.dueDate === today),
    upcoming: sorted.filter((i) => i.dueDate > today),
  };
}
