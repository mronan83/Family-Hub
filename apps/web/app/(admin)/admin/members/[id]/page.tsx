import { Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { setArchived } from '../actions';
import { loadAdmins, loadMembers } from '../data';
import { MemberForm } from '../member-form';

export const metadata: Metadata = { title: 'Edit member' };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/members/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
  ]);
  const member = members.find((m) => m.id === id);
  if (!member) notFound();
  const linkedElsewhere = new Set(
    members.filter((m) => m.id !== id && m.userId).map((m) => m.userId),
  );

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/members" />
      <section className="fw-card">
        <h1>{member.displayName}</h1>
        <MemberForm
          id={member.id}
          initial={member}
          admins={admins.filter((a) => !linkedElsewhere.has(a.userId))}
        />
      </section>
      {!member.archivedAt ? (
        <section className="fw-card" aria-labelledby="archive-heading">
          <h2 id="archive-heading">Archive</h2>
          <p className="fw-muted">
            {member.displayName} leaves the board and their chores and goals stop showing. Their
            history stays, and you can restore them from Members.
          </p>
          <form action={setArchived}>
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="archive" value="true" />
            <Button type="submit" variant="ghost" icon="minus-circle">
              Archive {member.displayName}
            </Button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
