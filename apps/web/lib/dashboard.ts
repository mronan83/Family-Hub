import { addDays, eventsOn, rangeFor } from './board-calendar';
import type { CalendarSpan } from './board-layout';
import type { BoardCalendar, BoardCalendarSource, BoardEvent, BoardSnapshot } from './snapshot';
import { isDone, isOpen, type SectionKey, sections, type TodayItem } from './today';

// [BRD-01][BRD-07][US-1006] The board's home screen as a family dashboard (WP-35, D-66): the
// calendar first, one list of today's items with the faces of whose they are, then cards for what is
// waiting for a parent and what is coming up. The per-person columns are the Chores screen now.

/** How a face on a row reads: still to do (on time, past its time, overdue), done, waiting for a
 * parent, done by someone else for them (a shared item), or skipped. */
export type ChipState = 'open' | 'late' | 'overdue' | 'done' | 'waiting' | 'covered' | 'skipped';

/** How a face's state reads in words: for a screen reader, and in "More info". */
export const CHIP_WORDS: Record<ChipState, string> = {
  open: 'to do',
  late: 'past its time',
  overdue: 'overdue',
  done: 'done',
  waiting: 'waiting for a parent',
  covered: 'done by someone else',
  skipped: 'skipped today',
};

/** One face on a row: a person and the item a tap checks off for them. */
export interface Chip {
  /** Whose face it is; null is "Anyone" (a shared item with nobody on it: a tap asks who). */
  memberId: string | null;
  item: TodayItem;
  state: ChipState;
}

/** One row of the list: an item, or an item everyone does their own (one face each). */
export interface ListRow {
  key: string;
  id: string;
  title: string;
  icon: string | null;
  points: number;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  chips: Chip[];
}

export interface ListSection {
  key: SectionKey;
  label: string;
  rows: ListRow[];
}

/** [CHR-11][CHR-12] A face's state, as its tile would read for that person. */
export function chipState(
  i: TodayItem,
  member: string | null,
  today: string,
  nowTime: string,
): ChipState {
  if (isDone(i)) {
    if (!i.memberId && member && i.doneBy.length > 0 && !i.doneBy.includes(member)) {
      return 'covered';
    }
    return i.status === 'pending_approval' ? 'waiting' : 'done';
  }
  if (isOpen(i)) {
    if (i.dueDate < today) return 'overdue';
    if (i.dueDate === today && i.dueTime && i.dueTime < nowTime) return 'late';
    return 'open';
  }
  return 'skipped';
}

/**
 * [BRD-07][D-66] Today's list: a row per item, grouped by part of the day with overdue tasks first.
 * An item everyone does their own is one row with a face each; a shared item shows the faces of its
 * people (a tap credits that person), or "Anyone" when nobody is on it, and once done, who did it.
 * Faces follow the board's order of people.
 */
export function familyList(
  items: TodayItem[],
  members: { id: string }[],
  today: string,
  nowTime: string,
): ListSection[] {
  const order = new Map(members.map((m, n) => [m.id, n]));
  const byPerson = (a: Chip, b: Chip) =>
    (a.memberId === null ? 1e9 : (order.get(a.memberId) ?? 1e6)) -
    (b.memberId === null ? 1e9 : (order.get(b.memberId) ?? 1e6));
  const groups = new Map<string, TodayItem[]>();
  for (const i of items) {
    const key = i.memberId ? `${i.choreId}:${i.dueDate}` : i.id;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const rows: ListRow[] = [...groups].map(([key, list]) => {
    const first = list[0]!;
    let chips: Chip[];
    if (first.memberId) {
      chips = list.map((i) => ({
        memberId: i.memberId,
        item: i,
        state: chipState(i, i.memberId, today, nowTime),
      }));
    } else if (first.assignees.length > 0) {
      chips = first.assignees.map((m) => ({
        memberId: m,
        item: first,
        state: chipState(first, m, today, nowTime),
      }));
    } else if (isDone(first) && first.doneBy.length > 0) {
      chips = first.doneBy.map((m) => ({
        memberId: m,
        item: first,
        state: chipState(first, m, today, nowTime),
      }));
    } else {
      chips = [{ memberId: null, item: first, state: chipState(first, null, today, nowTime) }];
    }
    return {
      key,
      id: key,
      title: first.title,
      icon: first.icon,
      points: first.points,
      description: first.description ?? null,
      dueDate: list.reduce((d, i) => (i.dueDate < d ? i.dueDate : d), first.dueDate),
      dueTime: first.dueTime,
      chips: chips.sort(byPerson),
    };
  });
  return sections(rows, today).map((s) => ({ key: s.key, label: s.label, rows: s.items }));
}

/** [BRD-05] The dates the dashboard's calendar shows: 3, 5 or 7 days from today, or today's month. */
export function spanDates(span: CalendarSpan, today: string, weekStart: number): string[] {
  if (span === 'month') return rangeFor('month', today, weekStart).days;
  return Array.from({ length: Number(span) }, (_, n) => addDays(today, n));
}

/** [CAL-05] The colors of the calendars with events on a date (a dot each in the month), up to four. */
export function dotsOn(
  events: BoardEvent[],
  date: string,
  calendars: Map<string, BoardCalendarSource>,
): string[] {
  const colors: string[] = [];
  for (const e of eventsOn(events, date)) {
    const c = calendars.get(e.calendarId)?.color;
    if (c && !colors.includes(c)) colors.push(c);
  }
  return colors.slice(0, 4);
}

/** What waits for a parent: a reward a child asked for, or a check-off to approve. */
export interface Waiting {
  key: string;
  memberIds: string[];
  text: string;
  cost: number | null;
}

/**
 * [PTS-04][CHR-05] Waiting for a parent: rewards asked for and not yet decided, then check-offs
 * waiting for approval. Parents decide them in the admin app.
 */
export function waitingFor(
  snapshot: Pick<BoardSnapshot, 'members'>,
  items: TodayItem[],
): Waiting[] {
  const asked: Waiting[] = snapshot.members.flatMap((m) =>
    m.requests
      .filter((r) => r.status === 'requested')
      .map((r) => ({ key: r.id, memberIds: [m.id], text: `Asked for ${r.title}`, cost: r.cost })),
  );
  const checks: Waiting[] = items
    .filter((i) => i.status === 'pending_approval')
    .map((i) => ({
      key: i.id,
      memberIds: i.doneBy,
      text: `${i.title}: check it’s done`,
      cost: null,
    }));
  return [...asked, ...checks];
}

/** One all-day event ahead, and how far off it is. */
export interface Upcoming {
  event: BoardEvent;
  date: string;
  days: number;
  calendar: BoardCalendarSource | undefined;
}

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * [CAL-04][D-66] Coming up: all-day events starting after today and within `days` (birthdays, trips,
 * no-school days), soonest first, at most `limit`.
 */
export function comingUp(
  cal: BoardCalendar | null,
  today: string,
  days = 21,
  limit = 5,
): Upcoming[] {
  if (!cal) return [];
  const calendars = new Map(cal.calendars.map((c) => [c.id, c]));
  const last = addDays(today, days);
  return cal.events
    .filter(
      (e) => e.allDay && calendars.has(e.calendarId) && e.startDate > today && e.startDate <= last,
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((e) => ({
      event: e,
      date: e.startDate,
      days: dayCount(today, e.startDate),
      calendar: calendars.get(e.calendarId),
    }));
}

/** "Tomorrow", "In 4 days". */
export function inDays(days: number): string {
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}
