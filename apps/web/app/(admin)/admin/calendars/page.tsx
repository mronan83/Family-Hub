import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { loadCalendars } from './data';
import { CalendarsView } from './view';

export const metadata: Metadata = { title: 'Calendars' };

const DID: Record<string, (name: string) => string> = {
  added_synced: (n) => `Added ${n} and synced it.`,
  added_failed: (n) => `Added ${n}, but it didn’t sync. See what went wrong below.`,
  saved_synced: (n) => `Saved ${n} with its new link, and synced it.`,
  saved_failed: (n) => `Saved ${n}, but the new link didn’t sync. See what went wrong below.`,
  saved: (n) => `Saved ${n}.`,
  removed: (n) => `Removed ${n}. It stays in Apple Calendar.`,
};
const ERRORS: Record<string, string> = {
  remove: 'That calendar wasn’t removed. Try again in a moment.',
};

/** [CAL-01][CAL-06] The household's calendars, read through RLS (WP-22). */
export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; name?: string; error?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/calendars');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const [calendars, members] = await Promise.all([
    loadCalendars(db!, household.id),
    loadMembers(db!, household.id),
  ]);
  const did = params.did ? DID[params.did]?.(params.name ?? 'the calendar') : undefined;
  // A link that didn't sync is said as a notice; the calendar's own line says why.
  const failed = params.did?.endsWith('_failed') ?? false;
  return (
    <CalendarsView
      calendars={calendars}
      members={members
        .filter((m) => !m.archivedAt)
        .map((m) => ({ id: m.id, displayName: m.displayName }))}
      timezone={household.timezone}
      notice={did && !failed ? did : null}
      error={params.error ? (ERRORS[params.error] ?? null) : failed ? (did ?? null) : null}
    />
  );
}
