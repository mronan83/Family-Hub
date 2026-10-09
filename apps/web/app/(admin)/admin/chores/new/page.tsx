import { Banner } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { loadMembers } from '../../members/data';
import { ChoreForm } from '../chore-form';
import { loadApprovalMode, loadTags } from '../data';

export const metadata: Metadata = { title: 'Add to the list' };

// [CHR-01] Add a chore or a task. "Save and add another" comes back here with the same kind, so a
// parent can enter the whole family list in one go.
export default async function NewChorePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; saved?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/chores/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, tags, approvalMode] = await Promise.all([
    loadMembers(db!, household.id),
    loadTags(db!, household.id),
    loadApprovalMode(db!, household.id),
  ]);
  const { kind, saved } = await searchParams;
  const defaultKind = kind === 'task' ? 'task' : 'chore';

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/chores" />
      {saved ? <Banner kind="info">Saved {saved}. Add the next one.</Banner> : null}
      <section className="fw-card">
        <h1>{defaultKind === 'task' ? 'Add a task' : 'Add a chore'}</h1>
        <ChoreForm
          key={saved ?? 'first'}
          defaultKind={defaultKind}
          today={isoDay(household.timezone)}
          members={members.filter((m) => !m.archivedAt)}
          tags={tags.filter((t) => !t.archivedAt)}
          approvalMode={approvalMode}
          offerVisibility
        />
      </section>
    </main>
  );
}
