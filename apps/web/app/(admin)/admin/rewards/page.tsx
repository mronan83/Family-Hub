import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadBalances, loadMembers } from '../members/data';
import { loadCatalog, loadRedemptions } from './data';
import { RewardsView } from './view';

export const metadata: Metadata = { title: 'Rewards' };

const DID: Record<string, string> = {
  approve: 'Approved. The points are spent.',
  deny: 'Not this time. Nothing was spent.',
  fulfil: 'Marked as given.',
  cancel: 'Cancelled. Any points spent on it are back.',
};
const ERRORS: Record<string, string> = {
  not_requested: 'That request was already decided.',
  not_cancellable: 'That reward was already given, so it can’t be cancelled.',
  not_approved: 'Approve it before marking it given.',
  not_allowed: 'Only a parent of this family can do that.',
};

/** [PTS-03][PTS-04] The rewards shop and the children's requests, as this admin through RLS. */
export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; error?: string; saved?: string; archived?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/rewards');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const [catalog, redemptions, members, balances] = await Promise.all([
    loadCatalog(db!, household.id),
    loadRedemptions(db!, household.id),
    loadMembers(db!, household.id),
    loadBalances(db!, household.id),
  ]);
  const notice = params.saved
    ? `Saved ${params.saved}.`
    : params.archived
      ? 'Archived. It’s out of the shop.'
      : params.did
        ? (DID[params.did] ?? null)
        : null;
  return (
    <RewardsView
      catalog={catalog}
      redemptions={redemptions}
      members={members}
      balances={balances}
      timezone={household.timezone}
      notice={notice}
      error={params.error ? (ERRORS[params.error] ?? 'That didn’t go through. Try again.') : null}
    />
  );
}
