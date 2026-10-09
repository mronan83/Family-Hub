import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { DisplayState } from '@familywise/ui';
import { DAY_PART_LABELS, DAY_PARTS, dayPart, type DayPart } from './chores';
import type { LedgerEntry } from './points';

/**
 * [BRD-01][BRD-07][CHR-04][CHR-11][CHR-12] The board's Today (WP-11, D-50): today's items and the
 * open overdue tasks from the snapshot, as each person sees them. Pure functions, so the rules are
 * tested without a browser; the board's screen draws what they return.
 */
export interface TodayItem {
  id: string;
  choreId: string;
  title: string;
  icon: string | null;
  kind: 'chore' | 'task';
  /** Household-local date, YYYY-MM-DD. */
  dueDate: string;
  /** Household-local time, HH:MM, or null for anytime. */
  dueTime: string | null;
  /** Whose own item this is when everyone does their own (D-47); null when it is shared. */
  memberId: string | null;
  /** Who was responsible that day. */
  assignees: string[];
  status: OccurrenceStatus;
  doneBy: string[];
  rewarded: string[];
  points: number;
  requiresApproval: boolean;
  /** When the check-off it shows was made (ISO), for undoing it on the board. */
  checkedAt: string | null;
}

/** Statuses a tap can check off: not done yet, or sent back. */
export const OPEN: readonly OccurrenceStatus[] = ['scheduled', 'rejected'];
/** Statuses that count as done for the day's progress (waiting for a parent counts: it was done). */
const DONE: readonly OccurrenceStatus[] = ['completed', 'approved', 'pending_approval'];

export const isOpen = (i: TodayItem) => OPEN.includes(i.status);
export const isDone = (i: TodayItem) => DONE.includes(i.status);

/** One person's items: their own, and the shared ones they are responsible for. */
export function itemsFor(items: TodayItem[], memberId: string): TodayItem[] {
  return items.filter((i) =>
    i.memberId ? i.memberId === memberId : i.assignees.includes(memberId),
  );
}

export type SectionKey = 'overdue' | DayPart;

export interface Section {
  key: SectionKey;
  label: string;
  items: TodayItem[];
}

/**
 * [CHR-11][CHR-12] The day in parts (morning, after school, evening, anytime) by due time, with
 * overdue tasks first. Within a part: by due time, then title. Empty parts are left out.
 */
export function sections(items: TodayItem[], today: string): Section[] {
  const byTime = (a: TodayItem, b: TodayItem) =>
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
  const overdue = items
    .filter((i) => i.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || byTime(a, b));
  const out: Section[] = overdue.length
    ? [{ key: 'overdue', label: 'Overdue', items: overdue }]
    : [];
  for (const part of DAY_PARTS) {
    const inPart = items
      .filter((i) => i.dueDate >= today && dayPart(i.dueTime) === part)
      .sort(byTime);
    if (inPart.length) out.push({ key: part, label: DAY_PART_LABELS[part], items: inPart });
  }
  return out;
}

export interface TileView {
  status: OccurrenceStatus;
  display?: DisplayState;
  /** Who did it, when that is worth saying. */
  doneBy?: string;
  /** Who did it for this person, for a shared item they were covered on. */
  coveredBy?: string;
}

/** "Maya", "Maya and Leo", "Maya, Leo and Sam". */
export function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * [CHR-11][CHR-12][D-30] How a tile reads for one person (06 §7.1): covered when someone else did a
 * shared item for them; who did it when it wasn't just them; overdue for a task from before today;
 * past its time for today's open item after its due time. `nowTime` is the household's HH:MM.
 */
export function tileView(
  i: TodayItem,
  viewer: string,
  today: string,
  nowTime: string,
  name: (id: string) => string,
): TileView {
  const who = nameList(i.doneBy.map(name));
  if (isDone(i) && i.doneBy.length > 0) {
    if (!i.memberId && !i.doneBy.includes(viewer)) {
      return { status: i.status, display: 'covered', coveredBy: who };
    }
    const justMe = i.doneBy.length === 1 && i.doneBy[0] === viewer;
    return { status: i.status, doneBy: justMe ? undefined : who };
  }
  if (isOpen(i) && i.dueDate < today) return { status: i.status, display: 'overdue' };
  if (isOpen(i) && i.dueDate === today && i.dueTime && i.dueTime < nowTime) {
    return { status: i.status, display: 'past-time' };
  }
  return { status: i.status };
}

/**
 * [CHR-04][D-46] Who a tap credits without asking. On a person's own screen it is them (US-304); in
 * the Family view it is the person whose item it is, or its one assignee. A shared item with several
 * people asks (null): the who-did-it picker.
 */
export function defaultDoers(
  i: TodayItem,
  view: 'member' | 'family',
  column: string,
): string[] | null {
  if (view === 'member') return [column];
  if (i.memberId) return [i.memberId];
  if (i.assignees.length === 1) return [...i.assignees];
  return null;
}

/** The who-did-it picker's order: the item's people first, then everyone else, each as listed. */
export function pickerOrder<M extends { id: string }>(i: TodayItem, members: M[]): M[] {
  const mine = members.filter((m) => i.assignees.includes(m.id) || m.id === i.memberId);
  return [...mine, ...members.filter((m) => !mine.includes(m))];
}

/**
 * [CHR-05][D-32] What the database will make of a check-off, so the tile can show it at once (06:
 * feedback within 120 ms): waiting for a parent when the item needs approval and someone credited
 * earns rewards; otherwise done. Only those who earn rewards are rewarded.
 */
export function optimistic(
  i: TodayItem,
  doneBy: string[],
  earns: (id: string) => boolean,
): Pick<TodayItem, 'status' | 'doneBy' | 'rewarded'> {
  const rewarded = doneBy.filter(earns).sort();
  return {
    status: i.requiresApproval && rewarded.length > 0 ? 'pending_approval' : 'completed',
    doneBy: [...doneBy].sort(),
    rewarded,
  };
}

/** [PTS-01] Points a member holds for an item as it stands: its points while done and theirs. */
export function pointsHeld(
  i: Pick<TodayItem, 'status' | 'rewarded' | 'points'>,
  member: string,
): number {
  return (i.status === 'completed' || i.status === 'approved') && i.rewarded.includes(member)
    ? i.points
    : 0;
}

/**
 * [US-305][D-46] Until when the board may undo the check-off this item shows (ms since epoch), or
 * null: a board undoes only its own kind of event (a check-off), within the household's window,
 * judged by when the check-off happened.
 */
export function undoUntil(i: TodayItem, windowSeconds: number): number | null {
  if (!(i.status === 'completed' || i.status === 'pending_approval') || !i.checkedAt) return null;
  return Date.parse(i.checkedAt) + windowSeconds * 1000;
}

/** [US-303] The day's progress for a person: done (or waiting for a parent) of what counts. */
export function progress(items: TodayItem[]): { done: number; total: number } {
  const counted = items.filter((i) => i.status !== 'skipped');
  return { done: counted.filter(isDone).length, total: counted.length };
}

/**
 * [PTS-02][D-50] A points entry on the board, in the board's voice (06 §2): what it was for, never a
 * telling-off. Points a parent took away say only that a parent changed them; the reason stays in
 * the admin history. An item the board may not see (private) is just "A chore".
 */
export function boardActivity(e: Pick<LedgerEntry, 'type' | 'amount' | 'label'>): string {
  const item = e.label ?? 'A chore';
  switch (e.type) {
    case 'earn':
      return item;
    case 'reversal':
      return `${item}, undone`;
    case 'adjustment':
      return e.amount > 0 ? (e.label ?? 'From a parent') : 'A parent changed your points';
    case 'bonus':
      return e.label ?? 'Bonus';
    case 'spend':
      return e.label ?? 'Spent';
    case 'refund':
      return e.label ?? 'Points back';
  }
}
