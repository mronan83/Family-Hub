import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { loadAdmins, loadMembers } from '../data';
import { MemberForm } from '../member-form';

export const metadata: Metadata = { title: 'Add a member' };

export default async function NewMemberPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/members/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
  ]);
  const linked = new Set(members.map((m) => m.userId).filter(Boolean));
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/members" />
      <section className="fw-card">
        <h1>Add a member</h1>
        <MemberForm admins={admins.filter((a) => !linked.has(a.userId))} />
      </section>
    </main>
  );
}
