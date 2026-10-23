import { Banner, Button, Fold } from '@familywise/ui';
import Link from 'next/link';
import { isDone, type DayItem } from '@/lib/admin-day';
import { relativeDay } from '@/lib/chores';
import { longDay, overdueWaiting, partFacts, partOpen } from '@/lib/day-folds';
import { dayAndTime } from '@/lib/format';
import { sections } from '@/lib/today';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { dayAction, undoBatch } from './actions';
import type { WaitingItem } from './data';
import { ItemRow, type Person } from './item-row';
import { LunchChanges } from './lunch-changes';
import type { WaitingLunch } from '@/lib/lunch';

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface TodayViewProps {
  date: string;
  today: string;
  timezone: string;
  items: DayItem[];
  waiting: WaitingItem[];
  /** [MEAL-09] The children's lunch changes waiting for a parent (WP-49). */
  lunches?: WaitingLunch[];
  people: Person[];
  notice: string | null;
  error: string | null;
  /** The batch just unchecked, for its Undo button. */
  undoBatchId: string | null;
  /** This page view's request id: a form sent twice records once. */
  request: string;
  /** [D-145] The item a parent just changed: its part stays open, and folds on the next load. */
  changed?: string | null;
}

/**
 * [CHR-05][CHR-06][CHR-08] A parent's day: check-offs waiting for a parent at the top, then a day's
 * items by part of day, each with what a parent can do, and "Not actually done" for the ticked ones.
 * [NFR-18][D-120] Folded as the fold audit draws it (WP-97): Waiting for you and Overdue open; a part
 * of the day folded to its count and first names once everything in it is done or skipped, a tick
 * on its header; the part a parent just changed stays open with its count until the next load
 * (D-145).
 */
export function TodayView({
  date,
  today,
  timezone,
  items,
  waiting,
  lunches = [],
  people,
  notice,
  error,
  undoBatchId,
  request,
  changed = null,
}: TodayViewProps) {
  const parts = sections(items, date);
  const day = relativeDay(date, today);
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

      <h1 id="day-heading" className="fw-day__title">
        {day}
      </h1>

      {waiting.length > 0 || lunches.length > 0 ? (
        <section className="fw-card fw-card--attn" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading">Waiting for you</h2>
          <p className="fw-muted">
            {lunches.length > 0
              ? 'Lunch changes and check-offs that need a parent. Approving a lunch change sets it; keeping the day as it was drops the change and its picks.'
              : 'Check-offs that need a parent. Approving counts them; sending one back shows it as open to try again.'}
          </p>
          <LunchChanges lunches={lunches} people={people} date={date} timezone={timezone} />
          {waiting.length > 0 && lunches.length > 0 ? (
            <h3 className="fw-subhead">Check-offs</h3>
          ) : null}
          {waiting.length > 0 ? (
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
          ) : null}
        </section>
      ) : null}

      <section className="fw-day" aria-labelledby="day-heading">
        <div className="fw-card">
          <div className="fw-bar">
            <h2 id="day-date">{longDay(date)}</h2>
            <nav aria-label="Days" className="fw-actions">
              <Link href={`/admin/today?date=${shift(date, -1)}`}>Day before</Link>
              {date !== today ? <Link href="/admin/today">Today</Link> : null}
              <Link href={`/admin/today?date=${shift(date, 1)}`}>Day after</Link>
            </nav>
          </div>
          {parts.length === 0 ? <p className="fw-muted">Nothing is due on this day.</p> : null}
        </div>

        {parts.length > 0 ? (
          <form action={dayAction} className="fw-day__parts">
            <input type="hidden" name="request" value={request} />
            <input type="hidden" name="date" value={date} />
            {parts.map((p) => {
              const facts = partFacts(p.items);
              const overdue = p.key === 'overdue';
              return (
                <Fold
                  key={p.key}
                  id={`part-${p.key}`}
                  headingId={`part-${p.key}-heading`}
                  title={p.label}
                  open={partOpen(p.key, p.items, changed)}
                  count={overdue ? undefined : facts.count}
                  waiting={overdue ? overdueWaiting(p.items) : undefined}
                  done={!overdue && facts.finished ? 'All done' : undefined}
                  summary={overdue ? undefined : [<Line key="l" line={facts.line} />]}
                >
                  <ul className="fw-list" aria-labelledby={`part-${p.key}-heading`}>
                    {p.items.map((i) => (
                      <ItemRow key={i.id} item={i} today={today} people={people} selectable />
                    ))}
                  </ul>
                </Fold>
              );
            })}
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
        ) : null}
        <p className="fw-muted">
          Late credit for a past day counts as done by a parent. Skipping a day leaves it out of
          streaks and goals.
        </p>
      </section>
    </main>
  );
}
