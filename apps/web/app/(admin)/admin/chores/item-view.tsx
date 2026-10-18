import { Button, Fold, Icon } from '@familywise/ui';
import Link from 'next/link';
import { comingUpLine, lastWeekLine } from '@/lib/chore-sections';
import { clock, historyLine, relativeDay } from '@/lib/chores';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import type { MemberRow } from '../members/data';
import type { NavWho } from '../nav';
import { setChoreArchived } from './actions';
import { ChoreForm } from './chore-form';
import type { ChoreRow, ItemDay, TagRow } from './data';

/**
 * [CHR-01][CHR-13][NFR-18][D-120] An item's page, folded as the fold audit draws it (WP-96): the
 * form's main fields open, More options folded to how it is set; Coming up (the next one, how many
 * in two weeks) and Last 7 days (done, missed, skipped) folded; Archive set apart at the bottom.
 */
export function ItemView({
  item,
  members,
  tags,
  approvalMode,
  mine,
  today,
  comingUp,
  lastWeek,
  open = null,
  waiting,
  who,
}: {
  item: ChoreRow;
  members: MemberRow[];
  tags: TagRow[];
  approvalMode: 'on' | 'off';
  /** The admin created it, so they are offered the private switch. */
  mine: boolean;
  today: string;
  comingUp: ItemDay[];
  lastWeek: ItemDay[];
  /** A fold opened: coming-up or last-week. */
  open?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const memberName = new Map(members.map((m) => [m.id, m.displayName]));
  const name = (id: string) => memberName.get(id) ?? 'Someone';
  const archivedTags = tags.filter((t) => t.archivedAt && item.tags.includes(t.id));

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/chores" waiting={waiting} who={who} />
      <Link className="fw-crumb" href="/admin/chores">
        <Icon name="chevron-left" size={18} />
        Chores
      </Link>
      <section className="fw-card">
        <h1>{item.title}</h1>
        <ChoreForm
          id={item.id}
          initial={item}
          today={today}
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
      <Fold
        id="coming-up"
        title="Coming up"
        headingId="coming-up-heading"
        open={open === 'coming-up'}
        summary={[
          <Line
            key="n"
            line={comingUpLine(comingUp, {
              today,
              time: item.dueTime ? clock(item.dueTime) : null,
              name,
              relative: relativeDay,
            })}
          />,
        ]}
      >
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
      </Fold>
      <Fold
        id="last-week"
        title="Last 7 days"
        headingId="last-week-heading"
        open={open === 'last-week'}
        summary={[<Line key="l" line={lastWeekLine(lastWeek, item.kind)} />]}
      >
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
      </Fold>
      <Fold
        id="archive"
        title={item.archivedAt ? 'Restore' : 'Archive'}
        headingId="archive-heading"
        summary={[
          item.archivedAt
            ? 'Puts it back on the list and the boards'
            : 'Takes it off the list and the boards; its history stays',
        ]}
      >
        <p className="fw-muted">
          {item.archivedAt
            ? `${item.title} goes back on the list and the boards.`
            : `${item.title} leaves the list and the boards. Its history stays, and Restore puts it back.`}
        </p>
        <form action={setChoreArchived}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="archive" value={item.archivedAt ? 'false' : 'true'} />
          <div className="fw-actions">
            <Button
              type="submit"
              variant={item.archivedAt ? 'secondary' : 'danger'}
              icon={item.archivedAt ? 'undo' : 'archive'}
            >
              {item.archivedAt ? `Restore ${item.title}` : `Archive ${item.title}`}
            </Button>
          </div>
        </form>
      </Fold>
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
