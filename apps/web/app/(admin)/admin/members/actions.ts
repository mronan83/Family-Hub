'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { memberSaveMessage, parseMember } from '@/lib/members';
import { adjustmentMessage, parseAdjustment } from '@/lib/points';
import { serverClient } from '@/lib/supabase/server';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/members');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/**
 * [ACC-04][PTS-07] Adds or edits a member of the signed-in admin's household. The household comes
 * from the session, never the form; RLS and the member checks in the database have the last word.
 */
export async function saveMember(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseMember(form);
  if (!parsed.ok) return { message: parsed.message };
  const m = parsed.value;
  const row = {
    display_name: m.displayName,
    role: m.role,
    avatar_key: m.avatarKey,
    color: m.color,
    birth_year: m.birthYear,
    earns_rewards: m.earnsRewards,
    user_id: m.userId,
  };
  const id = String(form.get('id') ?? '');
  const { error } = id
    ? await db.from('member').update(row).eq('id', id).eq('household_id', household.id)
    : await db.from('member').insert({ ...row, household_id: household.id });
  if (error) {
    log('warn', 'member not saved', { code: error.code, hint: error.hint });
    return { message: memberSaveMessage(error) };
  }
  revalidatePath('/admin/members');
  redirect(`/admin/members?saved=${encodeURIComponent(m.displayName)}`);
}

/** [ACC-04] Archive (history kept, off the board) or restore; members are never deleted here. */
export async function setArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const archive = form.get('archive') === 'true';
  const { error } = await db
    .from('member')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', String(form.get('id') ?? ''))
    .eq('household_id', household.id);
  if (error) log('warn', 'member archive not saved', { code: error.code });
  revalidatePath('/admin/members');
  redirect('/admin/members');
}

/**
 * [PTS-01][US-1106] Adds or takes away a member's points with a reason, as the signed-in admin. The
 * form carries a request id made when the page was drawn, so sending it twice posts once; the
 * database checks who may and for whom (adjust_points).
 */
export async function adjustPoints(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseAdjustment(form);
  if (!parsed.ok) return { message: parsed.message };
  const a = parsed.value;
  const { error } = await db.rpc('adjust_points', {
    p_member_id: a.memberId,
    p_amount: a.amount,
    p_reason: a.reason,
    p_request_id: a.requestId,
  });
  if (error) {
    log('warn', 'points not adjusted', { code: error.code, hint: error.hint });
    const { data: member } = await db
      .from('member')
      .select('display_name')
      .eq('id', a.memberId)
      .eq('household_id', household.id)
      .maybeSingle();
    return { message: adjustmentMessage(error, member?.display_name ?? 'This member') };
  }
  revalidatePath('/admin/members');
  redirect(`/admin/members/${a.memberId}?adjusted=${a.amount}#points`);
}
