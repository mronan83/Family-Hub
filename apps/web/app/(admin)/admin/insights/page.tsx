import { ENGINE_VERSION } from '@familywise/rules-engine';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { dayBefore, type Insights, rebuildMemberHistory } from '@/lib/history';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { rebuildHistory } from './actions';
import { InsightsView, RANGES, type Range } from './view';

export const metadata: Metadata = { title: 'Insights' };

/** `days` days ending on `to`, as ISO dates. */
function rangeFrom(to: string, days: number): string {
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// [RWD-12] Insights (WP-17, D-55): one member at a time, over the last 7, 30 or 90 closed days. A
// member whose history is behind (their occurrences changed since it was built, or an older engine
// built it) is rebuilt first, so the page never shows yesterday's view of last week.
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; days?: string; history?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/insights');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;

  const { data: memberRows, error: mError } = await db!
    .from('member')
    .select('id, display_name, role')
    .eq('household_id', household.id)
    .is('archived_at', null)
    .order('role', { ascending: false })
    .order('display_name');
  if (mError) throw new Error(`members: ${mError.message}`);
  const members = (memberRows ?? []).map((m) => ({
    id: m.id as string,
    name: m.display_name as string,
  }));
  if (members.length === 0) redirect('/admin/members');
  const memberId = members.some((m) => m.id === params.member) ? params.member! : members[0]!.id;
  const days = Number(params.days);
  const range: Range = (RANGES as readonly number[]).includes(days) ? (days as Range) : 30;
  const through = dayBefore(isoDay(household.timezone));

  let notice: string | null =
    params.history === 'rebuilt'
      ? 'History rebuilt from every check-off.'
      : params.history === 'failed'
        ? 'The history couldn’t be rebuilt just now; this shows the last one saved.'
        : null;
  const { data: stale } = await db!.rpc('member_history_stale', {
    p_member: memberId,
    p_engine_version: ENGINE_VERSION,
  });
  if (stale) {
    try {
      await rebuildMemberHistory(db!, memberId, through);
    } catch (e) {
      log('warn', 'history not rebuilt', { error: String(e) });
      notice =
        'The history couldn’t be brought up to date just now; this shows the last one saved.';
    }
  }

  const { data, error } = await db!.rpc('member_insights', {
    p_member: memberId,
    p_from: rangeFrom(through, range),
    p_to: through,
  });
  if (error) throw new Error(`insights: ${error.message}`);

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/insights" />
      <InsightsView
        members={members}
        memberId={memberId}
        range={range}
        insights={data as Insights}
        weekStart={household.weekStart}
        notice={notice}
        basePath="/admin/insights"
        rebuild={rebuildHistory}
      />
    </main>
  );
}
