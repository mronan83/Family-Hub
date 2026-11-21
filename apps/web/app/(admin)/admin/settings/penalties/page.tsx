import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadPenaltyRules, loadPenaltySettings } from '../../penalties/data';
import { loadMembers } from '../../members/data';
import { PenaltySettingsView } from './view';

export const metadata: Metadata = { title: 'Penalties' };

/**
 * [PTS-09][US-1111] Settings, Penalties (WP-120): the on/off and the reasons, read through RLS;
 * [PTS-10][US-1112] and the penalty rules (WP-121).
 */
export default async function PenaltySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/settings/penalties');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [{ on, reasons }, rules, members, params] = await Promise.all([
    loadPenaltySettings(db!, household.id),
    loadPenaltyRules(db!, household.id),
    loadMembers(db!, household.id),
    searchParams,
  ]);
  return (
    <PenaltySettingsView
      on={on}
      reasons={reasons}
      rules={rules}
      names={Object.fromEntries(members.map((m) => [m.id, m.displayName]))}
      notice={params.done ?? null}
    />
  );
}
