import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadPenaltySettings } from '../../penalties/data';
import { PenaltySettingsView } from './view';

export const metadata: Metadata = { title: 'Penalties' };

/** [PTS-09][US-1111] Settings, Penalties (WP-120): the on/off and the reasons, read through RLS. */
export default async function PenaltySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/settings/penalties');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [{ on, reasons }, params] = await Promise.all([
    loadPenaltySettings(db!, household.id),
    searchParams,
  ]);
  return <PenaltySettingsView on={on} reasons={reasons} notice={params.done ?? null} />;
}
