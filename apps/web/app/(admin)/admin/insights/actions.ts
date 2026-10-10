'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { dayBefore, rebuildMemberHistory } from '@/lib/history';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';
import { RANGES, type Range } from './view';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [RWD-11] A parent rebuilds a member's history from every check-off (02 §4.7's admin tool). The
 * database checks the member is in the parent's household; the same facts give the same rows.
 */
export async function rebuildHistory(form: FormData): Promise<void> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/insights');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const memberId = String(form.get('memberId') ?? '');
  const days = Number(form.get('days'));
  const range: Range = (RANGES as readonly number[]).includes(days) ? (days as Range) : 30;
  if (!GUID.test(memberId)) redirect('/admin/insights');
  let result = 'rebuilt';
  try {
    await rebuildMemberHistory(db!, memberId, dayBefore(isoDay(household.timezone)));
  } catch (e) {
    log('warn', 'history not rebuilt', { error: String(e) });
    result = 'failed';
  }
  revalidatePath('/admin/insights');
  redirect(`/admin/insights?member=${memberId}&days=${range}&history=${result}`);
}
