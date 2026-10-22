import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadAdmins, loadBalances, loadMembers } from './data';
import { MembersView } from './view';

export const metadata: Metadata = { title: 'Members' };

// [ACC-04][PTS-07][PTS-02] The household's members: children and adults, with avatar, color, whether
// they earn rewards and their points. Archived members keep their history and can be restored.
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/members');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins, balances] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
    loadBalances(db!, household.id),
  ]);
  const { saved, archived } = await searchParams;
  return (
    <MembersView
      members={members}
      emailOf={new Map(admins.map((a) => [a.userId, a.email]))}
      balances={balances}
      saved={saved}
      archivedOpen={Boolean(archived)}
    />
  );
}
