import { Banner } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { HEADING_LABELS, headingFor, parseChoreFilters } from '@/lib/chore-sections';
import { dueSummary } from '@/lib/chores';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { loadChores, loadOccurrenceDates, loadOnceOccurrences, loadTags } from './data';
import { choresBanner, ChoresView } from './view';

export const metadata: Metadata = { title: 'Chores and tasks' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// [CHR-01][CHR-21][D-132] The family list in four sections (WP-96): every member's chores and tasks,
// read through RLS (private items only for their creator and assignees who sign in), with each
// one-time item's occurrences for its section and a recurring task's oldest day left open.
export default async function ChoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/chores');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const today = isoDay(household.timezone);
  const lookback = new Date(Date.parse(`${today}T12:00:00Z`) - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [chores, tags, members, recent] = await Promise.all([
    loadChores(db!, household.id),
    loadTags(db!, household.id),
    loadMembers(db!, household.id),
    loadOccurrenceDates(db!, household.id, lookback),
  ]);
  const once = await loadOnceOccurrences(
    db!,
    household.id,
    chores.filter((c) => c.schedule.freq === 'once').map((c) => c.id),
  );
  const due = dueSummary(recent, today);
  const overdueSince = Object.fromEntries(
    chores.map((c) => [
      c.id,
      c.schedule.freq === 'once' ? null : (due.get(c.id)?.overdueSince ?? null),
    ]),
  );
  const p = await searchParams;
  const older = Math.min(50, Math.max(0, Number.parseInt(one(p.older), 10) || 0));
  const on = one(p.on);
  const banner =
    one(p.failed) === 'again' ? (
      <Banner kind="notice">That didn’t add. Try again in a moment.</Banner>
    ) : (
      choresBanner({
        saved: one(p.saved) || undefined,
        archived: one(p.archived) || undefined,
        restored: one(p.restored) || undefined,
        added: one(p.added) || undefined,
        on: /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined,
        heading: /^\d{4}-\d{2}-\d{2}$/.test(on)
          ? HEADING_LABELS[headingFor(on, today, household.weekStart)]
          : undefined,
      })
    );

  return (
    <ChoresView
      items={chores}
      occurrences={once}
      overdueSince={overdueSince}
      members={members.filter((m) => !m.archivedAt)}
      tags={tags}
      query={{
        filters: parseChoreFilters(p),
        open: one(p.open) || null,
        older,
        again: one(p.again) || null,
      }}
      today={today}
      weekStart={household.weekStart}
      timeZone={household.timezone}
      banner={banner}
    />
  );
}
