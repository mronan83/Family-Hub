'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eventId } from '@/lib/admin-day';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import type { CompletionResult } from '@/lib/completions';
import { isoDay } from '@/lib/format';
import { evaluateStoredGoal } from '@/lib/goals';
import { log } from '@/lib/log';
import {
  canMarkOnTime,
  householdNow,
  onTimeInstant,
  type onTimeState,
  readOnTime,
} from '@/lib/on-time';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from './members/data';
import { loadCheckOffs, loadOnTimeOccurrence, onTimeChanges } from './on-time';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Back to the admin page the form came from (Today on its day, the child's page, Goals), with these
 * words for it. Only an admin path is followed; anything else goes to Today.
 */
function back(form: FormData, params: Record<string, string>): never {
  const raw = String(form.get('return') ?? '/admin/today');
  let url: URL;
  try {
    url = new URL(raw, 'http://familywise.invalid');
  } catch {
    url = new URL('/admin/today', 'http://familywise.invalid');
  }
  if (url.origin !== 'http://familywise.invalid' || !url.pathname.startsWith('/admin/')) {
    url = new URL('/admin/today', 'http://familywise.invalid');
  }
  for (const k of ['did', 'item', 'error', 'confirm', 'when', 'at', 'by'])
    url.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  redirect(`${url.pathname}?${url.searchParams}${url.hash}`);
}

/**
 * [CHR-24][D-151] A parent marks a missed or late chore done on time: "On time" (by its due time) or
 * an earlier time on its day, credited to who did it. When it would change a week or goal already
 * settled, the page asks first and the parent confirms. Recorded through record_completions() as
 * this parent (an admin_complete marked on time); the database checks the time and who may. The
 * goals it may move are worked out again at once, so a payout or its difference is paid once, now.
 * `target` is the item's id, with ':confirm' once the parent has confirmed: it is bound to the
 * button, since a button that sends its form to an action can't carry a name.
 */
export async function markOnTime(target: string, form: FormData): Promise<void> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/today');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const request = String(form.get('request') ?? '');
  const [id, confirm] = String(target ?? '').split(':');
  if (!id || !GUID.test(id) || !GUID.test(request)) back(form, { error: 'failed' });

  const occ = await loadOnTimeOccurrence(db!, id!);
  if (!occ || occ.householdId !== household.id) back(form, { error: 'gone' });
  const now = householdNow(household.timezone);
  const checkOff = (await loadCheckOffs(db!, [occ!.id])).get(occ!.id) ?? null;
  const item = {
    kind: occ!.kind,
    status: occ!.status as Parameters<typeof onTimeState>[0]['status'],
    dueDate: occ!.dueDate,
    dueTime: occ!.dueTime,
  };
  if (!canMarkOnTime(item, checkOff, now)) back(form, { error: 'ontime-not', item: occ!.id });
  const when = readOnTime(form.get(`when:${occ!.id}`), form.get(`at:${occ!.id}`), item, now);
  if (!when) back(form, { error: 'ontime-time', item: occ!.id });
  const doneBy = [...new Set(form.getAll(`otby:${occ!.id}`).map(String))].filter((d) =>
    GUID.test(d),
  );
  if (doneBy.length === 0) back(form, { error: 'ontime-who', item: occ!.id });

  const members = await loadMembers(db!, household.id);
  const name = (m: string) => members.find((x) => x.id === m)?.displayName ?? null;
  const today = isoDay(household.timezone);
  const { change, goals } = await onTimeChanges(db!, occ!, doneBy, when!.at, today, name);
  if (change && confirm !== 'confirm') {
    back(form, {
      confirm: occ!.id,
      when: when!.at ? 'at' : 'due',
      at: when!.at ?? '',
      by: doneBy.join(','),
    });
  }

  const { data, error } = await db!.rpc('record_completions', {
    p_events: [
      {
        id: eventId(request, occ!.id, 'admin_on_time'),
        occurrence_id: occ!.id,
        event_type: 'admin_complete',
        occurred_at: new Date().toISOString(),
        done_by: doneBy,
        marked_on_time: true,
        on_time_at: when!.at ? onTimeInstant(household.timezone, occ!.dueDate, when!.at) : null,
      },
    ],
  });
  if (error) {
    log('warn', 'mark on time not recorded', { code: error.code, hint: error.hint });
    back(form, { error: 'failed' });
  }
  const failed = (data as CompletionResult[]).find(
    (r) => r.result !== 'recorded' && r.result !== 'duplicate',
  );
  if (failed) {
    log('warn', 'mark on time refused', { result: failed.result, reason: failed.reason });
    back(form, {
      error:
        failed.result === 'gone'
          ? 'gone'
          : failed.reason?.startsWith('on_time')
            ? 'ontime-time'
            : 'failed',
      item: occ!.id,
    });
  }
  // [RWD-18-i] Each goal it may move, worked out now: a week won again pays once.
  for (const g of goals) {
    try {
      await evaluateStoredGoal(db!, g);
    } catch (e) {
      // It stays dirty for the reconcile job.
      log('warn', 'goal not worked out after mark on time', { message: String(e) });
    }
  }
  revalidatePath('/admin/today');
  revalidatePath('/admin/goals');
  revalidatePath('/admin/members');
  back(form, { did: 'ontime', item: occ!.id });
}
