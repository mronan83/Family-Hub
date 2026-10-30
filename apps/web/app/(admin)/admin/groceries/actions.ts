'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { BRAND_MAX, brandName } from '@/lib/grocery-brands';
import { addedLine, itemAmount, type GroceryReason } from '@/lib/groceries';
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
        : e.hint === 'brand_taken'
          ? 'There’s a brand by that name already. Merge into it instead.'
          : 'That didn’t change. Try again in a moment.';

/** [MEAL-29] The brand typed with an item: a name to find among the household's or save; none. */
const brandOfForm = (form: FormData): string | null => {
  const b = brandName(String(form.get('brand') ?? ''));
  return b ? b.slice(0, BRAND_MAX) : null;
};

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
        brand: brandOfForm(form),
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

/** [MEAL-29] An item's Brand…: a brand of the household's, a new one saved to them, or none. */
export async function setGroceryBrand(_prev: FormState, form: FormData): Promise<FormState> {
  const { db } = await context();
  const id = guid(form.get('id'));
  if (!id) return { message: 'That didn’t change. Try again in a moment.' };
  const { error } = await db.rpc('set_groceries_brand', {
    p_ids: [id],
    p_brand: brandOfForm(form),
  });
  if (error) {
    log('warn', 'grocery brand not set', { code: error.code, hint: error.hint });
    return { message: refusal(error) };
  }
  back(form, 'branded');
}

/** [MEAL-29] Select's Brand…: the brand of the items selected, saved if new; empty is none. */
export async function setGroceriesBrand(form: FormData): Promise<void> {
  const { db } = await context();
  const chosen = ids(form);
  if (chosen.length === 0) back(form, 'failed');
  const { error } = await db.rpc('set_groceries_brand', {
    p_ids: chosen,
    p_brand: brandOfForm(form),
  });
  if (error) log('warn', 'grocery brands not set', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : `branded-${chosen.length}`);
}

// ---------------------------------------------------------------------------------------------
// [MEAL-23][MEAL-29] Categories, stores and brands
// ---------------------------------------------------------------------------------------------

const kindOf = (form: FormData) =>
  form.get('kind') === 'store' ? 'store' : form.get('kind') === 'brand' ? 'brand' : 'category';
const anchor = (form: FormData) => (kindOf(form) === 'brand' ? '#brands' : '#places');

export async function addPlace(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const name = brandName(String(form.get('name') ?? ''));
  if (!name) return { message: 'Give it a name.' };
  if (name.length > 40) return { message: 'Keep it under 40 letters.' };
  const { error } =
    kindOf(form) === 'brand'
      ? await db.rpc('add_grocery_brand', { p_household: household.id, p_name: name })
      : await db.rpc('add_grocery_place', {
          p_household: household.id,
          p_kind: kindOf(form),
          p_name: name,
        });
  if (error) return { message: refusal(error) };
  back(form, `${kindOf(form)}-added`, anchor(form));
}

export async function renamePlace(_prev: FormState, form: FormData): Promise<FormState> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const name = brandName(String(form.get('name') ?? ''));
  if (!id || !name) return { message: 'Give it a name.' };
  if (name.length > 40) return { message: 'Keep it under 40 letters.' };
  const { error } =
    kindOf(form) === 'brand'
      ? await db.rpc('rename_grocery_brand', { p_id: id, p_name: name })
      : await db.rpc('rename_grocery_place', {
          p_kind: kindOf(form),
          p_id: id,
          p_name: name,
        });
  if (error) return { message: refusal(error) };
  back(form, `${kindOf(form)}-renamed`, anchor(form));
}

/** [MEAL-29] Archives a brand, or restores one; says its name back. */
export async function archiveBrand(form: FormData): Promise<void> {
  const { db } = await context();
  const id = guid(form.get('id'));
  const archived = form.get('archived') === 'true';
  if (!id) back(form, 'failed', '#brands');
  const { data, error } = await db.rpc('archive_grocery_brand', { p_id: id, p_archived: archived });
  if (error) log('warn', 'grocery brand not archived', { code: error.code, hint: error.hint });
  back(
    form,
    error ? 'failed' : archived ? 'brand-archived' : 'brand-restored',
    `&name=${encodeURIComponent(String(data ?? ''))}#brands`,
  );
}

/**
 * [MEAL-29] Merges one brand into another (D-148): every item with it, on the list or had before,
 * gets the brand kept, and the merged one is removed. Says the kept brand's name back.
 */
export async function mergeBrands(form: FormData): Promise<void> {
  const { db } = await context();
  const from = guid(form.get('from'));
  const into = guid(form.get('into'));
  if (!from || !into) back(form, 'failed', '#brands');
  const { data, error } = await db.rpc('merge_grocery_brands', { p_from: from, p_into: into });
  if (error) log('warn', 'grocery brands not merged', { code: error.code, hint: error.hint });
  back(
    form,
    error ? 'failed' : 'brand-merged',
    `&name=${encodeURIComponent(String(data ?? ''))}#brands`,
  );
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

/** [MEAL-28] New items go to: the household's preferred store, or none for Any store (D-142). */
export async function setPreferredStore(form: FormData): Promise<void> {
  const { db, household } = await context();
  const { error } = await db.rpc('set_grocery_preferred_store', {
    p_household: household.id,
    p_store: guid(form.get('storeId')),
  });
  if (error) log('warn', 'preferred store not set', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : 'preferred-set', '#places');
}

/** What Home's Groceries card shows after Add: the item as the list now has it. */
export interface QuickAddState extends FormState {
  added?: { id: string; what: string; category: string; at: number };
}

/**
 * [MEAL-27] Home's Groceries card (WP-112): adds what was typed through the one way in, in the
 * suggested category and store, and stays on Home, saying what was added and where. Something
 * already on the list merges by itself.
 */
export async function quickAddGrocery(
  _prev: QuickAddState,
  form: FormData,
): Promise<QuickAddState> {
  const { db, household } = await context();
  const typed = String(form.get('item') ?? '').trim();
  const { name, amount } = parseItem(typed);
  const key = itemKey(typed);
  if (!name || !key) return { message: 'Type what to get, like 2 lb ground beef.' };
  if (name.length > 80) return { message: 'That’s a long name. Keep it under 80 letters.' };
  const { data, error } = await db.rpc('add_groceries', {
    p_household: household.id,
    p_items: [
      {
        name,
        key,
        amount,
        category_id: guid(form.get('categoryId')),
        store_id: guid(form.get('storeId')),
        brand: brandOfForm(form),
        reason: { kind: 'added' },
      },
    ],
  });
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (error || !id) {
    log('warn', 'grocery not added from Home', { code: error?.code, hint: error?.hint });
    return { message: error ? refusal(error) : 'That didn’t change. Try again in a moment.' };
  }
  revalidatePath('/admin');
  revalidatePath(PATH);
  const { data: row } = await db
    .from('grocery_item')
    .select(
      'name, amount, grocery_category(name), grocery_brand(name), grocery_item_reason(amount)',
    )
    .eq('id', id)
    .maybeSingle();
  const r = row as unknown as {
    name: string;
    amount: string | null;
    grocery_category: { name: string } | null;
    grocery_brand: { name: string } | null;
    grocery_item_reason: Pick<GroceryReason, 'amount'>[];
  } | null;
  const line = r
    ? addedLine(
        r.name,
        itemAmount({
          amount: r.amount,
          reasons: r.grocery_item_reason as GroceryReason[],
        }),
        r.grocery_category?.name ?? 'Other',
        r.grocery_brand?.name ?? null,
      )
    : addedLine(name, amount, 'the list');
  return { added: { id, what: line.what, category: line.category, at: Date.now() } };
}

/**
 * [MEAL-22][US-717] A parent adds the children's waiting asks to the list (Add it, Add all), through
 * the merge, or turns them down (Not this time) (WP-107, D-149 (8)).
 */
export async function decideGroceryAsks(form: FormData): Promise<void> {
  const { db } = await context();
  const chosen = ids(form);
  const approve = form.get('approve') === 'true';
  if (chosen.length === 0) back(form, 'failed');
  const { data, error } = await db.rpc('decide_grocery_asks', {
    p_ids: chosen,
    p_approve: approve,
  });
  if (error) log('warn', 'grocery asks not decided', { code: error.code, hint: error.hint });
  back(
    form,
    error ? 'failed' : `${approve ? 'asks-added' : 'asks-declined'}-${data ?? 0}`,
    '#asked',
  );
}

/** [MEAL-22] A child's OK (D-149 (4)): on, their asks wait for a parent; off, they go on the list. */
export async function setGroceryAskOk(form: FormData): Promise<void> {
  const { db } = await context();
  const member = guid(form.get('member'));
  const ok = form.get('ok') === 'true';
  if (!member) back(form, 'failed');
  const { error } = await db.rpc('set_grocery_ask_ok', { p_member: member, p_ok: ok });
  if (error) log('warn', 'grocery OK not set', { code: error.code, hint: error.hint });
  back(form, error ? 'failed' : ok ? 'ask-ok-on' : 'ask-ok-off', '#asked');
}
