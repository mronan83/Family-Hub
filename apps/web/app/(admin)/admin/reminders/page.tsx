import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { DEFAULT_SETTINGS } from '@/lib/reminder-settings';
import { serverClient } from '@/lib/supabase/server';
import { loadDevices, loadSettings } from './data';
import { RemindersView } from './view';

export const metadata: Metadata = { title: 'Reminders' };

const DID: Record<string, string> = {
  saved: 'Saved.',
  on: 'Reminders are on.',
  off: 'Reminders are off. Your devices stay listed for when you turn them back on.',
  device: 'This device gets your reminders now. Send it a test to see one.',
  test: 'Sent. It should arrive in a moment.',
  off_device: 'That device is switched off.',
  on_device: 'That device is switched on.',
  remove: 'Removed. That device gets nothing more.',
};
const ERRORS: Record<string, string> = {
  no_keys: 'Test notifications work on the live app once reminders are set up there.',
  gone: 'That device can’t get notifications any more, so it was removed. Turn reminders on there again.',
  test_failed: 'That test didn’t arrive. Try again in a moment.',
  failed: 'That didn’t save. Try again in a moment.',
};

/** [CHR-15][CHR-16][CHR-17] The signed-in person's own reminders, read through RLS. */
export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; error?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/reminders');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const { data: me } = await db!
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .eq('user_id', user.userId)
    .is('archived_at', null)
    .maybeSingle();
  const memberId = (me?.id as string | undefined) ?? null;
  const [settings, devices] = memberId
    ? await Promise.all([loadSettings(db!, memberId), loadDevices(db!, memberId)])
    : [DEFAULT_SETTINGS, []];
  return (
    <RemindersView
      me={memberId}
      settings={settings}
      devices={devices}
      vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null}
      timezone={household.timezone}
      notice={params.did ? (DID[params.did] ?? null) : null}
      error={params.error ? (ERRORS[params.error] ?? ERRORS.failed!) : null}
    />
  );
}
