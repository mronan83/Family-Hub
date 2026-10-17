import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../../members/data';
import { loadYear } from '../data';
import { SchoolYearView, type YearSection } from '../view';

export const metadata: Metadata = { title: 'School year' };

// [SCH-01][SCH-02] One school year, read through RLS: its dates, the timeline of school days, breaks
// and days off, its terms, and who follows it; [NFR-18] ?open= the section saved in (WP-94).
export default async function SchoolYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; open?: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/school/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [loaded, members] = await Promise.all([
    loadYear(db!, household.id, id),
    loadMembers(db!, household.id),
  ]);
  if (!loaded) notFound();
  const { saved, open } = await searchParams;

  return (
    <SchoolYearView
      {...loaded}
      members={members.filter((m) => !m.archivedAt)}
      weekStart={household.weekStart}
      today={isoDay(household.timezone)}
      saved={saved ?? null}
      open={
        (['closures', 'terms', 'followers', 'dates'] as YearSection[]).find((s) => s === open) ??
        null
      }
    />
  );
}
