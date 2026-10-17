import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { loadDayTypes, loadYears } from './data';
import { type SchoolSection, SchoolView } from './view';

export const metadata: Metadata = { title: 'School year' };

// [SCH-01][SCH-02] The household's school years and what kind of day today is for each member, read
// through RLS; [NFR-18] ?open= the section saved in, open again (WP-94).
export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; open?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/school');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const today = isoDay(household.timezone);
  const [years, members, todayTypes, settings] = await Promise.all([
    loadYears(db!, household.id),
    loadMembers(db!, household.id),
    loadDayTypes(db!, household.id, today),
    db!
      .from('household_settings')
      .select('lunch_cutoff')
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);
  // [MEAL-09] The morning cut-off for lunch changes on the board (WP-49): 8:00 am by default.
  const cutoff = String(settings.data?.lunch_cutoff ?? '08:00').slice(0, 5);
  const typeOf = new Map(todayTypes.map((t) => [t.memberId, t]));
  const { saved, open } = await searchParams;

  return (
    <SchoolView
      today={today}
      members={members
        .filter((m) => !m.archivedAt)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          avatarKey: m.avatarKey,
          color: m.color,
          today: typeOf.get(m.id) ?? null,
        }))}
      years={years}
      cutoff={cutoff}
      saved={saved ?? null}
      open={(['lunch', 'add', 'archived'] as SchoolSection[]).find((s) => s === open) ?? null}
    />
  );
}
