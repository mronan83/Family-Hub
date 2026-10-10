import { Banner, Button } from '@familywise/ui';
import Link from 'next/link';
import { isDone, type DayItem } from '@/lib/admin-day';
import { calendarDay, relativeDay } from '@/lib/chores';
import { dayAndTime } from '@/lib/format';
import { sections } from '@/lib/today';
import { AdminHeader } from '../header';
import { dayAction, undoBatch } from './actions';
import type { WaitingItem } from './data';
import { ItemRow, type Person } from './item-row';

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface TodayViewProps {
  date: string;
  today: string;
  timezone: string;
  items: DayItem[];
  waiting: WaitingItem[];
  people: Person[];
  notice: string | null;
  error: string | null;
  /** The batch just unchecked, for its Undo button. */
  undoBatchId: string | null;
  /** This page view's request id: a form sent twice records once. */
  request: string;
}

/**
 * [CHR-05][CHR-06][CHR-08] A parent's day: check-offs waiting for a parent at the top, then a day's
 * items by part of day, each with what a parent can do, and "Not actually done" for the ticked ones.
 */
export function TodayView({
  date,
  today,
  timezone,
  items,
  waiting,
  people,
  notice,
  error,
  undoBatchId,
  request,
}: TodayViewProps) {
  const parts = sections(items, date);
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/today" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">
          {notice}
          {undoBatchId ? (
            <form action={undoBatch} className="fw-day__undo">
              <input type="hidden" name="batch" value={undoBatchId} />
              <input type="hidden" name="date" value={date} />
              <Button type="submit" variant="secondary" icon="undo">
                Undo
              </Button>
            </form>
          ) : null}
        </Banner>
      ) : null}

      {waiting.length > 0 ? (
        <section className="fw-card" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading">Waiting for you</h2>
          <p className="fw-muted">
            Check-offs that need a parent. Approving counts them; sending one back shows it as open
            to try again.
          </p>
          <form action={dayAction}>
            <input type="hidden" name="request" value={request} />
            <input type="hidden" name="date" value={date} />
            <ul className="fw-list" aria-label="Waiting for you">
              {waiting.map((w) => (
                <ItemRow
                  key={w.id}
                  item={w}
                  today={today}
                  people={people}
                  only={['approve', 'reject']}
                  extra={
                    <span className="fw-muted">
                      {relativeDay(w.dueDate, today)}
                      {w.checkedAt ? ` · checked off ${dayAndTime(w.checkedAt, timezone)}` : ''}
                      {w.flagged ? ' · after its day: check it was really done' : ''}
                    </span>
                  }
                />
              ))}
            </ul>
          </form>
        </section>
      ) : null}

      <section className="fw-card" aria-labelledby="day-heading">
        <div className="fw-bar">
          <div>
            <h1 id="day-heading">{relativeDay(date, today)}</h1>
            {relativeDay(date, today) !== calendarDay(date) ? (
              <p className="fw-muted">{calendarDay(date)}</p>
            ) : null}
          </div>
          <nav aria-label="Days" className="fw-actions">
            <Link href={`/admin/today?date=${shift(date, -1)}`}>Day before</Link>
            {date !== today ? <Link href="/admin/today">Today</Link> : null}
            <Link href={`/admin/today?date=${shift(date, 1)}`}>Day after</Link>
          </nav>
        </div>

        {parts.length === 0 ? (
          <p className="fw-muted">Nothing is due on this day.</p>
        ) : (
          <form action={dayAction} className="fw-form">
            <input type="hidden" name="request" value={request} />
            <input type="hidden" name="date" value={date} />
            {parts.map((p) => (
              <section key={p.key} aria-labelledby={`part-${p.key}`}>
                <h2 id={`part-${p.key}`} className="fw-subhead">
                  {p.label}
                </h2>
                <ul className="fw-list" aria-labelledby={`part-${p.key}`}>
                  {p.items.map((i) => (
                    <ItemRow key={i.id} item={i} today={today} people={people} selectable />
                  ))}
                </ul>
              </section>
            ))}
            {items.some((i) => isDone(i.status)) ? (
              <div className="fw-actions">
                <Button type="submit" variant="secondary" icon="undo" name="act" value="batch">
                  Not actually done
                </Button>
                <span className="fw-muted">
                  Tick the items that weren’t really done, then uncheck them together.
                </span>
              </div>
            ) : null}
          </form>
        )}
        <p className="fw-muted">
          Late credit for a past day counts as done by a parent. Skipping a day leaves it out of
          streaks and goals.
        </p>
      </section>
    </main>
  );
}
