import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { noticeFor, type DayAction } from '@/lib/admin-day';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../members/data';
import { loadDay, loadWaiting } from './data';
import { itemLabel } from './item-row';
import { TodayView } from './view';

export const metadata: Metadata = { title: 'Today' };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: readonly DayAction[] = ['done', 'uncheck', 'skip', 'unskip', 'approve', 'reject'];
const ERRORS: Record<string, string> = {
  select: 'Tick the items that weren’t really done first.',
  who: 'Choose who did it.',
  gone: 'That item changed: it was taken off the list.',
  failed: 'That didn’t save. Try again in a moment.',
};

type Params = {
  date?: string;
  did?: string;
  item?: string;
  n?: string;
  kept?: string;
  batch?: string;
  error?: string;
};

/**
 * [CHR-05][CHR-06][CHR-08] A parent's day: any past day for late credit, the days ahead to skip.
 * Read as this admin through RLS; every action is a completion event (D-46).
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<Params> }) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/today');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const params = await searchParams;
  const today = isoDay(household.timezone);
  const date = params.date && ISO_DAY.test(params.date) ? params.date : today;

  const [members, items, waiting] = await Promise.all([
    loadMembers(db!, household.id),
    loadDay(db!, household.id, date, today),
    loadWaiting(db!, household.id),
  ]);
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? 'Someone';

  let notice: string | null = null;
  if (params.did === 'batch') {
    notice = noticeFor('batch', '', Number(params.n) || 0);
  } else if (params.did === 'restored') {
    const n = Number(params.n) || 0;
    const kept = Number(params.kept) || 0;
    notice =
      n === 0
        ? 'Nothing to put back: those items changed since.'
        : `Put back ${n} ${n === 1 ? 'item' : 'items'}, with their points.${
            kept
              ? ` ${kept} changed since and stayed as ${kept === 1 ? 'it was' : 'they were'}.`
              : ''
          }`;
  } else if (params.did && ACTIONS.includes(params.did as DayAction) && params.item) {
    const known = [...items, ...waiting].find((i) => i.id === params.item);
    notice = noticeFor(params.did as DayAction, known ? itemLabel(known, name) : 'it');
  }

  return (
    <TodayView
      date={date}
      today={today}
      timezone={household.timezone}
      items={items}
      waiting={waiting}
      people={members.filter((m) => !m.archivedAt)}
      notice={notice}
      error={params.error ? (ERRORS[params.error] ?? ERRORS.failed!) : null}
      undoBatchId={
        params.did === 'batch' && params.batch && GUID.test(params.batch) ? params.batch : null
      }
      // One request id per page view: a form sent twice records once (and is one batch).
      request={crypto.randomUUID()}
    />
  );
}
