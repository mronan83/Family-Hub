import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadRuleForm } from '../load';
import { RuleView } from '../view';

export const metadata: Metadata = { title: 'Add a penalty rule' };

/** [PTS-10][US-1112] Add a penalty rule (WP-121). */
export default async function NewPenaltyRulePage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/settings/penalties/rules/new');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const f = await loadRuleForm(db!, household, null);
  return <RuleView {...f} rule={null} />;
}
