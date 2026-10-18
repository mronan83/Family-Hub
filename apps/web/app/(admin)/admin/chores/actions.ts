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
  // [MEAL-09] What a tap on the board opens (WP-49): nothing to re-plan, so set apart too.
  if (id || parsed.value.opens) {
    const { error: oError } = await db
      .from('chore')
      .update({ opens: parsed.value.opens ?? null })
      .eq('id', savedId as string)
      .eq('household_id', household.id);
    if (oError) log('warn', 'opens not saved', { code: oError.code });
  }
  revalidatePath('/admin/chores');
  const saved = encodeURIComponent(parsed.value.title);
  if (!id && form.get('then') === 'another') {
    redirect(`/admin/chores/new?kind=${parsed.value.kind}&saved=${saved}`);
  }
  redirect(`/admin/chores?saved=${saved}`);
}

/** Where to go back to on Chores: the page's own address, with its filters; anything else is the page. */
function backTo(form: FormData): string {
  const back = String(form.get('back') ?? '');
  return /^\/admin\/chores(\?[^#]*)?$/.test(back) ? back : '/admin/chores';
}
const withParams = (href: string, params: Record<string, string>) => {
  const u = new URL(href, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
};

/**
 * [CHR-01][CHR-21] Archive (off the list and the board, history kept) or restore; never deleted. Back
 * to the page as it was (its filters kept), with Archived open after an archive (D-132).
 */
export async function setChoreArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const archive = form.get('archive') === 'true';
  const id = String(form.get('id') ?? '');
  const { data, error } = await db
    .from('chore')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('household_id', household.id)
    .select('title')
    .maybeSingle();
  if (error) log('warn', 'chore archive not saved', { code: error.code });
  revalidatePath('/admin/chores');
  const title = (data?.title as string | undefined) ?? '';
  redirect(
    archive
      ? `${withParams(backTo(form), { archived: title, open: 'archived' })}#archived`
      : withParams(backTo(form), { restored: title }),
  );
}

/**
 * [CHR-23][D-132] Do again (Q7): a new one-time item on the date picked (do_chore_again, under the
 * admin's RLS); the original keeps its completion, points and goal credit. "Change more first" opens
 * the form filled in with that date instead, and nothing is added until it is saved.
 */
export async function doChoreAgain(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  const on = String(form.get('on') ?? '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
  if (form.get('then') === 'form') {
    redirect(`/admin/chores/new?from=${encodeURIComponent(id)}${date ? `&on=${date}` : ''}`);
  }
  const back = backTo(form);
  if (!date) redirect(withParams(back, { again: id }));
  const { error } = await db.rpc('do_chore_again', {
    p_household_id: household.id,
    p_chore_id: id,
    p_on_date: date,
  });
  if (error) {
    log('warn', 'chore not done again', { code: error.code, hint: error.hint });
    redirect(withParams(back, { failed: 'again' }));
  }
  const { data } = await db.from('chore').select('title').eq('id', id).maybeSingle();
  revalidatePath('/admin/chores');
  redirect(withParams(back, { added: (data?.title as string | undefined) ?? '', on: date }));
}
