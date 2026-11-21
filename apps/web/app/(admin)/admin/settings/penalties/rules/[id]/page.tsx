import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadRuleForm } from '../load';
import { RuleView } from '../view';

export const metadata: Metadata = { title: 'Penalty rule' };

/** [PTS-10][US-1112] A penalty rule, changed (WP-121). */
export default async function PenaltyRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/settings/penalties/rules/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const f = await loadRuleForm(db!, household, id);
  if (!f.rule) notFound();
  return <RuleView {...f} />;
}
