import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { parseRegisterQuery } from '@/lib/points-register';
import { serverClient } from '@/lib/supabase/server';
import { loadAdmins, loadBalances, loadMembers } from '../../members/data';
import { loadBonusRules } from '../data';
import { loadRegister } from '../register-data';
import { RegisterView } from '../register-view';

export const metadata: Metadata = { title: 'Points register' };

/** [PTS-08] The household points register (WP-115, D-147), as this admin through RLS. */
export default async function PointsRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/rewards/points');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const filters = parseRegisterQuery(await searchParams);
  const [members, admins, balances, rules, register] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
    loadBalances(db!, household.id),
    loadBonusRules(db!, household.id),
    loadRegister(db!, household.id, filters),
  ]);
  // An entry names the parent who posted it: their member name, else their email.
  const adminName = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ??
    admins.find((a) => a.userId === userId)?.email ??
    'a parent';
  const chips = members.filter(
    (m) => (m.earnsRewards && !m.archivedAt) || balances.has(m.id) || filters.who.includes(m.id),
  );
  return (
    <RegisterView
      filters={filters}
      entries={register.entries}
      totals={register.totals}
      chips={chips}
      members={members}
      rules={rules}
      adminName={adminName}
      timezone={household.timezone}
      today={isoDay(household.timezone)}
      moreOpen={filters.types.length > 0 || !!filters.from || !!filters.to || !!filters.rule}
    />
  );
}
