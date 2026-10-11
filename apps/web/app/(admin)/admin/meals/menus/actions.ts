'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { MAX_FILE_BYTES, parseMenuCsv } from '@/lib/menu/csv';
import { daysForDb, fetchSchools, fetchSource } from '@/lib/menu/import';
import {
  districtFrom,
  type MenuDay,
  type NutrisliceConfig,
  type School,
} from '@/lib/menu/nutrislice';
import { menuRefusal, parseDayForm, parseSourceForm } from '@/lib/menus';
import { serverClient } from '@/lib/supabase/server';

const PAGE = '/admin/meals/menus';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, PAGE);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  revalidatePath('/admin/meals');
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** What the Add a school menu form holds between its steps: the district's schools once found. */
export interface AddMenuState extends FormState {
  district?: string;
  schools?: School[];
}

/**
 * [MENU-01][MENU-02][US-801] Adds a school menu. For Nutrislice, the first step finds the district's
 * schools and their menus (intent=find) so the parent picks rather than types identifiers; adding
 * then fetches its next four weeks at once, so they see a sample straight away, or what's wrong.
 */
export async function addMenu(prev: AddMenuState, form: FormData): Promise<AddMenuState> {
  const { db, household } = await context();
  if (form.get('intent') === 'find') {
    const district = districtFrom(String(form.get('districtInput') ?? ''));
    if (!district) {
      return {
        message:
          'Type the name in your district’s menu address: for menus at example.nutrislice.com, type example.',
      };
    }
    const found = await fetchSchools(district);
    if (!found.ok) return { message: found.error };
    if (found.schools.length === 0) {
      return { message: `Nutrislice has no schools with menus for “${district}”.` };
    }
    return { district, schools: found.schools };
  }

  const parsed = parseSourceForm(form);
  if (!parsed.ok) return { ...prev, message: parsed.message };
  const v = parsed.value;
  const { data, error } = await db.rpc('save_menu_source', {
    p_household: household.id,
    p_source: null,
    p_name: v.name,
    p_adapter: v.adapter,
    p_config: v.config,
  });
  if (error) {
    log('warn', 'menu not added', { code: error.code, hint: error.hint });
    return { ...prev, message: menuRefusal(error) };
  }
  let did = 'added';
  if (v.adapter === 'nutrislice') {
    const outcome = await fetchSource(db, {
      id: data as string,
      config: v.config as unknown as NutrisliceConfig,
      contentHash: null,
      timeZone: household.timezone,
    }).catch((e: unknown) => {
      // Added all the same: the menu_import job tries again tomorrow.
      log('error', 'first menu fetch not recorded', { error: String(e) });
      return null;
    });
    did = outcome?.status === 'fetched' ? 'added_fetched' : 'added_failed';
  }
  back({ did, name: v.name });
}

/** [MENU-01] Renames a menu. */
export async function renameMenu(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim();
  const { data: src } = await db
    .from('menu_source')
    .select('adapter, config')
    .eq('id', id)
    .single();
  const { error } = await db.rpc('save_menu_source', {
    p_household: household.id,
    p_source: id,
    p_name: name,
    p_adapter: src?.adapter ?? null,
    p_config: src?.config ?? {},
  });
  if (error) {
    log('warn', 'menu not renamed', { code: error.code, hint: error.hint });
    back({ error: error.hint ?? 'failed' });
  }
  back({ did: 'renamed', name });
}

/** [MENU-04] Fetches a feed now, as the morning's job would. */
export async function fetchMenuNow(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  const { data: src, error } = await db
    .from('menu_source')
    .select('name, adapter, config')
    .eq('id', id)
    .single();
  if (error || src?.adapter !== 'nutrislice') back({ error: 'not_found' });
  const outcome = await fetchSource(db, {
    id,
    config: src!.config as NutrisliceConfig,
    contentHash: null,
    timeZone: household.timezone,
  }).catch((e: unknown) => {
    log('error', 'menu fetch not recorded', { error: String(e) });
    return null;
  });
  back({
    did: outcome && outcome.status !== 'error' ? 'fetched' : 'fetch_failed',
    name: src!.name,
  });
}

/** Removes a menu and its days; children who had it have none until another is chosen. */
export async function removeMenu(form: FormData): Promise<void> {
  const { db } = await context();
  const { error } = await db.rpc('remove_menu_source', { p_source: String(form.get('id') ?? '') });
  if (error) {
    log('warn', 'menu not removed', { code: error.code });
    back({ error: 'remove' });
  }
  back({ did: 'removed', name: String(form.get('name') ?? '') });
}

/** What the Load a file form holds: the file's days to look over before loading them. */
export interface CsvState extends FormState {
  /** The days read, as JSON, to send back with Load these days. */
  days?: string;
  preview?: { count: number; first: string; last: string; noLunch: number; sample: MenuDay[] };
  problems?: string[];
}

/**
 * [MENU-03][US-802] Loads a menu file: first a look at what it holds (intent=preview), then the days
 * themselves, each the parent's own (the feed never replaces them).
 */
export async function loadMenuFile(_prev: CsvState, form: FormData): Promise<CsvState> {
  const { db } = await context();
  const id = String(form.get('id') ?? '');
  if (form.get('intent') === 'load') {
    let days: MenuDay[] = [];
    try {
      days = JSON.parse(String(form.get('days') ?? '[]')) as MenuDay[];
    } catch {
      return { message: 'Choose the file again.' };
    }
    const { data, error } = await db.rpc('save_menu_days', {
      p_source: id,
      p_days: daysForDb(days),
      p_origin: 'csv',
    });
    if (error) {
      log('warn', 'menu file not loaded', { code: error.code, hint: error.hint });
      return { message: menuRefusal(error) };
    }
    back({ did: 'loaded', count: String(data as number) });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { message: 'Choose a CSV file.' };
  if (file.size > MAX_FILE_BYTES) return { message: 'That file is larger than a menu (512 KB).' };
  const { days, problems } = parseMenuCsv(await file.text());
  if (problems.length > 0) return { problems: problems.slice(0, 10) };
  return {
    days: JSON.stringify(days),
    preview: {
      count: days.length,
      first: days[0]!.date,
      last: days.at(-1)!.date,
      noLunch: days.filter((d) => d.noService).length,
      sample: days.slice(0, 5),
    },
  };
}

/** [MENU-03][US-802] A day typed in, or changed: the parent's own from now on. */
export async function saveMenuDay(_prev: FormState, form: FormData): Promise<FormState> {
  const { db } = await context();
  const parsed = parseDayForm(form);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.rpc('save_menu_days', {
    p_source: String(form.get('id') ?? ''),
    p_days: daysForDb([parsed.value]),
    p_origin: 'manual',
  });
  if (error) {
    log('warn', 'menu day not saved', { code: error.code, hint: error.hint });
    return { message: menuRefusal(error) };
  }
  back({ did: 'day', date: parsed.value.date });
}

/** Clears a day: a feed's goes back to the feed (filled in at its next fetch). */
export async function clearMenuDay(form: FormData): Promise<void> {
  const { db } = await context();
  const { error } = await db.rpc('clear_menu_day', {
    p_source: String(form.get('id') ?? ''),
    p_date: String(form.get('date') ?? ''),
  });
  if (error) {
    log('warn', 'menu day not cleared', { code: error.code });
    back({ error: 'failed' });
  }
  back({ did: form.get('feed') === 'true' ? 'day_feed' : 'day_cleared' });
}
