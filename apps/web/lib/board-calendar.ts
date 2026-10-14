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

/**
 * [CAL-05][WP-65] A range read earlier, brought up to the snapshot read since. The snapshot is the
 * board's newest read: its calendars are the ones this board shows now, and its events are the
 * current ones on every date it covers. So an earlier read keeps only its events on the snapshot's
 * calendars that lie wholly outside the snapshot's dates, and the snapshot gives the rest. A week
 * that starts before yesterday (the snapshot's first date) shows a calendar unticked, or an event
 * moved, as soon as the snapshot has it, without waiting for the range to be read again.
 */
export function withSnapshot(
  fetched: BoardCalendar,
  snapshot: BoardCalendar | null,
): BoardCalendar {
  if (!snapshot) return fetched;
  const shown = new Set(snapshot.calendars.map((c) => c.id));
  const outside = (e: BoardEvent) => e.endDate < snapshot.from || e.startDate > snapshot.to;
  const inRange = (e: BoardEvent) => e.startDate <= fetched.to && e.endDate >= fetched.from;
  const fresh = snapshot.events.filter(inRange);
  const ids = new Set(fresh.map((e) => e.id));
  const kept = fetched.events.filter(
    (e) => shown.has(e.calendarId) && outside(e) && !ids.has(e.id),
  );
  return {
    from: fetched.from,
    to: fetched.to,
    calendars: snapshot.calendars,
    events: [...fresh, ...kept].sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        Number(b.allDay) - Number(a.allDay) ||
        a.start.localeCompare(b.start) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    ),
  };
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

// ---------------------------------------------------------------------------------------------
// [CAL-04][CAL-10] The time grid (WP-52, D-82): all-day events in lanes across the days, timed ones
// by the hour, as Apple Calendar lays them out. The home screen's card lines up the hours that have
// something on; the Calendar's Week and Day draw the hours to scale.
// ---------------------------------------------------------------------------------------------

/** A timed event's piece on one shown day: hours from that day's midnight (16.5 = 4:30 pm). */
export interface Piece {
  event: BoardEvent;
  /** The shown day's index. */
  day: number;
  start: number;
  end: number;
  /** It began on an earlier day (a late flight's piece after midnight). */
  continued: boolean;
}

/** An all-day event (or one lasting a day or more) as one bar over the shown days it covers. */
export interface Bar {
  event: BoardEvent;
  lane: number;
  /** The first and last shown day's indexes. */
  from: number;
  to: number;
}

const HOUR_PARTS = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock hour of an instant in a zone, as a number (16.5 = 4:30 pm). */
export function hourIn(at: string, timeZone: string): number {
  let f = HOUR_PARTS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
      timeZone,
    });
    HOUR_PARTS.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return n('hour') + n('minute') / 60;
}

/** Whether an event goes in the all-day lanes: an all-day one, or a timed one of a day or more. */
export function onAllDayLane(e: BoardEvent): boolean {
  return e.allDay || Date.parse(e.end) - Date.parse(e.start) >= 86_400_000;
}

/**
 * The shown days' events, split: the ones for the all-day lanes, and the timed ones as pieces, one
 * for each day they touch (a late flight is 10:30 pm to midnight, then midnight to 1 am).
 */
export function splitDays(
  events: BoardEvent[],
  days: string[],
  timeZone: string,
): { allDay: BoardEvent[]; pieces: Piece[] } {
  const first = days[0]!;
  const last = days.at(-1)!;
  const shown = events.filter((e) => e.startDate <= last && e.endDate >= first);
  const pieces: Piece[] = [];
  for (const e of shown) {
    if (onAllDayLane(e)) continue;
    days.forEach((d, i) => {
      if (d < e.startDate || d > e.endDate) return;
      const start = d === e.startDate ? hourIn(e.start, timeZone) : 0;
      const end = d === e.endDate ? hourIn(e.end, timeZone) || 24 : 24;
      pieces.push({
        event: e,
        day: i,
        start,
        end: Math.max(end, start),
        continued: d !== e.startDate,
      });
    });
  }
  pieces.sort(
    (a, b) =>
      a.day - b.day ||
      a.start - b.start ||
      b.end - a.end ||
      a.event.title.localeCompare(b.event.title),
  );
  return { allDay: shown.filter(onAllDayLane), pieces };
}

/**
 * [D-82] All-day events in at most `max` lanes: each is one bar from its first shown day to its
 * last, those starting first and then the longest placed first; one that finds no lane counts on
 * each of its days ("+N" on the day).
 */
export function allDayLanes(
  events: BoardEvent[],
  days: string[],
  max: number,
): { bars: Bar[]; more: number[] } {
  const first = days[0]!;
  const last = days.at(-1)!;
  const index = (d: string) => days.indexOf(d < first ? first : d > last ? last : d);
  const spans = events
    .filter((e) => e.startDate <= last && e.endDate >= first)
    .map((event) => ({
      event,
      from: index(event.startDate),
      to: index(event.endDate),
      days: Date.parse(event.endDate) - Date.parse(event.startDate),
    }))
    .sort(
      (a, b) => a.from - b.from || b.days - a.days || a.event.title.localeCompare(b.event.title),
    );
  const lanes: { from: number; to: number }[][] = Array.from({ length: max }, () => []);
  const more = days.map(() => 0);
  const bars: Bar[] = [];
  for (const s of spans) {
    const lane = lanes.findIndex((l) => l.every((o) => o.to < s.from || o.from > s.to));
    if (lane < 0) {
      for (let d = s.from; d <= s.to; d++) more[d]!++;
      continue;
    }
    lanes[lane]!.push(s);
    bars.push({ event: s.event, from: s.from, to: s.to, lane });
  }
  return { bars, more };
}

/** A day's events starting in one of the home screen's hour rows, and how many rows they reach down. */
export interface RowGroup {
  day: number;
  row: number;
  span: number;
  pieces: Piece[];
}

/**
 * [D-82] The home screen's hours: a row for each hour something starts in, lined up across the shown
 * days. A day's events starting in an hour sit together in its row and reach down the rows until
 * they end, short of the day's next ones.
 */
export function hourRows(pieces: Piece[]): { hours: number[]; groups: RowGroup[] } {
  const hours = [...new Set(pieces.map((p) => Math.floor(p.start)))].sort((a, b) => a - b);
  const byCell = new Map<string, RowGroup>();
  for (const p of pieces) {
    const row = hours.indexOf(Math.floor(p.start));
    const key = `${p.day}:${row}`;
    const group = byCell.get(key) ?? { day: p.day, row, span: 1, pieces: [] };
    group.pieces.push(p);
    byCell.set(key, group);
  }
  const groups = [...byCell.values()].sort((a, b) => a.day - b.day || a.row - b.row);
  for (const g of groups) {
    const end = Math.max(...g.pieces.map((p) => p.end));
    const next = groups.find((o) => o.day === g.day && o.row > g.row)?.row ?? hours.length;
    let last = g.row;
    while (last + 1 < next && hours[last + 1]! < end) last++;
    g.span = last - g.row + 1;
  }
  return { hours, groups };
}

/**
 * Where now falls among the home screen's hour rows: its row and how far down it (0–1). Between
 * rows, the top of the next; after the last, its foot. Null when there are no rows.
 */
export function nowInRows(hours: number[], now: number): { row: number; at: number } | null {
  if (!hours.length) return null;
  const row = hours.indexOf(Math.floor(now));
  if (row >= 0) return { row, at: now - Math.floor(now) };
  const next = hours.findIndex((h) => h > now);
  return next >= 0 ? { row: next, at: 0 } : { row: hours.length - 1, at: 1 };
}

/**
 * [D-82] The hours the Week and Day grids draw: 8 am to 8 pm at least, stretched to the events shown
 * and, when today is shown, to now, so its line is always there (6 am: from 6 am). The part of an
 * event carried over from the day before (a late flight after midnight) doesn't stretch it: it is
 * drawn from the top.
 */
export function gridHours(pieces: Piece[], now?: number): { from: number; to: number } {
  const starts = pieces.filter((p) => !p.continued).map((p) => Math.floor(p.start));
  const ends = pieces.map((p) => Math.ceil(p.end));
  if (now !== undefined) {
    starts.push(Math.floor(now));
    ends.push(Math.ceil(now));
  }
  const from = Math.min(8, ...starts);
  const to = Math.min(24, Math.max(20, ...ends));
  return { from, to };
}

/** "Oct 11 – 15", "Oct 30 – Nov 3": the dates the home screen's calendar shows. */
export function spanRange(from: string, to: string): string {
  const short = fmt({ month: 'short', day: 'numeric' });
  const end =
    from.slice(0, 7) === to.slice(0, 7)
      ? fmt({ day: 'numeric' }).format(noon(to))
      : short.format(noon(to));
  return `${short.format(noon(from))} – ${end}`;
}

/** A piece placed in its day: column `col` of `cols` side by side. */
export interface Placed extends Piece {
  col: number;
  cols: number;
}

/**
 * [D-82] Events that overlap on a day sit side by side, as many columns as the most at once. A short
 * one counts as `minHours` long, since it is drawn that tall.
 */
export function sideBySide(pieces: Piece[], minHours = 0.5): Placed[] {
  const placed: Placed[] = [];
  const reach = (p: Piece) => Math.max(p.end, p.start + minHours);
  const days = [...new Set(pieces.map((p) => p.day))];
  for (const day of days) {
    const list = pieces
      .filter((p) => p.day === day)
      .sort((a, b) => a.start - b.start || reach(b) - reach(a));
    let cluster: Placed[] = [];
    let clusterEnd = -1;
    const close = () => {
      const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
      for (const p of cluster) p.cols = cols;
      placed.push(...cluster);
      cluster = [];
    };
    for (const p of list) {
      if (cluster.length && p.start >= clusterEnd) close();
      const taken = new Set(cluster.filter((o) => reach(o) > p.start).map((o) => o.col));
      let col = 0;
      while (taken.has(col)) col++;
      cluster.push({ ...p, col, cols: 1 });
      clusterEnd = Math.max(clusterEnd, reach(p));
    }
    if (cluster.length) close();
  }
  return placed;
}

/** "4:30" or "4": an hour as the home screen's rows write it, am and pm left to the row's label. */
export function shortClock(h: number): string {
  const H = Math.floor(h);
  const m = Math.round((h - H) * 60);
  const twelve = ((H + 11) % 12) + 1;
  return m ? `${twelve}:${String(m).padStart(2, '0')}` : `${twelve}:00`;
}

/** "9 am", "12 pm": an hour row's or grid line's label. */
export function hourLabel(h: number): string {
  const H = ((h % 24) + 24) % 24;
  return `${((H + 11) % 12) + 1} ${H < 12 ? 'am' : 'pm'}`;
}

/** What an event's details say for when it is: "All day", "Tue, Oct 20, 9:30 – 10:15 am", or across days. */
export function eventSpan(e: BoardEvent, timeZone: string): string {
  const date = (d: string) => dayName(d);
  if (e.allDay) {
    return e.startDate === e.endDate
      ? `${date(e.startDate)}, all day`
      : `${date(e.startDate)} – ${date(e.endDate)}, all day`;
  }
  const from = time(e.start, timeZone);
  const to = time(e.end, timeZone);
  if (e.startDate === e.endDate) {
    const same = from.slice(-2) === to.slice(-2);
    return `${date(e.startDate)}, ${same ? from.slice(0, -3) : from} – ${to}`;
  }
  return `${date(e.startDate)}, ${from} – ${date(e.endDate)}, ${to}`;
}
