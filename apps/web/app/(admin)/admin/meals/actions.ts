'use server';

import { ICON_NAMES } from '@familywise/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { addDays } from '@/lib/board-calendar';
import { isoDay } from '@/lib/format';
import { log } from '@/lib/log';
import { copyRecipeFiles } from '@/lib/meal-copy';
import { parseUsualLunch } from '@/lib/lunch';
import { parsePicksForm } from '@/lib/lunch-picks';
import { mealRefusal, parseEntryForm, parseMealForm, weekDays, weekFrom } from '@/lib/meals';
import { serverClient } from '@/lib/supabase/server';
import { starterList } from '@/lib/grocery-starter';
import { weekGroceryItems, weekReview } from '@/lib/meal-groceries';
import { loadGroceries } from '../groceries/data';
import { loadMeals, loadPlan } from './data';

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
 * written in, to a day and slot of the week shown, for everyone or any set of people, with a note. The form
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
      member_ids: v.memberIds,
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
  redirect(`/admin/meals?week=${week}&did=added&open=${v.planDate}#${v.planDate}-${v.slot}`);
}

/**
 * [MEAL-15][US-701] Saves an edit of one entry (WP-76): its day and meal of the day, the library meal
 * or what was written, its people and its note, in place. The entry keeps its id, and its place in
 * the order while it stays in the same day and meal of the day. Back to the week, at the slot.
 */
export async function updateMealEntry(_prev: FormState, form: FormData): Promise<FormState> {
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
  const { error } = await db.rpc('update_meal_entry', {
    p_entry: {
      id: v.id,
      household_id: household.id,
      plan_date: v.planDate,
      slot: v.slot,
      member_ids: v.memberIds,
      meal_id: v.mealId,
      free_text: v.freeText,
      notes: v.notes,
    },
  });
  if (error) {
    log('warn', 'meal entry not saved', { code: error.code, hint: error.hint });
    return { message: mealRefusal(error) };
  }
  revalidatePath('/admin/meals');
  redirect(`/admin/meals?week=${week}&did=saved&open=${v.planDate}#${v.planDate}-${v.slot}`);
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
  // [MEAL-14] Back to the week with the entry's day still open (WP-75).
  const day = /^\d{4}-\d{2}-\d{2}-/.test(anchor) ? `&open=${anchor.slice(0, 10)}` : '';
  redirect(
    `/admin/meals?week=${week}&did=${error ? 'failed' : act === 'remove' ? 'removed' : 'moved'}${day}${/^[\w-]+$/.test(anchor) ? `#${anchor}` : ''}`,
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
 * description, what it's good for, a recipe link and an icon. [MEAL-25][D-132] A copy (the form
 * carries `copyFrom`, Duplicate on the library, WP-96) also takes the original's photos and PDFs,
 * copied as files of its own once the copy is saved.
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
    ingredients: v.ingredients ?? [],
    ...(v.recipeSteps ? { recipe_steps: v.recipeSteps } : {}),
  };
  const { data: saved, error } = GUID.test(id)
    ? await db.from('meal').update(row).eq('id', id).eq('household_id', household.id).select('id')
    : await db
        .from('meal')
        .insert({ ...row, household_id: household.id })
        .select('id');
  if (error) {
    log('warn', 'meal not saved', { code: error.code, hint: error.hint });
    return { message: mealRefusal(error) };
  }
  const copyFrom = String(form.get('copyFrom') ?? '');
  const newId = (saved as { id: string }[] | null)?.[0]?.id;
  let notCopied = 0;
  if (!GUID.test(id) && GUID.test(copyFrom) && newId) {
    notCopied = await copyFilesOf(db, household.id, copyFrom, newId);
  }
  revalidatePath('/admin/meals', 'layout');
  redirect(
    `/admin/meals/library?saved=${encodeURIComponent(v.name)}${notCopied ? `&notCopied=${notCopied}` : ''}`,
  );
}

/** [MEAL-25] The original meal's photos and PDFs copied to its copy; how many could not be. */
async function copyFilesOf(
  db: Awaited<ReturnType<typeof context>>['db'],
  householdId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data, error } = await db
    .from('meal_recipe_file')
    .select('id, kind, name, path, size_bytes, sort_order')
    .eq('household_id', householdId)
    .eq('meal_id', from)
    .order('sort_order');
  if (error) {
    log('warn', 'recipe files not read for a copy', { code: error.code });
    return 1;
  }
  const files = (
    data as { id: string; kind: 'photo' | 'pdf'; name: string; path: string; size_bytes: number }[]
  ).map((f) => ({ id: f.id, kind: f.kind, name: f.name, path: f.path, sizeBytes: f.size_bytes }));
  const bucket = db.storage.from('recipes');
  const { failed } = await copyRecipeFiles(
    files,
    { householdId, mealId: to },
    {
      copy: async (src, dst) => !(await bucket.copy(src, dst)).error,
      record: async (r) =>
        !(
          await db.from('meal_recipe_file').insert({
            household_id: householdId,
            meal_id: r.mealId,
            kind: r.kind,
            name: r.name,
            path: r.path,
            size_bytes: r.sizeBytes,
            sort_order: r.sortOrder,
          })
        ).error,
      remove: async (path) => {
        await bucket.remove([path]);
      },
    },
  );
  if (failed.length) log('warn', 'recipe files not copied', { count: failed.length });
  return failed.length;
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
  revalidatePath('/admin/today');
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

/**
 * [MEAL-11][US-707] A parent sets a child's picks for a buy day (WP-49), at once; a child's change
 * waiting for that day is replaced. Back to the week, at the lunch table.
 */
export async function setLunchPicks(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const member = String(form.get('member') ?? '');
  const date = String(form.get('day') ?? '');
  if (!GUID.test(member) || !weekDays(week).includes(date)) redirect(`/admin/meals?week=${week}`);
  const { error } = await db.rpc('set_lunch_choices', {
    p_member: member,
    p_date: date,
    p_choices: parsePicksForm(form),
  });
  if (error) {
    log('warn', 'lunch picks not set', { code: error.code, hint: error.hint });
    redirect(`/admin/meals?week=${week}&lunch=${encodeURIComponent(error.hint || 'failed')}#lunch`);
  }
  revalidatePath('/admin/meals');
  revalidatePath('/admin/today');
  redirect(`/admin/meals?week=${week}&did=picks#lunch`);
}

/**
 * [MEAL-19][MEAL-20] Adds the rows ticked in the week's review to the grocery list (WP-105): read
 * again here from the week's plan and the meals' ingredients (the form sends only which rows), each
 * with its meal as the reason, through the one way in, which merges what is already on the list.
 * New items take the suggested category and store (last time's, then the preferred store, D-142).
 * Back to the week, saying how many.
 */
export async function addWeekToGroceries(form: FormData): Promise<void> {
  const { db, household } = await context('/admin/meals');
  const week = weekOf(form, household);
  const days = weekDays(week);
  let ids: Set<string>;
  try {
    ids = new Set((JSON.parse(String(form.get('rows') ?? '[]')) as unknown[]).map(String));
  } catch {
    redirect(`/admin/meals?week=${week}&did=failed`);
  }
  const [entries, meals, groceries] = await Promise.all([
    loadPlan(db, household.id, days[0]!, days[6]!),
    loadMeals(db, household.id),
    loadGroceries(db, household.id),
  ]);
  const review = weekReview(entries, meals, new Map(), household.timezone);
  const items = weekGroceryItems(review, ids, {
    categories: groceries.categories,
    past: groceries.past,
    learned: groceries.learned,
    starter: starterList,
    preferredStoreId: groceries.preferredStoreId,
    brands: groceries.brands,
  });
  if (items.length === 0) redirect(`/admin/meals?week=${week}&did=nothing`);
  const { error } = await db.rpc('add_groceries', { p_household: household.id, p_items: items });
  if (error) {
    log('warn', 'week not added to groceries', { code: error.code, hint: error.hint });
    redirect(`/admin/meals?week=${week}&did=failed`);
  }
  revalidatePath('/admin/groceries');
  redirect(`/admin/meals?week=${week}&did=groceries&n=${items.length}`);
}

const RECIPE_KINDS = { photo: /^image\/(jpeg|png|webp|heic)$/, pdf: /^application\/pdf$/ } as const;

/**
 * [MEAL-25] Records a photo or PDF the admin's browser has just put in the household's storage
 * (WP-105): under the household's folder and the meal's, up to 10 MB. Returns the file's id, or why
 * not (the stored file is taken away again then).
 */
export async function addRecipeFile(file: {
  mealId: string;
  path: string;
  name: string;
  type: string;
  size: number;
}): Promise<{ id: string } | { error: string }> {
  const { db, household } = await context('/admin/meals/library');
  const kind = RECIPE_KINDS.pdf.test(file.type)
    ? 'pdf'
    : RECIPE_KINDS.photo.test(file.type)
      ? 'photo'
      : null;
  const inFolder =
    GUID.test(file.mealId) && file.path.startsWith(`${household.id}/${file.mealId}/`);
  if (!kind || !inFolder || file.size < 1 || file.size > 10 * 1024 * 1024) {
    if (inFolder) await db.storage.from('recipes').remove([file.path]);
    return { error: 'A photo or a PDF, up to 10 MB.' };
  }
  const { data, error } = await db
    .from('meal_recipe_file')
    .insert({
      household_id: household.id,
      meal_id: file.mealId,
      kind,
      name: file.name.trim().slice(0, 120) || (kind === 'pdf' ? 'Recipe.pdf' : 'Photo'),
      path: file.path,
      size_bytes: file.size,
    })
    .select('id')
    .single();
  if (error || !data) {
    log('warn', 'recipe file not added', { code: error?.code, hint: error?.hint });
    await db.storage.from('recipes').remove([file.path]);
    return { error: 'That didn’t save. Try again in a moment.' };
  }
  revalidatePath('/admin/meals', 'layout');
  return { id: data.id as string };
}

/** [MEAL-25] Takes a photo or PDF off a meal's recipe, and out of the household's storage. */
export async function removeRecipeFile(id: string): Promise<{ ok: boolean }> {
  const { db, household } = await context('/admin/meals/library');
  if (!GUID.test(id)) return { ok: false };
  const { data } = await db
    .from('meal_recipe_file')
    .delete()
    .eq('id', id)
    .eq('household_id', household.id)
    .select('path')
    .maybeSingle();
  if (data?.path) await db.storage.from('recipes').remove([data.path as string]);
  revalidatePath('/admin/meals', 'layout');
  return { ok: !!data };
}
