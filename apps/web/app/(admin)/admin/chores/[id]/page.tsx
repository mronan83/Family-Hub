import { Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { loadMembers } from '../../members/data';
import { setChoreArchived } from '../actions';
import { ChoreForm } from '../chore-form';
import { loadApprovalMode, loadChores, loadTags } from '../data';

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
