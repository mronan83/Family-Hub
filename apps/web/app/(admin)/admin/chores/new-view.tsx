import { Banner, Icon } from '@familywise/ui';
import Link from 'next/link';
import { duplicateOf } from '@/lib/chore-sections';
import { calendarDay } from '@/lib/chores';
import { AdminHeader } from '../header';
import type { MemberRow } from '../members/data';
import type { NavWho } from '../nav';
import { ChoreForm } from './chore-form';
import type { ChoreRow, TagRow } from './data';

/**
 * [CHR-01] Add a chore or a task; [CHR-22][CHR-23] with `original`, Duplicate's form filled in from
 * it, named "(copy)", or with `date` too, Do again's "Change more first" (D-132).
 */
export function NewItemView({
  members,
  tags,
  approvalMode,
  today,
  kind,
  saved,
  original,
  date,
  waiting,
  who,
}: {
  members: MemberRow[];
  tags: TagRow[];
  approvalMode: 'on' | 'off';
  today: string;
  kind?: string;
  saved?: string;
  original?: ChoreRow;
  /** Do again's date. */
  date?: string;
  waiting?: number;
  who?: NavWho | null;
}) {
  const from = original?.id;
  const initial = original ? duplicateOf(original, date) : undefined;
  const defaultKind = (initial?.kind ?? kind) === 'task' ? 'task' : 'chore';
  const active = tags.filter((t) => !t.archivedAt);

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/chores" waiting={waiting} who={who} />
      <Link className="fw-crumb" href="/admin/chores">
        <Icon name="chevron-left" size={18} />
        Chores
      </Link>
      {saved ? <Banner kind="info">Saved {saved}. Add the next one.</Banner> : null}
      <section className="fw-card">
        <h1>{defaultKind === 'task' ? 'Add a task' : 'Add a chore'}</h1>
        {original ? (
          <Banner kind="info">
            {date ? (
              <>
                Do again: <b>{original.title}</b>, on {calendarDay(date)}. Nothing is saved until
                you tap <b>Save</b>.
              </>
            ) : (
              <>
                A copy of <b>{original.title}</b>. Nothing is saved until you tap <b>Save</b>.
              </>
            )}
          </Banner>
        ) : null}
        <ChoreForm
          key={saved ?? from ?? 'first'}
          initial={
            initial
              ? {
                  ...initial,
                  assignees: initial.assignees.filter((id) =>
                    members.some((m) => m.id === id && !m.archivedAt),
                  ),
                  tags: initial.tags.filter((id) => active.some((t) => t.id === id)),
                }
              : undefined
          }
          defaultKind={defaultKind}
          today={today}
          members={members.filter((m) => !m.archivedAt)}
          tags={active}
          approvalMode={approvalMode}
          offerVisibility
          note={
            original
              ? 'Its history, points and goal credit stay with the original. The copy starts fresh.'
              : undefined
          }
        />
      </section>
    </main>
  );
}
