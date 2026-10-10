import { Banner } from '@familywise/ui';
import Link from 'next/link';
import { myTaskGroups, type DayItem } from '@/lib/admin-day';
import { relativeDay } from '@/lib/chores';
import { AdminHeader } from '../header';
import { dayAction } from '../today/actions';
import { ItemRow, type Person } from '../today/item-row';
import { QuickAdd } from './quick-add';

export interface MyTasksViewProps {
  today: string;
  /** The member linked to this sign-in; null when there is none yet. */
  me: string | null;
  items: DayItem[];
  people: Person[];
  notice: string | null;
  error: string | null;
  request: string;
}

/**
 * [CHR-14][US-316] My tasks, for a parent on their phone: what I'm on, overdue first, then today's
 * and the week ahead, shared items included; done in one tap, credited to me; and quick add.
 */
export function MyTasksView({
  today,
  me,
  items,
  people,
  notice,
  error,
  request,
}: MyTasksViewProps) {
  if (!me) {
    return (
      <main className="fw-page">
        <AdminHeader current="/admin/my" />
        <section className="fw-card">
          <h1>My tasks</h1>
          <p>
            Your sign-in isn’t linked to anyone in the family yet. On{' '}
            <Link href="/admin/members">Members</Link>, open yourself and choose your sign-in under
            “Their sign-in”.
          </p>
        </section>
      </main>
    );
  }
  const groups = myTaskGroups(items, today);
  const group = (key: string, heading: string, list: DayItem[], showDay: boolean) => (
    <section key={key} aria-labelledby={`my-${key}`}>
      <h2 id={`my-${key}`} className="fw-subhead">
        {heading}
      </h2>
      {list.length === 0 ? (
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
              extra={
                showDay ? <span className="fw-muted">{relativeDay(i.dueDate, today)}</span> : null
              }
            />
          ))}
        </ul>
      )}
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
      <section className="fw-card" aria-labelledby="my-heading">
        <h1 id="my-heading">My tasks</h1>
        <QuickAdd />
      </section>
      <section className="fw-card">
        <form action={dayAction} className="fw-form">
          <input type="hidden" name="request" value={request} />
          <input type="hidden" name="back" value="/admin/my" />
          {groups.overdue.length > 0 ? group('overdue', 'Overdue', groups.overdue, true) : null}
          {group('today', 'Today', groups.today, false)}
          {group('upcoming', 'Coming up', groups.upcoming, true)}
        </form>
      </section>
    </main>
  );
}
