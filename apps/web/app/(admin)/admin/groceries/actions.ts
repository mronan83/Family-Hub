'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { itemKey, parseItem } from '@/lib/grocery-merge';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

// [MEAL-18][MEAL-20][MEAL-23] Groceries (WP-104): every change goes through the database's functions
// as the parent, through RLS; the household comes from the session, never the form.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = '/admin/groceries';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, PATH);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

const guid = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '');
  return GUID.test(s) ? s : null;
};
const ids = (form: FormData) =>
  form
    .getAll('ids')
    .map(guid)
    .filter((x): x is string => x !== null);

/** Where to go back to: the list, keeping the store chip chosen, at a fold or row. */
function back(form: FormData, did: string, extra = ''): never {
  const store = String(form.get('store') ?? '');
  const q = new URLSearchParams({ did });
  if (store && store !== 'all') q.set('store', store);
  revalidatePath(PATH);
  redirect(`${PATH}?${q.toString()}${extra}`);
}

const refusal = (e: { code?: string; hint?: string | null }): string =>
  e.hint === 'already_on_list'
    ? 'That’s already on the list.'
    : e.hint === 'name_taken'
      ? 'That name is taken. Try another.'
      : e.hint === 'other_fixed'
        ? 'Other stays, so nothing is ever without a category.'
        : 'That didn’t change. Try again in a moment.';

/**
 * [MEAL-18][MEAL-20][MEAL-24] Adds what was typed ("2 lb ground beef"), in the category and store
 * chosen (suggested before Add), or joined to an open item the admin chose with Make it one. The
 * same thing already open merges by itself.
 */
export async function addGrocery(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const typed = String(form.get('item') ?? '').trim();
  const { name, amount } = parseItem(typed);
  const key = itemKey(typed);
  if (!name || !key) return { message: 'Type what to get, like 2 lb ground beef.' };
  if (name.length > 80) return { message: 'That’s a long name. Keep it under 80 letters.' };
  const store = String(form.get('storeId') ?? '');
  const { data, error } = await db.rpc('add_groceries', {
    p_household: household.id,
    p_items: [
      {
        name,
        key,
        amount,
        category_id: guid(form.get('categoryId')),
        store_id: GUID.test(store) ? store : null,
        into_id: guid(form.get('intoId')),
        reason: { kind: 'added' },
      },
    ],
  });
  if (error) {
    log('warn', 'grocery not added', { code: error.code, hint: error.hint });
    return { message: refusal(error) };
  }
  const merged = (data as { merged: boolean }[] | null)?.[0]?.merged;
  back(form, merged ? 'merged' : 'added', `&name=${encodeURIComponent(name)}&t=${Date.now()}#add`);
}

/** [MEAL-18] Ticks one item (a buy) or unticks it back onto the list. */
export async function tickGrocery(form: FormData): Promise<void> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const ticked = form.get('ticked') === 'true';
  if (!id) back(form, 'failed');
  const { error } = await db.rpc('set_groceries_ticked', { p_ids: [id], p_ticked: ticked });
  if (error) log('warn', 'grocery not ticked', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : ticked ? 'ticked' : 'unticked', ticked ? '' : '#got');
}

/** [MEAL-18][MEAL-23] Takes one item, or the ones selected, off the list (not a buy). */
export async function removeGroceries(form: FormData): Promise<void> {
  const { db } = await context();
  const chosen = ids(form);
  if (chosen.length === 0) back(form, 'failed');
  const { error } = await db.rpc('remove_groceries', { p_ids: chosen });
  if (error) log('warn', 'groceries not removed', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : `removed-${chosen.length}`);
}

/** [MEAL-18] Edit: an open item's name and amount. */
export async function editGrocery(_prev: FormState, form: FormData): Promise<FormState> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const name = parseItem(String(form.get('name') ?? '')).name;
  const amount = String(form.get('amount') ?? '').trim();
  if (!id || !name) return { message: 'Give it a name.' };
  if (name.length > 80 || amount.length > 40) return { message: 'That’s too long.' };
  const { error } = await db.rpc('update_grocery_item', {
    p_id: id,
    p_name: name,
    p_key: itemKey(name),
    p_amount: amount || null,
  });
  if (error) return { message: refusal(error) };
  back(form, 'edited');
}

/**
 * [MEAL-23][MEAL-24] Moves one item, or the ones selected, to a category at once, or to a new one
 * named here. Each move teaches the household's words.
 */
export async function moveGroceries(form: FormData): Promise<void> {
  const { db, household } = await context();
  const chosen = ids(form);
  let category = guid(form.get('categoryId'));
  const fresh = String(form.get('newCategory') ?? '').trim();
  if (chosen.length === 0) back(form, 'failed');
  if (fresh) {
    const { data, error } = await db.rpc('add_grocery_place', {
      p_household: household.id,
      p_kind: 'category',
      p_name: fresh,
    });
    if (error) back(form, error.hint === 'name_taken' ? 'name-taken' : 'failed');
    category = data as string;
  }
  if (!category) back(form, 'failed');
  const { error } = await db.rpc('move_groceries', { p_ids: chosen, p_category: category });
  if (error) log('warn', 'groceries not moved', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : `moved-${chosen.length}`);
}

/** [MEAL-23] Sets the store of one item, or the ones selected; none is any store. */
export async function setGroceriesStore(form: FormData): Promise<void> {
  const { db } = await context();
  const chosen = ids(form);
  if (chosen.length === 0) back(form, 'failed');
  const { error } = await db.rpc('set_groceries_store', {
    p_ids: chosen,
    p_store: guid(form.get('storeId')),
  });
  if (error) log('warn', 'grocery store not set', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : `stored-${chosen.length}`);
}

// ---------------------------------------------------------------------------------------------
// [MEAL-23] Categories and stores
// ---------------------------------------------------------------------------------------------

const kindOf = (form: FormData) => (form.get('kind') === 'store' ? 'store' : 'category');

export async function addPlace(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { message: 'Give it a name.' };
  if (name.length > 40) return { message: 'Keep it under 40 letters.' };
  const { error } = await db.rpc('add_grocery_place', {
    p_household: household.id,
    p_kind: kindOf(form),
    p_name: name,
  });
  if (error) return { message: refusal(error) };
  back(form, `${kindOf(form)}-added`, '#places');
}

export async function renamePlace(_prev: FormState, form: FormData): Promise<FormState> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const name = String(form.get('name') ?? '').trim();
  if (!id || !name) return { message: 'Give it a name.' };
  if (name.length > 40) return { message: 'Keep it under 40 letters.' };
  const { error } = await db.rpc('rename_grocery_place', {
    p_kind: kindOf(form),
    p_id: id,
    p_name: name,
  });
  if (error) return { message: refusal(error) };
  back(form, `${kindOf(form)}-renamed`, '#places');
}

export async function movePlace(form: FormData): Promise<void> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const step = form.get('step') === '-1' ? -1 : 1;
  if (!id) back(form, 'failed', '#places');
  const { error } = await db.rpc('move_grocery_place', {
    p_kind: kindOf(form),
    p_id: id,
    p_step: step,
  });
  back(form, error ? 'failed' : `${kindOf(form)}-moved`, '#places');
}

/** Removes a category (its items go to Other; the form asked first) or a store. */
export async function removePlace(form: FormData): Promise<void> {
  const { db } = await context();
  const id = guid(form.get('id'));
  if (!id) back(form, 'failed', '#places');
  const { error } = await db.rpc('remove_grocery_place', { p_kind: kindOf(form), p_id: id });
  if (error) log('warn', 'grocery place not removed', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : `${kindOf(form)}-removed`, '#places');
}
