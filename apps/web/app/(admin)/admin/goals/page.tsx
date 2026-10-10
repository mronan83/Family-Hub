import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { goalRefusal } from '@/lib/goals';
import { serverClient } from '@/lib/supabase/server';
import { loadGoals } from './data';
import { bringGoalsUpToDate, loadGoalContext } from './load';
import { GoalsView } from './view';

export const metadata: Metadata = { title: 'Goals' };

const DID: Record<string, string> = {
  redeem: 'Marked redeemed. It’s in the history.',
  cancel: 'Cancelled. It’s in the history.',
  review: 'Cleared.',
};

/** [RWD-01][RWD-04][RWD-09] The family's goals, brought up to date first, as this admin through RLS. */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; error?: string; saved?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/goals');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const stale = await bringGoalsUpToDate(db!, household.id);
  const [goals, ctx] = await Promise.all([
    loadGoals(db!, household.id),
    loadGoalContext(db!, household.id),
  ]);
  const notice = params.saved
    ? `Saved ${params.saved}.`
    : params.did
      ? (DID[params.did] ?? null)
      : stale;
  return (
    <GoalsView
      goals={goals}
      members={ctx.members}
      names={ctx.names}
      admins={ctx.adminNames}
      timezone={household.timezone}
      notice={notice}
      error={params.error ? goalRefusal({ hint: params.error }) : null}
    />
  );
}
