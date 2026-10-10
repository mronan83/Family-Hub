import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadBalances, loadMembers } from '../members/data';
import { loadBonusRules, loadCatalog, loadRedemptions, loadWishes } from './data';
import { RewardsView } from './view';

export const metadata: Metadata = { title: 'Rewards' };

const DID: Record<string, string> = {
  approve: 'Approved. The points are spent.',
  deny: 'Not this time. Nothing was spent.',
  fulfil: 'Marked as given.',
  cancel: 'Cancelled. Any points spent on it are back.',
};
const BONUS: Record<string, string> = {
  added: 'Bonus added. It pays overnight, once a day is over.',
  off: 'Turned off. It pays nothing until it’s back on.',
  on: 'Turned on. It counts from today.',
  archive: 'Archived. Bonuses it paid stay.',
};
const ERRORS: Record<string, string> = {
  bonus_gone: 'That bonus isn’t there any more.',
  history: 'The children’s history couldn’t be brought up to date just now. Try again in a moment.',
  not_requested: 'That request was already decided.',
  not_cancellable: 'That reward was already given, so it can’t be cancelled.',
  not_approved: 'Approve it before marking it given.',
  not_allowed: 'Only a parent of this family can do that.',
};

/** [PTS-03][PTS-04] The rewards shop and the children's requests, as this admin through RLS. */
export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    did?: string;
    error?: string;
    saved?: string;
    archived?: string;
    bonus?: string;
    posted?: string;
  }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/rewards');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const [catalog, redemptions, members, balances, bonusRules, wishes] = await Promise.all([
    loadCatalog(db!, household.id),
    loadRedemptions(db!, household.id),
    loadMembers(db!, household.id),
    loadBalances(db!, household.id),
    loadBonusRules(db!, household.id),
    loadWishes(db!, household.id),
  ]);
  const posted = Number(params.posted ?? 0);
  const notice = params.bonus
    ? params.bonus === 'paid'
      ? posted > 0
        ? `Paid ${posted === 1 ? 'one bonus' : `${posted} bonuses`}.`
        : 'No new bonuses to pay.'
      : (BONUS[params.bonus] ?? null)
    : params.saved
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
      today={isoDay(household.timezone)}
      bonusRules={bonusRules}
      wishes={wishes}
      notice={notice}
      error={params.error ? (ERRORS[params.error] ?? 'That didn’t go through. Try again.') : null}
    />
  );
}
