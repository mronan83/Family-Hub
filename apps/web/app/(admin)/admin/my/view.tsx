import { Banner, Button, Fold } from '@familywise/ui';
import Link from 'next/link';
import { myTaskGroups, type DayItem } from '@/lib/admin-day';
import { relativeDay } from '@/lib/chores';
import { comingUpLine } from '@/lib/day-folds';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { type LinkCandidate, LinkMe } from '../link-me';
import { setBell } from '../reminders/actions';
import { dayAction } from '../today/actions';
import { ItemRow, type Person } from '../today/item-row';
import { QuickAdd } from './quick-add';

export interface MyTasksViewProps {
  today: string;
  /** The member linked to this sign-in; null when there is none yet. */
  me: string | null;
  /** [D-61] Without one: the adults this sign-in can be linked to, to choose from here. */
  candidates?: LinkCandidate[];
  items: DayItem[];
  people: Person[];
  notice: string | null;
  error: string | null;
  request: string;
  /** [CHR-16] Each item's bell for me (chore id to on, off, or null for my default). */
  bells: Map<string, boolean | null>;
  /** My default for items that don't say, and whether my reminders are on at all. */
  defaultOn: boolean;
  remindersOn: boolean;
}

/**
 * [CHR-14][US-316] My tasks, for a parent on their phone: what I'm on, overdue first, then today's
 * and the week ahead, shared items included; done in one tap, credited to me; and quick add.
 * [NFR-18][D-120] As the fold audit draws it (WP-97): the title above the cards; Overdue and Today
 * open; Coming up folded to how many in the next seven days and the next one.
 */
export function MyTasksView({
  today,
  me,
  candidates = [],
  items,
  people,
  notice,
  error,
  request,
  bells,
  defaultOn,
  remindersOn,
}: MyTasksViewProps) {
  if (!me) {
    return (
      <main className="fw-page">
        <AdminHeader current="/admin/my" />
        <section className="fw-card">
          <h1>My tasks</h1>
          {error ? <Banner kind="notice">{error}</Banner> : null}
          <LinkMe candidates={candidates} back="/admin/my" purpose="your own tasks" />
        </section>
      </main>
    );
  }
  const groups = myTaskGroups(items, today);
  // [CHR-16][US-318] The bell: this item reminds me, or not; it follows my default until I say.
  const bell = (i: DayItem) => {
    // Only on what is still to do: nothing comes for an item once it's done.
    if (!bells.has(i.choreId) || (i.status !== 'scheduled' && i.status !== 'rejected')) return null;
    const on = bells.get(i.choreId) ?? defaultOn;
    return (
      <Button
        type="submit"
        formAction={setBell.bind(null, `${i.choreId}:${on ? 'off' : 'on'}`)}
        variant="ghost"
        icon="bell"
        className="fw-bell"
        aria-pressed={on}
        aria-label={`Remind me about ${i.title}`}
        data-bell={on ? 'on' : 'off'}
      >
        {on ? 'Bell on' : 'Bell off'}
      </Button>
    );
  };
  const rows = (key: string, list: DayItem[], showDay: boolean) =>
    list.length === 0 ? (
      <p className="fw-muted">{key === 'today' ? 'Nothing for you today.' : 'Nothing yet.'}</p>
    ) : (
      <ul className="fw-list" aria-labelledby={`my-${key}`}>
        {list.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            today={today}
            people={people}
            me={me}
            only={['done', 'uncheck']}
            tail={bell(i)}
            extra={
              showDay ? <span className="fw-muted">{relativeDay(i.dueDate, today)}</span> : null
            }
          />
        ))}
      </ul>
    );
  const group = (key: string, heading: string, list: DayItem[], showDay: boolean) => (
    <section key={key} className="fw-card" aria-labelledby={`my-${key}`}>
      <h2 id={`my-${key}`}>{heading}</h2>
      {rows(key, list, showDay)}
    </section>
  );

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/my" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}
      <header className="fw-my__head">
        <h1 id="my-heading">My tasks</h1>
        <p className="fw-muted">
          {remindersOn ? 'Your reminders are on' : 'Your reminders are off'}:{' '}
          <Link href="/admin/reminders">Reminders</Link>.
        </p>
      </header>
      <section className="fw-card">
        <QuickAdd />
      </section>
      <form action={dayAction} className="fw-my__groups">
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="back" value="/admin/my" />
        {groups.overdue.length > 0 ? group('overdue', 'Overdue', groups.overdue, true) : null}
        {group('today', 'Today', groups.today, false)}
        <Fold
          title="Coming up"
          headingId="my-upcoming"
          summary={[<Line key="l" line={comingUpLine(groups.upcoming, today)} />]}
        >
          {rows('upcoming', groups.upcoming, true)}
        </Fold>
      </form>
    </main>
  );
}
