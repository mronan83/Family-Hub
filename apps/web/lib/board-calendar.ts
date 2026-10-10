import type { BoardCalendar, BoardCalendarSource, BoardEvent } from './snapshot';
import { time } from './format';

// [CAL-04][CAL-07] The board's calendar screen (WP-23): which dates a day, week or month shows, how to
// step between them, and what each event says. Dates are household-local YYYY-MM-DD throughout, so an
// all-day event sits on its own dates whatever zone the board's clock is in.

export type CalendarView = 'day' | 'week' | 'month';

/** How many events a month's day shows before "+N more". */
export const MONTH_SHOWN = 3;
/** A calendar not synced for three of its 15-minute intervals is behind (01 §7). */
export const BEHIND_MS = 45 * 60_000;

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

export function addDays(date: string, n: number): string {
  return new Date(noon(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return noon(date).getUTCDay();
}

/** The first day of the household's week holding `date` (`weekStart` 0–6, 0 = Sunday). */
export function weekStartOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * The dates a view shows around `anchor`: the day; its week; or its month as whole weeks (five or
 * six rows), so the grid starts on the household's first weekday.
 */
export function rangeFor(
  view: CalendarView,
  anchor: string,
  weekStart: number,
): { from: string; to: string; days: string[] } {
  if (view === 'day') return { from: anchor, to: anchor, days: [anchor] };
  if (view === 'week') {
    const from = weekStartOf(anchor, weekStart);
    const to = addDays(from, 6);
    return { from, to, days: daysFrom(from, to) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const last = addDays(`${nextMonth(first)}`, -1);
  const from = weekStartOf(first, weekStart);
  const to = addDays(weekStartOf(last, weekStart), 6);
  return { from, to, days: daysFrom(from, to) };
}

function nextMonth(first: string): string {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
function prevMonth(first: string): string {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/** The anchor one day, week or month on (`dir` 1) or back (-1); months land on their first day. */
export function step(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  const first = `${anchor.slice(0, 7)}-01`;
  return dir === 1 ? nextMonth(first) : prevMonth(first);
}

/** Whether a calendar already read covers these dates (the snapshot's, or one fetched). */
export function covers(cal: BoardCalendar | null, from: string, to: string): boolean {
  return cal !== null && cal.from <= from && to <= cal.to;
}

/** The events on a date: all-day ones first, then by start, then title. */
export function eventsOn(events: BoardEvent[], date: string): BoardEvent[] {
  return events
    .filter((e) => e.startDate <= date && date <= e.endDate)
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        a.start.localeCompare(b.start) ||
        a.title.localeCompare(b.title),
    );
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });

/** "Tuesday, October 20", "Oct 18 – 24", "Oct 25 – Nov 1", "October 2026". */
export function heading(view: CalendarView, anchor: string, weekStart: number): string {
  if (view === 'day')
    return fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(noon(anchor));
  if (view === 'month') return fmt({ month: 'long', year: 'numeric' }).format(noon(anchor));
  const { from, to } = rangeFor('week', anchor, weekStart);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = fmt({ month: 'short', day: 'numeric' }).format(noon(from));
  const end = sameMonth
    ? fmt({ day: 'numeric' }).format(noon(to))
    : fmt({ month: 'short', day: 'numeric' }).format(noon(to));
  return `${start} – ${end}`;
}

/** "Tue, Oct 20": a date's name in short. */
export function dayName(date: string): string {
  return fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(noon(date));
}

/**
 * What an event says for its time on a date: "All day"; its start ("5:00 pm"); or, on a later day of
 * an event that runs past midnight, "Until 1:00 am" (or "All day" for a middle day).
 */
export function eventWhen(e: BoardEvent, date: string, timeZone: string): string {
  if (e.allDay) return 'All day';
  if (e.startDate === date) return time(e.start, timeZone);
  return e.endDate === date ? `Until ${time(e.end, timeZone)}` : 'All day';
}

/** The calendars whose sync is failing or behind: their events are the last good ones (CAL-06). */
export function behind(calendars: BoardCalendarSource[], now: Date): BoardCalendarSource[] {
  return calendars.filter(
    (c) =>
      c.status === 'error' ||
      (c.status === 'ok' &&
        c.lastSuccessAt !== null &&
        now.getTime() - Date.parse(c.lastSuccessAt) > BEHIND_MS),
  );
}
