'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';
import { parseTag, tagSaveMessage } from '@/lib/tags';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/tags');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/**
 * [CHR-10] Adds a tag (at the end of the household's list) or renames, recolors or re-icons one.
 * Items, goals and filters keep the tag's id, so a rename changes nothing they count.
 */
export async function saveTag(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseTag(form);
  if (!parsed.ok) return { message: parsed.message };
  const id = String(form.get('id') ?? '');
  const row = { name: parsed.value.name, color: parsed.value.color, icon: parsed.value.icon };
  let error;
  if (id) {
    ({ error } = await db.from('tag').update(row).eq('id', id).eq('household_id', household.id));
  } else {
    const { count } = await db
      .from('tag')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household.id);
    ({ error } = await db
      .from('tag')
      .insert({ ...row, household_id: household.id, sort_order: (count ?? 0) + 1 }));
  }
  if (error) {
    log('warn', 'tag not saved', { code: error.code });
    return { message: tagSaveMessage(error) };
  }
  revalidatePath('/admin/tags');
  revalidatePath('/admin/chores');
  redirect(`/admin/tags?saved=${encodeURIComponent(parsed.value.name)}`);
}

/** [CHR-10] Archive (no longer offered; goals and history keep it) or restore. Never deleted. */
export async function setTagArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const archive = form.get('archive') === 'true';
  const { error } = await db
    .from('tag')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', String(form.get('id') ?? ''))
    .eq('household_id', household.id);
  if (error) log('warn', 'tag archive not saved', { code: error.code });
  revalidatePath('/admin/tags');
  revalidatePath('/admin/chores');
  redirect('/admin/tags');
}
