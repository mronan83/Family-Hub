'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { chorePayload, choreSaveMessage, parseChore } from '@/lib/chores';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/chores');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, user, household };
}

/**
 * [CHR-01][CHR-09][CHR-10][CHR-13] Adds or edits a chore or task: the item, its assignees and its
 * tags in one transaction (save_chore, under the admin's RLS). The household comes from the session.
 * Only an item's creator is offered the private switch; the database enforces the same rule.
 */
export async function saveChore(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseChore(form, { canSetVisibility: form.get('visibilityOffered') === 'true' });
  if (!parsed.ok) return { message: parsed.message };
  const id = String(form.get('id') ?? '') || null;
  const { data: savedId, error } = await db.rpc('save_chore', {
    p_household_id: household.id,
    p_id: id,
    p_item: chorePayload(parsed.value),
    p_assignees: parsed.value.assignees,
    p_tags: parsed.value.tags,
  });
  if (error) {
    log('warn', 'chore not saved', { code: error.code, hint: error.hint });
    return { message: choreSaveMessage(error) };
  }
  // [CHR-16] Its reminder lead time (WP-40): nothing to re-plan, so set apart from the item.
  if (id || parsed.value.remindLeadMinutes != null) {
    const { error: lError } = await db
      .from('chore')
      .update({ remind_lead_minutes: parsed.value.remindLeadMinutes ?? null })
      .eq('id', savedId as string)
      .eq('household_id', household.id);
    if (lError) log('warn', 'reminder lead time not saved', { code: lError.code });
  }
  revalidatePath('/admin/chores');
  const saved = encodeURIComponent(parsed.value.title);
  if (!id && form.get('then') === 'another') {
    redirect(`/admin/chores/new?kind=${parsed.value.kind}&saved=${saved}`);
  }
  redirect(`/admin/chores?saved=${saved}`);
}

/** [CHR-01] Archive (off the list and the board, history kept) or restore; never deleted. */
export async function setChoreArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const archive = form.get('archive') === 'true';
  const { error } = await db
    .from('chore')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', String(form.get('id') ?? ''))
    .eq('household_id', household.id);
  if (error) log('warn', 'chore archive not saved', { code: error.code });
  revalidatePath('/admin/chores');
  redirect(archive ? '/admin/chores' : '/admin/chores?status=archived');
}
