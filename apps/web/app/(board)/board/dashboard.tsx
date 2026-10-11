'use client';

import { Avatar, Icon, PointsChip } from '@familywise/ui';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, dayName, eventsOn, heading } from '@/lib/board-calendar';
import type { BoardLayout, CardId } from '@/lib/board-layout';
import {
  type Chip,
  CHIP_WORDS,
  comingUp,
  dotsOn,
  familyList,
  inDays,
  type ListRow,
  spanDates,
  waitingFor,
} from '@/lib/dashboard';
import type { BoardMember, BoardSnapshot } from '@/lib/snapshot';
import { progress, type TodayItem } from '@/lib/today';
import { EventLine, type LoadCalendar, useCalendar } from './calendar-ui';
import { GoalItem } from './goals-ui';
import { iconOf, type PhotoUrl } from './picture';

/** How long "Tap again to undo" waits for the second tap. */
const ARM_MS = 4_000;

/** Whether a line of text is cut short in its box (a single line, or a clamp of several). */
function useClipped<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClipped(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return { ref, clipped };
}

function Face({
  chip,
  member,
  title,
  armed,
  canUndo,
  onTap,
}: {
  chip: Chip;
  member: BoardMember | undefined;
  title: string;
  armed: boolean;
  canUndo: boolean;
  onTap: () => void;
}) {
  const name = member?.displayName ?? 'Anyone';
  const open = chip.state === 'open' || chip.state === 'late' || chip.state === 'overdue';
  const undoable = canUndo && (chip.state === 'done' || chip.state === 'waiting');
  const label = open
    ? chip.memberId
      ? `Check off ${title} for ${name}`
      : `Check off ${title}`
    : undoable
      ? armed
        ? `Tap again to undo ${title} for ${name}`
        : `Undo ${title} for ${name}`
      : `${title}: ${CHIP_WORDS[chip.state]} for ${name}`;
  return (
    <li>
      <button
        type="button"
        className="fw-face"
        data-state={chip.state}
        data-armed={armed || undefined}
        aria-label={label}
        disabled={!open && !undoable}
        onClick={onTap}
      >
        {member ? (
          <Avatar
            name={member.displayName}
            avatarKey={member.avatarKey}
            color={member.color}
            size={64}
            decorative
          />
        ) : (
          <span className="fw-face__anyone">
            <Icon name="family" size={40} />
          </span>
        )}
        {chip.state === 'done' || chip.state === 'waiting' ? (
          <span className="fw-face__badge">
            <Icon name={chip.state === 'done' ? 'check' : 'hourglass'} size={24} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Row({
  row,
  people,
  armed,
  canUndo,
  celebrating,
  onFace,
  onMore,
}: {
  row: ListRow;
  people: Map<string, BoardMember>;
  armed: string | null;
  canUndo: (i: TodayItem) => boolean;
  celebrating: string | null;
  onFace: (chip: Chip) => void;
  onMore: (row: ListRow) => void;
}) {
  const { ref, clipped } = useClipped<HTMLSpanElement>(row.title);
  const allDone = row.chips.every((c) => !['open', 'late', 'overdue'].includes(c.state));
  return (
    <li
      className="fw-dash__row"
      data-row={row.key}
      data-done={allDone || undefined}
      data-celebrate={row.chips.some((c) => c.item.id === celebrating) || undefined}
    >
      <Icon name={iconOf(row.icon)} size={48} className="fw-dash__icon" />
      <span className="fw-dash__what">
        <span ref={ref} className="fw-dash__title">
          {row.title}
        </span>
        {row.points ? <PointsChip points={row.points} signed size="board" /> : null}
      </span>
      {row.description || clipped ? (
        <button
          type="button"
          className="fw-info-btn"
          aria-label={`More info about ${row.title}`}
          onClick={() => onMore(row)}
        >
          <Icon name="info" size={36} />
        </button>
      ) : null}
      <ul className="fw-dash__faces" aria-label={`Who: ${row.title}`}>
        {row.chips.map((c) => {
          const key = `${c.item.id}:${c.memberId ?? 'anyone'}`;
          return (
            <Face
              key={key}
              chip={c}
              member={c.memberId ? people.get(c.memberId) : undefined}
              title={row.title}
              armed={armed === key}
              canUndo={canUndo(c.item) && (!c.memberId || c.item.doneBy.includes(c.memberId))}
              onTap={() => onFace(c)}
            />
          );
        })}
      </ul>
    </li>
  );
}

/** [CAL-04][D-66] The calendar panel: 3, 5 or 7 days as columns, each day opens as a day. */
function DayColumns({
  snapshot,
  dates,
  load,
  onOpenDay,
}: {
  snapshot: BoardSnapshot;
  dates: string[];
  load?: LoadCalendar;
  onOpenDay: (date: string) => void;
}) {
  const { cal } = useCalendar(snapshot, dates[0]!, dates.at(-1)!, load);
  const calendars = useMemo(() => new Map((cal?.calendars ?? []).map((c) => [c.id, c])), [cal]);
  const people = useMemo(() => new Map(snapshot.members.map((m) => [m.id, m])), [snapshot.members]);
  const events = (cal?.events ?? []).filter((e) => calendars.has(e.calendarId));
  return (
    <div className="fw-dash__days" style={{ ['--days' as string]: dates.length }}>
      {dates.map((d) => {
        const list = eventsOn(events, d);
        return (
          <section
            key={d}
            className="fw-dash__day"
            aria-label={dayName(d)}
            data-today={d === snapshot.today ? '' : undefined}
          >
            <button
              type="button"
              className="fw-dash__day-head"
              aria-label={`Open ${dayName(d)}`}
              onClick={() => onOpenDay(d)}
            >
              <span>{dayName(d).split(',')[0]}</span>
              <span>{Number(d.slice(8))}</span>
              {d === snapshot.today ? <span className="fw-dash__today">Today</span> : null}
            </button>
            {list.length ? (
              <ol className="fw-bcal__list">
                {list.map((e) => {
                  const c = calendars.get(e.calendarId);
                  return (
                    <EventLine
                      key={`${d}:${e.id}`}
                      event={e}
                      date={d}
                      calendar={c}
                      member={c?.memberId ? people.get(c.memberId) : undefined}
                      timeZone={snapshot.household.timezone}
                    />
                  );
                })}
              </ol>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** [CAL-04][D-66] The month at a glance: a colored dot for each calendar with something on a day. */
function MonthDots({
  snapshot,
  dates,
  load,
  onOpenDay,
}: {
  snapshot: BoardSnapshot;
  dates: string[];
  load?: LoadCalendar;
  onOpenDay: (date: string) => void;
}) {
  const { cal } = useCalendar(snapshot, dates[0]!, dates.at(-1)!, load);
  const calendars = useMemo(() => new Map((cal?.calendars ?? []).map((c) => [c.id, c])), [cal]);
  const events = (cal?.events ?? []).filter((e) => calendars.has(e.calendarId));
  const month = snapshot.today.slice(0, 7);
  return (
    <div className="fw-dash__month">
      <ol className="fw-dash__weekdays" aria-hidden>
        {dates.slice(0, 7).map((d) => (
          <li key={d}>{dayName(d).slice(0, 3)}</li>
        ))}
      </ol>
      <ol className="fw-dash__cells" aria-label={heading('month', snapshot.today, 0)}>
        {dates.map((d) => {
          const n = eventsOn(events, d).length;
          const dots = dotsOn(events, d, calendars);
          return (
            <li
              key={d}
              data-outside={d.slice(0, 7) !== month ? '' : undefined}
              data-today={d === snapshot.today ? '' : undefined}
            >
              <button
                type="button"
                className="fw-dash__cell"
                aria-label={`${dayName(d)}: ${n === 1 ? '1 event' : `${n} events`}`}
                onClick={() => onOpenDay(d)}
              >
                <span className="fw-dash__date">{Number(d.slice(8))}</span>
                <span className="fw-dash__dots" data-dots={dots.length}>
                  {dots.map((c) => (
                    <i key={c} style={{ ['--cal' as string]: `var(--${c})` }} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Who({ ids, people }: { ids: string[]; people: Map<string, BoardMember> }) {
  return (
    <span className="fw-dash__who">
      {ids.map((id) => {
        const m = people.get(id);
        return m ? (
          <Avatar
            key={id}
            name={m.displayName}
            avatarKey={m.avatarKey}
            color={m.color}
            size={44}
            decorative
          />
        ) : null;
      })}
    </span>
  );
}

/**
 * [BRD-01][BRD-05][BRD-07][US-1006] The board's home screen: a family dashboard (WP-35, D-66). The
 * calendar leads (3, 5 or 7 days, or the month; a day opens as a day), today's list sits beside it
 * with a face for each person on an item (a tap checks it off for them), and the cards follow in the
 * order the layout sets: dinner and lunch (once meals exist), goals, what waits for a parent, and
 * what's coming up.
 */
export function Dashboard({
  snapshot,
  items,
  layout,
  nowTime,
  load,
  photoUrl,
  canUndo,
  celebrating,
  onCheck,
  onUndo,
  onMore,
  onOpenDay,
}: {
  snapshot: BoardSnapshot;
  items: TodayItem[];
  layout: BoardLayout;
  nowTime: string;
  load?: LoadCalendar;
  photoUrl?: PhotoUrl;
  canUndo: (i: TodayItem) => boolean;
  celebrating: string | null;
  onCheck: (chip: Chip) => void;
  onUndo: (item: TodayItem) => void;
  onMore: (row: ListRow) => void;
  onOpenDay: (date: string) => void;
}) {
  const { today, household, members } = snapshot;
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const list = useMemo(
    () => familyList(items, members, today, nowTime),
    [items, members, today, nowTime],
  );
  const dates = useMemo(
    () => spanDates(layout.calendar, today, household.weekStart),
    [layout.calendar, today, household.weekStart],
  );
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const p = progress(items);

  const onFace = (c: Chip) => {
    const key = `${c.item.id}:${c.memberId ?? 'anyone'}`;
    if (c.state === 'open' || c.state === 'late' || c.state === 'overdue') {
      setArmed(null);
      onCheck(c);
    } else if (armed === key) {
      setArmed(null);
      onUndo(c.item);
    } else setArmed(key);
  };

  const cards: Record<CardId, () => ReactNode> = {
    // [MEAL-06] Dinner and the school lunch menu arrive with the meal planner (WP-25, WP-28).
    meals: () => null,
    goals: () => {
      const goals = snapshot.goals;
      return (
        <section key="goals" className="fw-dash__card" aria-labelledby="dash-goals">
          <h2 id="dash-goals">
            <Icon name="target" size={40} />
            Goals
          </h2>
          {goals.length ? (
            <ul className="fw-today__goal-list" aria-labelledby="dash-goals">
              {goals.map((g) => (
                <GoalItem
                  key={g.id}
                  goal={g}
                  today={today}
                  photoUrl={photoUrl}
                  compact
                  who={
                    g.memberId ? (
                      <Who ids={[g.memberId]} people={people} />
                    ) : (
                      <span className="fw-pill">Family</span>
                    )
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="fw-today__muted">No goals yet.</p>
          )}
        </section>
      );
    },
    waiting: () => {
      const waits = waitingFor(snapshot, items);
      return (
        <section key="waiting" className="fw-dash__card" aria-labelledby="dash-waiting">
          <h2 id="dash-waiting">
            <Icon name="bell" size={40} />
            Waiting for a parent
          </h2>
          {waits.length ? (
            <ul className="fw-dash__lines" aria-labelledby="dash-waiting">
              {waits.map((w) => (
                <li key={w.key}>
                  <Who ids={w.memberIds} people={people} />
                  <span className="fw-dash__line-text">{w.text}</span>
                  {w.cost !== null ? <PointsChip points={w.cost} size="board" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="fw-today__muted">Nothing is waiting for a parent.</p>
          )}
        </section>
      );
    },
    coming: () => {
      const ahead = comingUp(snapshot.calendar, today);
      return (
        <section key="coming" className="fw-dash__card" aria-labelledby="dash-coming">
          <h2 id="dash-coming">
            <Icon name="sparkles" size={40} />
            Coming up
          </h2>
          {ahead.length ? (
            <ul className="fw-dash__lines" aria-labelledby="dash-coming">
              {ahead.map((u) => (
                <li
                  key={`${u.date}:${u.event.id}`}
                  className="fw-dash__coming"
                  style={{ ['--cal' as string]: `var(--${u.calendar?.color ?? 'member-6'})` }}
                >
                  <span className="fw-dash__line-date">{dayName(u.date)}</span>
                  <span className="fw-dash__line-text">{u.event.title || 'Untitled event'}</span>
                  {u.calendar?.memberId ? (
                    <Who ids={[u.calendar.memberId]} people={people} />
                  ) : null}
                  <span className="fw-dash__line-when">{inDays(u.days)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fw-today__muted">Nothing coming up in the next three weeks.</p>
          )}
        </section>
      );
    },
  };

  const span = layout.calendar;
  return (
    <div className="fw-dash" data-span={span}>
      <section className="fw-dash__cal" aria-labelledby="dash-cal">
        <h2 id="dash-cal" className="fw-dash__head">
          <Icon name="calendar" size={40} />
          {span === 'month' ? heading('month', today, household.weekStart) : `Next ${span} days`}
          <span className="fw-dash__sub">
            {span === 'month'
              ? 'Tap a day to see it'
              : `${dayName(today)} to ${dayName(addDays(today, Number(span) - 1))}`}
          </span>
        </h2>
        {span === 'month' ? (
          <MonthDots snapshot={snapshot} dates={dates} load={load} onOpenDay={onOpenDay} />
        ) : (
          <DayColumns snapshot={snapshot} dates={dates} load={load} onOpenDay={onOpenDay} />
        )}
      </section>
      <section className="fw-dash__list" aria-labelledby="dash-list">
        <h2 id="dash-list" className="fw-dash__head">
          <Icon name="list-check" size={40} />
          Today’s list
          <span className="fw-dash__sub">
            {p.total ? `${p.done} of ${p.total} done` : 'Nothing today'}
          </span>
        </h2>
        {list.length === 0 ? (
          <p className="fw-today__empty">Nothing on the list today.</p>
        ) : (
          list.map((s) => (
            <section key={s.key} className="fw-dash__part" aria-labelledby={`dash-${s.key}`}>
              <h3 id={`dash-${s.key}`} className="fw-today__part-title" data-part={s.key}>
                {s.label}
              </h3>
              <ul className="fw-dash__rows" aria-labelledby={`dash-${s.key}`}>
                {s.rows.map((r) => (
                  <Row
                    key={r.key}
                    row={r}
                    people={people}
                    armed={armed}
                    canUndo={canUndo}
                    celebrating={celebrating}
                    onFace={onFace}
                    onMore={onMore}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
      <div className="fw-dash__cards">
        {layout.cards.filter((c) => c.show).map((c) => cards[c.id]())}
      </div>
    </div>
  );
}
