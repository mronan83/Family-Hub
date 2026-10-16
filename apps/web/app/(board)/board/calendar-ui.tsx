'use client';

import { Avatar, Button, Icon, type IconName, zoomAt } from '@familywise/ui';
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  allDayLanes,
  type Bar,
  behind,
  type CalendarView,
  covers,
  dayName,
  eventsOn,
  eventSpan,
  eventWhen,
  gridHours,
  heading,
  hourIn,
  hourLabel,
  hourRows,
  nowInRows,
  type Piece,
  shortClock,
  sideBySide,
  splitDays,
  MONTH_SHOWN,
  rangeFor,
  step,
  shownCalendar,
} from '@/lib/board-calendar';
import { andList, dayAndTime } from '@/lib/format';
import type {
  BoardCalendar,
  BoardCalendarSource,
  BoardEvent,
  BoardMember,
  BoardSnapshot,
} from '@/lib/snapshot';

/** Reads a range the snapshot doesn't hold (`board_calendar()` on a board); null when it can't. */
export type LoadCalendar = (from: string, to: string) => Promise<BoardCalendar | null>;

const VIEWS: { view: CalendarView; label: string; icon: IconName }[] = [
  { view: 'day', label: 'Day', icon: 'view-day' },
  { view: 'week', label: 'Week', icon: 'view-week' },
  { view: 'month', label: 'Month', icon: 'view-month' },
];
const UNIT: Record<CalendarView, string> = { day: 'day', week: 'week', month: 'month' };
/** How far a finger moves sideways before it turns the page. */
const SWIPE_PX = 120;

/**
 * [CAL-04] The calendar a range shows: the snapshot's while it covers the range (and offline), else
 * what `load` reads, read again whenever the snapshot is (a change heard through Realtime). While a
 * read is out, or when it fails, the snapshot's events for those dates show, with `partial` set.
 * [US-503][WP-70] `loading` says the range's first read is still out: what shows is the snapshot's
 * part of it, and the rest is drawn when the read lands (the calendar is `aria-busy` till then).
 */
export function useCalendar(
  snapshot: BoardSnapshot,
  from: string,
  to: string,
  load?: LoadCalendar,
) {
  const inSnapshot = covers(snapshot.calendar, from, to);
  const range = `${from}|${to}`;
  const [fetched, setFetched] = useState<{ range: string; cal: BoardCalendar | null } | null>(null);
  useEffect(() => {
    if (inSnapshot || !load) return;
    let cancelled = false;
    void load(from, to).then((cal) => {
      if (!cancelled) setFetched({ range, cal });
    });
    return () => {
      cancelled = true;
    };
    // Read again when the snapshot is: its fetchedAt changes with every read.
  }, [inSnapshot, load, from, to, range, snapshot.fetchedAt]);
  return shownCalendar(snapshot.calendar, from, to, !!load, fetched);
}

export function EventLine({
  event,
  date,
  calendar,
  members,
  timeZone,
}: {
  event: BoardEvent;
  date: string;
  calendar: BoardCalendarSource | undefined;
  /** The calendar's people (WP-50). */
  members: BoardMember[];
  timeZone: string;
}) {
  return (
    <li
      className="fw-bcal__event"
      style={{ ['--cal' as string]: `var(--${calendar?.color ?? 'member-6'}-line)` }}
      data-calendar={calendar?.name}
    >
      <span className="fw-bcal__when">{eventWhen(event, date, timeZone)}</span>
      <span className="fw-bcal__title">{event.title || 'Untitled event'}</span>
      {members.map((m) => (
        <Avatar key={m.id} name={m.displayName} avatarKey={m.avatarKey} color={m.color} size={40} />
      ))}
    </li>
  );
}

/**
 * [CAL-04][CAL-05][US-503] The board's calendar: Day, Week or Month, moved by the arrows or a swipe,
 * back to today in one tap. Each event in its calendar's color with the person whose calendar it is;
 * a month's day shows three and "+N more", and opens as a day. Events are only read here: they change
 * in Apple Calendar (CAL-03). A calendar that can't sync says so, and its last good events stay.
 */
export function CalendarScreen({
  snapshot,
  now,
  load,
  initialView = 'week',
  initialDate,
}: {
  snapshot: BoardSnapshot;
  now: Date;
  load?: LoadCalendar;
  /** [D-66] Where it opens: a day tapped on the dashboard opens as that day. */
  initialView?: CalendarView;
  initialDate?: string;
}) {
  const { today, household, members } = snapshot;
  const tz = household.timezone;
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchor, setAnchor] = useState(initialDate ?? today);
  const { from, to, days } = useMemo(
    () => rangeFor(view, anchor, household.weekStart),
    [view, anchor, household.weekStart],
  );
  const { cal, partial, loading } = useCalendar(snapshot, from, to, load);
  const { ink, events } = useInk(cal, members, tz);
  const calendars = ink.calendars;
  const late = behind(cal?.calendars ?? [], now);
  const title = heading(view, anchor, household.weekStart);
  const showsToday =
    view === 'month' ? anchor.slice(0, 7) === today.slice(0, 7) : days.includes(today);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    // Pointer positions are on screen; the swipe is measured in the board's own px (BRD-08), so it
    // is the same reach on any screen.
    const z = zoomAt(e.currentTarget);
    const dx = (e.clientX - start.x) / z;
    const dy = (e.clientY - start.y) / z;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
      setAnchor((a) => step(view, a, dx < 0 ? 1 : -1));
    }
  };

  return (
    <section className="fw-bcal" aria-labelledby="cal-title" aria-busy={loading}>
      <header className="fw-bcal__head">
        <div className="fw-bcal__views" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              className="fw-bcal__view"
              aria-pressed={view === v.view}
              onClick={() => setView(v.view)}
            >
              <Icon name={v.icon} size={36} />
              {v.label}
            </button>
          ))}
        </div>
        <div className="fw-bcal__nav">
          <button
            type="button"
            className="fw-bcal__step"
            aria-label={`Previous ${UNIT[view]}`}
            onClick={() => setAnchor((a) => step(view, a, -1))}
          >
            <Icon name="chevron-left" size={40} />
          </button>
          <h2 id="cal-title" className="fw-bcal__title-date">
            {title}
          </h2>
          <button
            type="button"
            className="fw-bcal__step"
            aria-label={`Next ${UNIT[view]}`}
            onClick={() => setAnchor((a) => step(view, a, 1))}
          >
            <Icon name="chevron-right" size={40} />
          </button>
          <button
            type="button"
            className="fw-bcal__today"
            disabled={showsToday}
            onClick={() => setAnchor(today)}
          >
            Today
          </button>
        </div>
      </header>

      {late.map((c) => (
        <p key={c.id} className="fw-bcal__note">
          <Icon name="hourglass" size={32} />
          <span>
            {c.lastSuccessAt
              ? `${c.name} hasn’t updated since ${dayAndTime(c.lastSuccessAt, tz)}. Showing its last good events.`
              : `${c.name} hasn’t updated yet.`}
          </span>
        </p>
      ))}
      {partial ? (
        <p className="fw-bcal__note">
          <Icon name="wifi-off" size={32} />
          <span>Showing what this board has for these dates.</span>
        </p>
      ) : null}
      {calendars.size === 0 ? (
        <p className="fw-today__empty">
          No calendars on this board yet. A parent adds them on Calendars in the admin portal.
        </p>
      ) : null}

      <div
        className={`fw-bcal__body fw-bcal__body--${view}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        {view !== 'month' ? (
          <TimeGrid
            days={days}
            events={events}
            ink={ink}
            today={today}
            now={hourIn(now.toISOString(), tz)}
            onOpenDay={
              view === 'week'
                ? (d) => {
                    setView('day');
                    setAnchor(d);
                  }
                : undefined
            }
          />
        ) : (
          <ol className="fw-bcal__month" aria-label={title}>
            {days.map((d) => {
              const list = eventsOn(events, d);
              const more = list.length - MONTH_SHOWN;
              const outside = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <li
                  key={d}
                  data-outside={outside ? '' : undefined}
                  data-today={d === today ? '' : undefined}
                >
                  <button
                    type="button"
                    className="fw-bcal__cell"
                    aria-label={`${dayName(d)}: ${list.length === 1 ? '1 event' : `${list.length} events`}`}
                    onClick={() => {
                      setView('day');
                      setAnchor(d);
                    }}
                  >
                    <span className="fw-bcal__date">{Number(d.slice(8))}</span>
                    {list.slice(0, MONTH_SHOWN).map((e) => (
                      <span
                        key={e.id}
                        className="fw-bcal__chip"
                        style={{
                          ['--cal' as string]: `var(--${calendars.get(e.calendarId)?.color ?? 'member-6'}-line)`,
                        }}
                      >
                        {e.title || 'Untitled event'}
                      </span>
                    ))}
                    {more > 0 ? <span className="fw-bcal__more">+{more} more</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The calendars and people a grid draws its events with. */
interface Ink {
  calendars: Map<string, BoardCalendarSource>;
  people: Map<string, BoardMember>;
  timeZone: string;
}

const calColor = (c: BoardCalendarSource | undefined): CSSProperties =>
  ({ ['--cal' as string]: `var(--${c?.color ?? 'member-6'}-line)` }) as CSSProperties;

/** [CAL-09] A calendar's people still on the board, in its order (WP-50). */
function peopleOf(c: BoardCalendarSource | undefined, ink: Ink): BoardMember[] {
  return (c?.memberIds ?? []).flatMap((id) => {
    const m = ink.people.get(id);
    return m ? [m] : [];
  });
}

/**
 * Whose an event is, as its button says it: the calendar's people ("Maya and Leo"), else the
 * calendar's name.
 */
function whose(e: BoardEvent, ink: Ink): string {
  const c = ink.calendars.get(e.calendarId);
  const names = peopleOf(c, ink).map((m) => m.displayName);
  return names.length ? andList(names) : (c?.name ?? 'Calendar');
}

/** "Dentist, 9:30 – 10:15 am, Leo": an event button's name, what the details sheet then shows. */
function eventLabel(e: BoardEvent, ink: Ink): string {
  return `${e.title || 'Untitled event'}, ${eventSpan(e, ink.timeZone)}, ${whose(e, ink)}`;
}

/**
 * [CAL-10][US-509] An event in full, from a tap on it in the calendar (WP-52, D-82): its title, when,
 * where, its calendar and whose it is. Read only (CAL-03); it closes with Close, Escape or idle.
 */
export function EventDetails({
  event,
  ink,
  onClose,
}: {
  event: BoardEvent;
  ink: Ink;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.fw-details__close')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const c = ink.calendars.get(event.calendarId);
  const people = peopleOf(c, ink);
  return (
    <div className="fw-today__scrim">
      <div
        ref={box}
        className="fw-today__picker fw-details fw-evdetails"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-title"
        style={calColor(c)}
      >
        <header className="fw-details__head">
          <span className="fw-evdetails__swatch" aria-hidden />
          <h2 id="event-title">{event.title || 'Untitled event'}</h2>
        </header>
        <dl className="fw-details__facts">
          <dt>
            <Icon name="clock" size={36} />
            When
          </dt>
          <dd>{eventSpan(event, ink.timeZone)}</dd>
          {event.location ? (
            <>
              <dt>
                <Icon name="map-pin" size={36} />
                Where
              </dt>
              <dd>{event.location}</dd>
            </>
          ) : null}
          <dt>
            <Icon name="calendar" size={36} />
            Calendar
          </dt>
          <dd>{c?.name ?? 'Calendar'}</dd>
          <dt>
            <Icon name="person" size={36} />
            Whose
          </dt>
          <dd className="fw-evdetails__who">
            {people.length ? (
              people.map((m) => (
                <span key={m.id} className="fw-evdetails__person">
                  <Avatar
                    name={m.displayName}
                    avatarKey={m.avatarKey}
                    color={m.color}
                    size={56}
                    decorative
                  />
                  {m.displayName}
                </span>
              ))
            ) : (
              <>
                <Icon name="family" size={56} />
                Everyone
              </>
            )}
          </dd>
          {event.changed ? (
            <>
              <dt>
                <Icon name="info" size={36} />
                Note
              </dt>
              <dd>Moved or changed on its own in Apple Calendar.</dd>
            </>
          ) : null}
        </dl>
        <div className="fw-today__picker-actions">
          <Button variant="secondary" icon="close" className="fw-details__close" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A day's head in a grid: its weekday and date, a tap opens it; "+N" for all-day events left out. */
function DayHead({
  date,
  today,
  more,
  long,
  onOpen,
  style,
}: {
  date: string;
  today: boolean;
  more: number;
  long?: boolean;
  onOpen?: () => void;
  style?: CSSProperties;
}) {
  const name = dayName(date);
  const extra = more ? `, ${more} more all-day` : '';
  const inner = (
    <>
      <span className="fw-tgrid__wd">
        {long
          ? new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
              new Date(`${date}T12:00:00Z`),
            )
          : name.split(',')[0]}
      </span>
      <span className="fw-tgrid__date">{Number(date.slice(8))}</span>
      {more ? (
        <span className="fw-tgrid__more" aria-hidden>
          +{more}
        </span>
      ) : null}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="fw-tgrid__head"
      data-today={today ? '' : undefined}
      aria-label={`Open ${name}${extra}`}
      onClick={onOpen}
      style={style}
    >
      {inner}
    </button>
  ) : (
    <div
      className="fw-tgrid__head"
      data-today={today ? '' : undefined}
      aria-label={`${name}${extra}`}
      style={style}
    >
      {inner}
    </div>
  );
}

/** An all-day bar, placed by the grid that holds it. */
function AllDayBar({
  bar,
  ink,
  style,
  onOpen,
}: {
  bar: Bar;
  ink: Ink;
  style: CSSProperties;
  onOpen: (e: BoardEvent) => void;
}) {
  const c = ink.calendars.get(bar.event.calendarId);
  return (
    <button
      type="button"
      className="fw-tgrid__bar"
      data-calendar={c?.name}
      aria-label={eventLabel(bar.event, ink)}
      style={{ ...calColor(c), ...style }}
      onClick={() => onOpen(bar.event)}
    >
      <span className="fw-tgrid__title">{bar.event.title || 'Untitled event'}</span>
    </button>
  );
}

/** The household's time now as hours (16.5 = 4:30 pm), from the board's "HH:MM". */
export function hoursOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h + m / 60;
}

/**
 * [CAL-04][D-82] The home screen's 3, 5 or 7 days (WP-52): all-day events in two lanes across the
 * days (the rest as "+N" on a day), then a row for each hour something starts in, lined up across
 * the days, a skipped stretch a thin band. A day's head opens it as a day; an event opens its
 * details. Now is a line across today.
 */
export function HourRowsGrid({
  days,
  events,
  ink,
  today,
  now,
  onOpenDay,
}: {
  days: string[];
  events: BoardEvent[];
  ink: Ink;
  today: string;
  /** The household's time now, in hours. */
  now: number;
  onOpenDay: (date: string) => void;
}) {
  const [open, setOpen] = useState<BoardEvent | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const { allDay, pieces } = useMemo(() => {
    const split = splitDays(events, days, ink.timeZone);
    // A late event shows on the day it starts; its part after midnight would take a 12 am row.
    return { ...split, pieces: split.pieces.filter((p) => !p.continued) };
  }, [events, days, ink.timeZone]);
  const { bars, more } = useMemo(() => allDayLanes(allDay, days, 2), [allDay, days]);
  const { hours, groups } = useMemo(() => hourRows(pieces), [pieces]);
  const lanes = bars.length ? Math.max(...bars.map((b) => b.lane)) + 1 : 0;
  // The hours' rows, with a thin row where some are skipped.
  const rows: string[] = [];
  const line: number[] = [];
  hours.forEach((h, i) => {
    if (i > 0 && h - hours[i - 1]! > 1) rows.push('var(--s-3)');
    rows.push('minmax(var(--hrow), auto)');
    line.push(rows.length);
  });
  const ti = days.indexOf(today);
  const at = ti >= 0 ? nowInRows(hours, now) : null;
  const col = (d: number) => d + 2;
  const columns = `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`;
  // [D-82] More hours than the card holds: it opens where now is, what's past scrolled up.
  const nowRow = at?.row ?? -1;
  useEffect(() => {
    const box = body.current;
    const mark = box?.querySelector<HTMLElement>('.fw-tgrid__now');
    if (!box || !mark || box.scrollHeight <= box.clientHeight) return;
    box.scrollTop = Math.max(0, mark.offsetTop - box.clientHeight / 3);
  }, [nowRow, hours.length]);
  return (
    <div className="fw-hgrid" data-days={days.length}>
      <div
        className="fw-hgrid__top"
        style={{ gridTemplateColumns: columns, gridTemplateRows: `auto repeat(${lanes}, auto)` }}
      >
        {ti >= 0 ? (
          <div className="fw-tgrid__tint" style={{ gridColumn: col(ti), gridRow: '1 / -1' }} />
        ) : null}
        {days.map((d, i) => (
          <DayHead
            key={d}
            date={d}
            today={d === today}
            more={more[i]!}
            onOpen={() => onOpenDay(d)}
            style={{ gridColumn: col(i), gridRow: 1 }}
          />
        ))}
        {lanes ? (
          <span className="fw-tgrid__label" style={{ gridColumn: 1, gridRow: 2 }}>
            All day
          </span>
        ) : null}
        {bars.map((b) => (
          <AllDayBar
            key={`${b.event.id}:${b.from}`}
            bar={b}
            ink={ink}
            onOpen={setOpen}
            style={{ gridColumn: `${col(b.from)} / ${col(b.to) + 1}`, gridRow: b.lane + 2 }}
          />
        ))}
      </div>
      <div
        ref={body}
        className="fw-hgrid__body"
        style={{
          gridTemplateColumns: columns,
          gridTemplateRows: rows.length ? rows.join(' ') : 'auto',
        }}
      >
        {ti >= 0 ? (
          <div className="fw-tgrid__tint" style={{ gridColumn: col(ti), gridRow: '1 / -1' }} />
        ) : null}
        {/* Now's time stands in for its row's hour, as in Apple Calendar. */}
        {line.map((r, i) =>
          at?.row === i ? null : (
            <span
              key={`l${hours[i]}`}
              className="fw-hgrid__hour"
              style={{ gridColumn: 1, gridRow: r }}
            >
              {hourLabel(hours[i]!)}
            </span>
          ),
        )}
        {line.map((r, i) => (
          <div
            key={`r${hours[i]}`}
            className="fw-hgrid__rule"
            style={{ gridColumn: '2 / -1', gridRow: r }}
          />
        ))}
        {line.map((r, i) =>
          i > 0 && r - line[i - 1]! > 1 ? (
            <div
              key={`g${hours[i]}`}
              className="fw-hgrid__gap"
              style={{ gridColumn: '2 / -1', gridRow: r - 1 }}
            />
          ) : null,
        )}
        {groups.map((g) => (
          <div
            key={`${g.day}:${g.row}`}
            className="fw-hgrid__cell"
            style={{
              gridColumn: col(g.day),
              gridRow: `${line[g.row]} / ${line[g.row + g.span - 1]! + 1}`,
            }}
          >
            {g.pieces.map((p) => (
              <GridEvent
                key={p.event.id}
                piece={p}
                ink={ink}
                past={days[p.day] === today && p.end <= now}
                time={shortClock(p.start)}
                onOpen={setOpen}
              />
            ))}
          </div>
        ))}
        {at ? (
          <>
            <div
              className="fw-tgrid__now"
              style={
                {
                  gridColumn: col(ti),
                  gridRow: line[at.row],
                  ['--at' as string]: at.at,
                } as CSSProperties
              }
            />
            <span
              className="fw-tgrid__now-tag"
              style={
                { gridColumn: 1, gridRow: line[at.row], ['--at' as string]: at.at } as CSSProperties
              }
            >
              {shortClock(now)}
            </span>
          </>
        ) : null}
        {hours.length === 0 ? (
          <p className="fw-hgrid__empty" style={{ gridColumn: '2 / -1', gridRow: 1 }}>
            {lanes ? 'Nothing else on the calendar.' : 'Nothing on the calendar.'}
          </p>
        ) : null}
      </div>
      {open ? <EventDetails event={open} ink={ink} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** A timed event's block in a grid: its start (unless the grid is too narrow) and its title. */
function GridEvent({
  piece,
  ink,
  past,
  time,
  style,
  tall,
  onOpen,
}: {
  piece: Piece;
  ink: Ink;
  past: boolean;
  time: string | null;
  style?: CSSProperties;
  tall?: boolean;
  onOpen: (e: BoardEvent) => void;
}) {
  const e = piece.event;
  const when = time ? <span className="fw-tgrid__time">{time}</span> : null;
  // A start leads ("4:00 Bus"); a range or "Until 1:00" follows the title.
  const lead = !tall && !!time && !time.includes('–') && !time.startsWith('Until');
  const c = ink.calendars.get(e.calendarId);
  return (
    <button
      type="button"
      className="fw-bcal__event fw-tgrid__event"
      data-calendar={c?.name}
      data-past={past ? '' : undefined}
      data-tall={tall ? '' : undefined}
      aria-label={eventLabel(e, ink)}
      style={{ ...calColor(c), ...style }}
      onClick={() => onOpen(e)}
    >
      {lead ? when : null}
      <span className="fw-tgrid__title">{e.title || 'Untitled event'}</span>
      {lead ? null : when}
    </button>
  );
}

/**
 * [CAL-04][D-82] The Calendar's Week and Day (WP-52): all-day events in three lanes across the days,
 * then the hours to scale, 8 am to 8 pm at least and as far as the events go; events that overlap
 * sit side by side. Now is a line across today. A week's day head opens it as a day.
 */
export function TimeGrid({
  days,
  events,
  ink,
  today,
  now,
  onOpenDay,
}: {
  days: string[];
  events: BoardEvent[];
  ink: Ink;
  today: string;
  now: number;
  onOpenDay?: (date: string) => void;
}) {
  const [open, setOpen] = useState<BoardEvent | null>(null);
  const { allDay, pieces } = useMemo(
    () => splitDays(events, days, ink.timeZone),
    [events, days, ink.timeZone],
  );
  const { bars, more } = useMemo(
    () => allDayLanes(allDay, days, days.length === 1 ? 6 : 3),
    [allDay, days],
  );
  const placed = useMemo(() => sideBySide(pieces), [pieces]);
  const ti = days.indexOf(today);
  const { from, to } = gridHours(pieces, ti >= 0 ? now : undefined);
  const pct = (h: number) => `${((h - from) / (to - from)) * 100}%`;
  const lanes = bars.length ? Math.max(...bars.map((b) => b.lane)) + 1 : 0;
  const single = days.length === 1;
  const col = (d: number) => d + 2;
  const hourMarks = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="fw-tgrid" data-days={days.length}>
      <div
        className="fw-tgrid__top"
        style={{
          gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${single ? Math.ceil(lanes / 2) : lanes}, auto)`,
        }}
      >
        {ti >= 0 && !single ? (
          <div className="fw-tgrid__tint" style={{ gridColumn: col(ti), gridRow: '1 / -1' }} />
        ) : null}
        {days.map((d, i) => (
          <DayHead
            key={d}
            date={d}
            today={d === today}
            more={more[i]!}
            long={single}
            onOpen={onOpenDay ? () => onOpenDay(d) : undefined}
            style={{ gridColumn: col(i), gridRow: 1 }}
          />
        ))}
        {lanes ? (
          <span className="fw-tgrid__label" style={{ gridColumn: 1, gridRow: 2 }}>
            All day
          </span>
        ) : null}
        {single ? (
          <ul className="fw-tgrid__chips" style={{ gridColumn: 2, gridRow: '2 / -1' }}>
            {bars.map((b) => (
              <li key={b.event.id}>
                <AllDayBar bar={b} ink={ink} onOpen={setOpen} style={{}} />
              </li>
            ))}
          </ul>
        ) : (
          bars.map((b) => (
            <AllDayBar
              key={`${b.event.id}:${b.from}`}
              bar={b}
              ink={ink}
              onOpen={setOpen}
              style={{ gridColumn: `${col(b.from)} / ${col(b.to) + 1}`, gridRow: b.lane + 2 }}
            />
          ))
        )}
      </div>
      <div
        className="fw-tgrid__body"
        style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="fw-tgrid__hours" aria-hidden>
          {hourMarks.map((h) => (
            <span key={h} className="fw-tgrid__hour" style={{ top: pct(h) }}>
              {h < to && !(ti >= 0 && Math.abs(h - now) < 0.4) ? hourLabel(h) : ''}
            </span>
          ))}
        </div>
        {days.map((d, i) => (
          <section
            key={d}
            className="fw-bcal__col fw-tgrid__col"
            aria-label={dayName(d)}
            data-today={d === today ? '' : undefined}
          >
            {hourMarks.map((h) => (
              <div key={h} className="fw-tgrid__rule" style={{ top: pct(h) }} />
            ))}
            {placed
              .filter((p) => p.day === i)
              .map((p) => {
                const top = Math.max(p.start, from);
                const tall = p.end - top >= 1.25;
                return (
                  <GridEvent
                    key={`${p.event.id}:${p.day}`}
                    piece={p}
                    ink={ink}
                    past={d < today || (d === today && p.end <= now)}
                    time={
                      tall || single || p.continued
                        ? timeRange(p, ink.timeZone)
                        : p.end - p.start < 0.5
                          ? shortClock(p.start)
                          : null
                    }
                    tall={tall}
                    onOpen={setOpen}
                    style={{
                      top: pct(top),
                      height: `calc(${pct(p.end)} - ${pct(top)})`,
                      left: `${(p.col / p.cols) * 100}%`,
                      width: `${100 / p.cols}%`,
                    }}
                  />
                );
              })}
            {d === today && now >= from && now <= to ? (
              <div className="fw-tgrid__now" style={{ top: pct(now) }} />
            ) : null}
          </section>
        ))}
        {ti >= 0 && now >= from && now <= to ? (
          <span className="fw-tgrid__now-tag" style={{ top: pct(now) }}>
            {shortClock(now)}
          </span>
        ) : null}
      </div>
      {open ? <EventDetails event={open} ink={ink} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/**
 * "9:30 – 10:15": a block's time, when it is tall enough to say it; a late one's real end ("10:30 –
 * 1:00"); "Until 1:00" for its part after midnight.
 */
function timeRange(p: Piece, timeZone: string): string {
  if (p.continued) return `Until ${shortClock(p.end)}`;
  const end =
    p.end === 24 && p.event.endDate !== p.event.startDate ? hourIn(p.event.end, timeZone) : p.end;
  return `${shortClock(p.start)} – ${shortClock(end)}`;
}

/** The ink a grid draws with, from a calendar read and the household's people. */
export function useInk(
  cal: BoardCalendar | null,
  members: BoardMember[],
  timeZone: string,
): { ink: Ink; events: BoardEvent[] } {
  return useMemo(() => {
    const calendars = new Map((cal?.calendars ?? []).map((c) => [c.id, c]));
    const people = new Map(members.map((m) => [m.id, m]));
    // Only the calendars this board shows (a snapshot read before an untick may still hold others').
    const events = (cal?.events ?? []).filter((e) => calendars.has(e.calendarId));
    return { ink: { calendars, people, timeZone }, events };
  }, [cal, members, timeZone]);
}
