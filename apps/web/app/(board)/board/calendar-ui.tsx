'use client';

import { Avatar, Icon, type IconName } from '@familywise/ui';
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  behind,
  type CalendarView,
  covers,
  dayName,
  eventsOn,
  eventWhen,
  heading,
  MONTH_SHOWN,
  rangeFor,
  step,
} from '@/lib/board-calendar';
import { dayAndTime } from '@/lib/format';
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
  if (inSnapshot) return { cal: snapshot.calendar, partial: false };
  if (fetched?.range === range && fetched.cal) return { cal: fetched.cal, partial: false };
  return { cal: snapshot.calendar, partial: true };
}

export function EventLine({
  event,
  date,
  calendar,
  member,
  timeZone,
}: {
  event: BoardEvent;
  date: string;
  calendar: BoardCalendarSource | undefined;
  member: BoardMember | undefined;
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
      {member ? (
        <Avatar
          name={member.displayName}
          avatarKey={member.avatarKey}
          color={member.color}
          size={40}
        />
      ) : null}
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
  const { cal, partial } = useCalendar(snapshot, from, to, load);
  const calendars = useMemo(() => new Map((cal?.calendars ?? []).map((c) => [c.id, c])), [cal]);
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  // Only the calendars this board shows (a snapshot read before an untick may still hold others').
  const events = useMemo(
    () => (cal?.events ?? []).filter((e) => calendars.has(e.calendarId)),
    [cal, calendars],
  );
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
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
      setAnchor((a) => step(view, a, dx < 0 ? 1 : -1));
    }
  };

  const line = (e: BoardEvent, date: string) => {
    const c = calendars.get(e.calendarId);
    return (
      <EventLine
        key={`${date}:${e.id}`}
        event={e}
        date={date}
        calendar={c}
        member={c?.memberId ? people.get(c.memberId) : undefined}
        timeZone={tz}
      />
    );
  };

  return (
    <section className="fw-bcal" aria-labelledby="cal-title">
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
        {view === 'day' ? (
          (() => {
            const list = eventsOn(events, anchor);
            return list.length ? (
              <ol className="fw-bcal__list" aria-label={`Events on ${title}`}>
                {list.map((e) => line(e, anchor))}
              </ol>
            ) : (
              <p className="fw-today__empty">Nothing on the calendar.</p>
            );
          })()
        ) : view === 'week' ? (
          <div className="fw-bcal__week">
            {days.map((d) => {
              const list = eventsOn(events, d);
              return (
                <section
                  key={d}
                  className="fw-bcal__col"
                  aria-label={dayName(d)}
                  data-today={d === today ? '' : undefined}
                >
                  <h3 className="fw-bcal__col-head">
                    {dayName(d).split(',')[0]} <span>{Number(d.slice(8))}</span>
                  </h3>
                  {list.length ? (
                    <ol className="fw-bcal__list">{list.map((e) => line(e, d))}</ol>
                  ) : null}
                </section>
              );
            })}
          </div>
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
