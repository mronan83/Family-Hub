import { Button, Icon } from '@familywise/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { historyLine, relativeDay } from '@/lib/chores';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { loadMembers } from '../../members/data';
import { setChoreArchived } from '../actions';
import { ChoreForm } from '../chore-form';
import { loadApprovalMode, loadChores, loadComingUp, loadLastWeek, loadTags } from '../data';

export const metadata: Metadata = { title: 'Edit item' };

// [CHR-01][CHR-13] Edit a chore or task. A private item someone else created, and not assigned to
// this admin, is not found (RLS). Only the item's creator is offered the private switch.
export default async function EditChorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/chores/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [chores, members, tags, approvalMode] = await Promise.all([
    loadChores(db!, household.id),
    loadMembers(db!, household.id),
    loadTags(db!, household.id),
    loadApprovalMode(db!, household.id),
  ]);
  const item = chores.find((c) => c.id === id);
  if (!item) notFound();
  const mine = item.createdBy === null || item.createdBy === user.userId;
  const today = isoDay(household.timezone);
  const [comingUp, lastWeek] = await Promise.all([
    loadComingUp(db!, item.id, today),
    loadLastWeek(db!, item.id, today),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.displayName]));
  const name = (id: string) => memberName.get(id) ?? 'Someone';
  const archivedTags = tags.filter((t) => t.archivedAt && item.tags.includes(t.id));

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/chores" />
      <section className="fw-card">
        <h1>{item.title}</h1>
        <ChoreForm
          id={item.id}
          initial={item}
          today={isoDay(household.timezone)}
          members={members.filter((m) => !m.archivedAt)}
          tags={tags.filter((t) => !t.archivedAt)}
          approvalMode={approvalMode}
          offerVisibility={mine}
        />
        {archivedTags.length > 0 ? (
          <p className="fw-muted">
            Also tagged {archivedTags.map((t) => t.name).join(', ')} (archived), which stays for
            goals and history.
          </p>
        ) : null}
        {!mine ? (
          <p className="fw-muted">
            {item.visibility === 'private'
              ? 'This is private: only its creator and the people it’s for who sign in can see it.'
              : 'Only the person who created this item can make it private.'}
          </p>
        ) : null}
      </section>
      <section className="fw-card" aria-labelledby="coming-up-heading">
        <h2 id="coming-up-heading">Coming up</h2>
        {comingUp.length === 0 ? (
          <p className="fw-muted">
            Nothing in the next two weeks. Check its schedule, who it’s for, and its days.
          </p>
        ) : (
          <ul className="fw-list" aria-label="Coming up">
            {comingUp.map((day) => (
              <li key={day.dueDate} className="fw-list__row">
                <strong>{relativeDay(day.dueDate, today)}</strong>
                <span className="fw-muted">
                  {day.members.map(name).join(' and ')}
                  {day.occurrences.some((o) => o.memberId) && day.members.length > 1
                    ? ', each their own'
                    : ''}
                </span>
                {day.occurrences
                  .filter((o) => o.status !== 'scheduled')
                  .map((o) => (
                    <HistoryLine key={o.id} line={historyLine(o, item.kind, name)} />
                  ))}
              </li>
            ))}
          </ul>
        )}
        <p className="fw-muted">
          The next two weeks are planned ahead. A change applies from today; days already past keep
          what they were.
        </p>
      </section>
      <section className="fw-card" aria-labelledby="last-week-heading">
        <h2 id="last-week-heading">Last 7 days</h2>
        {lastWeek.length === 0 ? (
          <p className="fw-muted">Nothing was due in the last week.</p>
        ) : (
          <ul className="fw-list" aria-label="Last 7 days">
            {lastWeek.map((day) => (
              <li key={day.dueDate} className="fw-list__row">
                <strong>{relativeDay(day.dueDate, today)}</strong>
                {day.occurrences.map((o) => (
                  <HistoryLine key={o.id} line={historyLine(o, item.kind, name)} />
                ))}
              </li>
            ))}
          </ul>
        )}
        <p className="fw-muted">
          Each check-off, undo and parent decision is kept, so a day&rsquo;s result can always be
          worked out again. A routine not done by the end of its day is missed; a task stays open.
        </p>
      </section>
      <section className="fw-card" aria-labelledby="archive-heading">
        <h2 id="archive-heading">{item.archivedAt ? 'Restore' : 'Archive'}</h2>
        <p className="fw-muted">
          {item.archivedAt
            ? 'Put it back on the list and the board.'
            : 'It leaves the list and the board. Its history stays, and you can restore it.'}
        </p>
        <form action={setChoreArchived}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="archive" value={item.archivedAt ? 'false' : 'true'} />
          <Button type="submit" variant="ghost" icon={item.archivedAt ? 'undo' : 'minus-circle'}>
            {item.archivedAt ? `Restore ${item.title}` : `Archive ${item.title}`}
          </Button>
        </form>
      </section>
    </main>
  );
}

/** A day's status as an icon and words, in its tone (06 §7.1). */
function HistoryLine({ line }: { line: ReturnType<typeof historyLine> }) {
  return (
    <span className={`fw-history fw-history--${line.tone}`}>
      <Icon name={line.icon} size={20} />
      {line.text}
    </span>
  );
}
