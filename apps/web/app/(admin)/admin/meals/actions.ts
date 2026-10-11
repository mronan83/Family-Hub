'use server';

import { ICON_NAMES } from '@familywise/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { addDays } from '@/lib/board-calendar';
import { isoDay } from '@/lib/format';
import { log } from '@/lib/log';
import { parseUsualLunch } from '@/lib/lunch';
import { mealRefusal, parseEntryForm, parseMealForm, weekDays, weekFrom } from '@/lib/meals';
import { serverClient } from '@/lib/supabase/server';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context(path: string) {
  const db = await serverClient();
  const user = await requireSignedIn(db, path);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/** The week a form was sent from, as the start of that household week. */
function weekOf(form: FormData, household: { timezone: string; weekStart: number }): string {
  return weekFrom(String(form.get('week') ?? ''), isoDay(household.timezone), household.weekStart);
}

/**
 * [MEAL-01][MEAL-02][MEAL-08] Adds one thing to the plan: a meal from the library or something
 * written in, to a day and slot of the week shown, for everyone or one person, with a note. The form
 * carries the entry's id, so sending it twice adds it once. Back to the week, at the slot.
 */
export async function addMealEntry(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const { data: members } = await db
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .is('archived_at', null);
  const parsed = parseEntryForm(form, {
    days: weekDays(week),
    memberIds: (members ?? []).map((m) => m.id as string),
  });
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const { error } = await db.rpc('add_meal_entry', {
    p_entry: {
      id: v.id,
      household_id: household.id,
      plan_date: v.planDate,
      slot: v.slot,
      member_id: v.memberId,
      meal_id: v.mealId,
      free_text: v.freeText,
      notes: v.notes,
    },
  });
  if (error) {
    log('warn', 'meal entry not added', { code: error.code, hint: error.hint });
    return { message: mealRefusal(error) };
  }
  revalidatePath('/admin/meals');
  redirect(`/admin/meals?week=${week}&did=added#${v.planDate}-${v.slot}`);
}

/** [MEAL-08] Moves an entry one place earlier or later in its slot, or removes it. */
export async function changeMealEntry(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const [act, id] = String(form.get('act') ?? '').split(':');
  if (!id || !GUID.test(id) || !['earlier', 'later', 'remove'].includes(act ?? '')) {
    redirect(`/admin/meals?week=${week}`);
  }
  const { error } =
    act === 'remove'
      ? await db.from('meal_plan_entry').delete().eq('id', id).eq('household_id', household.id)
      : await db.rpc('move_meal_entry', { p_id: id, p_step: act === 'earlier' ? -1 : 1 });
  if (error) log('warn', 'meal entry not changed', { code: error.code, hint: error.hint });
  revalidatePath('/admin/meals');
  const anchor = String(form.get('at') ?? '');
  redirect(
    `/admin/meals?week=${week}&did=${error ? 'failed' : act === 'remove' ? 'removed' : 'moved'}${/^[\w-]+$/.test(anchor) ? `#${anchor}` : ''}`,
  );
}

/**
 * [MEAL-03][US-702] Copies last week's plan into the week shown: a meal already planned is kept
 * (skip) or replaced (overwrite), as the parent chooses; slots last week leaves empty stay as they are.
 */
export async function copyLastWeek(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const mode = form.get('mode') === 'overwrite' ? 'overwrite' : 'skip';
  const { data, error } = await db.rpc('copy_meal_week', {
    p_household: household.id,
    p_from: addDays(week, -7),
    p_to: week,
    p_mode: mode,
  });
  if (error) {
    log('warn', 'meal week not copied', { code: error.code, hint: error.hint });
    redirect(`/admin/meals?week=${week}&did=failed`);
  }
  const r = data as { copied: number; skipped: number; replaced: number };
  revalidatePath('/admin/meals');
  redirect(
    `/admin/meals?week=${week}&copied=${r.copied}&skipped=${r.skipped}&replaced=${r.replaced}`,
  );
}

/**
 * [MEAL-02] Adds a meal to the library, or changes one (the form carries its id): a name, a
 * description, what it's good for, a recipe link and an icon.
 */
export async function saveMeal(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context('/admin/meals/library');
  const parsed = parseMealForm(form, ICON_NAMES);
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const id = String(form.get('id') ?? '');
  const row = {
    name: v.name,
    description: v.description,
    icon: v.icon,
    meal_types: v.mealTypes,
    recipe_url: v.recipeUrl,
  };
  const { error } = GUID.test(id)
    ? await db.from('meal').update(row).eq('id', id).eq('household_id', household.id)
    : await db.from('meal').insert({ ...row, household_id: household.id });
  if (error) {
    log('warn', 'meal not saved', { code: error.code, hint: error.hint });
    return { message: mealRefusal(error) };
  }
  revalidatePath('/admin/meals', 'layout');
  redirect(`/admin/meals/library?saved=${encodeURIComponent(v.name)}`);
}

/** [MEAL-02] Takes a meal out of the library (plans that use it keep its name), or puts it back. */
export async function setMealArchived(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals/library');
  const id = String(form.get('id') ?? '');
  const archive = form.get('archive') === 'true';
  if (GUID.test(id)) {
    const { error } = await db
      .from('meal')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('household_id', household.id);
    if (error) {
      log('warn', 'meal not archived', { code: error.code, hint: error.hint });
      redirect('/admin/meals/library?did=failed');
    }
  }
  revalidatePath('/admin/meals', 'layout');
  redirect(`/admin/meals/library?did=${archive ? 'archived' : 'restored'}`);
}

/**
 * [MEAL-04][US-703] Changes one school day's lunch for a child, buy or bring. Changing it back to
 * their usual removes the change. Back to the week, at the lunch table.
 */
export async function setLunchDay(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const [member, date, mode] = String(form.get('lunch') ?? '').split(':');
  if (
    !member ||
    !GUID.test(member) ||
    !date ||
    !weekDays(week).includes(date) ||
    !['buy', 'bring'].includes(mode ?? '')
  ) {
    redirect(`/admin/meals?week=${week}`);
  }
  const { error } = await db.rpc('set_lunch', { p_member: member, p_date: date, p_mode: mode });
  if (error) {
    log('warn', 'lunch not set', { code: error.code, hint: error.hint });
    redirect(`/admin/meals?week=${week}&lunch=${encodeURIComponent(error.hint || 'failed')}#lunch`);
  }
  revalidatePath('/admin/meals');
  redirect(`/admin/meals?week=${week}&did=lunch#lunch`);
}

/** [MEAL-04][US-703] Sets a child's usual lunch for each weekday, buy or bring. */
export async function setUsualLunch(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const member = String(form.get('member') ?? '');
  if (!GUID.test(member)) redirect(`/admin/meals?week=${week}`);
  const { error } = await db.rpc('set_lunch_defaults', {
    p_member: member,
    p_defaults: parseUsualLunch(form),
  });
  // [MENU-01] The school menu their lunch comes from, when the form offers one ('' is none).
  const menu = form.has('menu') ? String(form.get('menu') ?? '') : null;
  const menuError =
    error || menu === null || (menu !== '' && !GUID.test(menu))
      ? null
      : (await db.rpc('set_child_menu', { p_member: member, p_source: menu || null })).error;
  if (error || menuError) {
    const e = (error ?? menuError)!;
    log('warn', 'usual lunch not set', { code: e.code, hint: e.hint });
    redirect(`/admin/meals?week=${week}&lunch=${encodeURIComponent(e.hint || 'failed')}#lunch`);
  }
  revalidatePath('/admin/meals');
  redirect(`/admin/meals?week=${week}&did=usual#lunch`);
}
