'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { EVENT_OF, eventId, parseAct } from '@/lib/admin-day';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { DAY_TYPES } from '@/lib/chores';
import type { CompletionResult } from '@/lib/completions';
import { isoDay } from '@/lib/format';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

async function context(path: string) {
  const db = await serverClient();
  const user = await requireSignedIn(db, path);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, user, household };
}

/** Back to the page the form came from (Today on its date, or My tasks), with these words for it. */
function back(form: FormData, params: Record<string, string | number>): never {
  const mine = form.get('back') === '/admin/my';
  const date = String(form.get('date') ?? '');
  const q = new URLSearchParams();
  if (!mine && ISO_DAY.test(date)) q.set('date', date);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  redirect(`${mine ? '/admin/my' : '/admin/today'}?${q}`);
}

/**
 * [CHR-05][CHR-06][CHR-08][D-46] A parent marks an item done, unchecks, skips or puts back a skipped
 * one, approves or sends back a check-off, or unchecks the ticked items together ("Not actually
 * done", one batch id). Recorded through record_completions() as this parent: the database decides
 * who recorded it, the status and the points. Each event's id comes from the form's request id, so
 * a form sent twice records once, and a batch sent twice is one batch.
 */
export async function dayAction(form: FormData): Promise<void> {
  const { db } = await context('/admin/today');
  const request = String(form.get('request') ?? '');
  const act = parseAct(form.get('act'));
  if (!act || !GUID.test(request)) back(form, { error: 'failed' });
  const at = new Date().toISOString();

  let events: Record<string, unknown>[];
  if (act.action === 'batch') {
    const ids = [...new Set(form.getAll('selected').map(String))].filter((id) => GUID.test(id));
    if (ids.length === 0) back(form, { error: 'select' });
    events = ids.map((id) => ({
      id: eventId(request, id, 'admin_uncomplete'),
      occurrence_id: id,
      event_type: 'admin_uncomplete',
      occurred_at: at,
      batch_id: request,
    }));
  } else {
    const doneBy =
      act.action === 'done'
        ? [...new Set(form.getAll(`by:${act.id}`).map(String))].filter((id) => GUID.test(id))
        : [];
    if (act.action === 'done' && doneBy.length === 0) back(form, { error: 'who', item: act.id });
    const type = EVENT_OF[act.action];
    events = [
      {
        id: eventId(request, act.id, type),
        occurrence_id: act.id,
        event_type: type,
        occurred_at: at,
        done_by: doneBy,
      },
    ];
  }

  const { data, error } = await db.rpc('record_completions', { p_events: events });
  if (error) {
    log('warn', 'admin events not recorded', { code: error.code, hint: error.hint });
    back(form, { error: 'failed' });
  }
  const failed = (data as CompletionResult[]).find(
    (r) => r.result !== 'recorded' && r.result !== 'duplicate',
  );
  if (failed) {
    log('warn', 'admin event refused', { result: failed.result, reason: failed.reason });
    back(form, { error: failed.result === 'gone' ? 'gone' : 'failed' });
  }
  revalidatePath('/admin/today');
  revalidatePath('/admin/my');
  if (act.action === 'batch') back(form, { did: 'batch', n: events.length, batch: request });
  back(form, { did: act.action, item: act.id });
}

/** [CHR-08] Puts back a "Not actually done" batch, where nothing has changed since. */
export async function undoBatch(form: FormData): Promise<void> {
  const { db } = await context('/admin/today');
  const batch = String(form.get('batch') ?? '');
  if (!GUID.test(batch)) back(form, { error: 'failed' });
  const { data, error } = await db.rpc('undo_uncheck_batch', { p_batch_id: batch });
  if (error) {
    log('warn', 'batch not put back', { code: error.code });
    back(form, { error: 'failed' });
  }
  const { restored, unchanged } = data as { restored: number; unchanged: number };
  revalidatePath('/admin/today');
  back(form, { did: 'restored', n: restored, kept: unchanged });
}

/**
 * [CHR-14][US-316] Quick add: a family-visible task due today for me, in one step (save_chore under
 * the admin's RLS). It is on the board and in My tasks at once.
 */
export async function quickAdd(form: FormData): Promise<void> {
  const { db, user, household } = await context('/admin/my');
  const title = String(form.get('title') ?? '').trim();
  if (title.length < 1 || title.length > 80) redirect('/admin/my?error=title');
  const { data: me } = await db
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .eq('user_id', user.userId)
    .is('archived_at', null)
    .maybeSingle();
  if (!me) redirect('/admin/my');
  const today = isoDay(household.timezone);
  const { error } = await db.rpc('save_chore', {
    p_household_id: household.id,
    p_id: null,
    p_item: {
      kind: 'task',
      title,
      icon: 'list-check',
      points: 0,
      approval: 'inherit',
      assignment: 'shared',
      schedule: { freq: 'once', on_date: today },
      due_time: null,
      day_types: DAY_TYPES,
      visibility: 'family',
    },
    p_assignees: [me.id],
    p_tags: [],
  });
  if (error) {
    log('warn', 'quick add not saved', { code: error.code, hint: error.hint });
    redirect('/admin/my?error=failed');
  }
  revalidatePath('/admin/my');
  redirect(`/admin/my?added=${encodeURIComponent(title)}`);
}
