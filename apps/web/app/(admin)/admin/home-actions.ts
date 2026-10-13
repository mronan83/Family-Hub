'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { fetchSource } from '@/lib/menu/import';
import type { NutrisliceConfig } from '@/lib/menu/nutrislice';
import { serverClient } from '@/lib/supabase/server';

// [NFR-17][US-109] Home's quick actions that act there and then (WP-57, D-84): no school today, and
// fetching the school menus now. The rest of Home's quick actions open the page that adds the thing.

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

function back(done: string): never {
  revalidatePath('/admin');
  redirect(`/admin?done=${done}`);
}

/**
 * [SCH-01][NFR-17] No school today: today becomes a snow day in the school year it falls in, and the
 * database re-plans today at once (homework goes; anything checked off stays).
 */
export async function noSchoolToday(): Promise<void> {
  const { db, household } = await context();
  const { error } = await db.rpc('no_school_today', { p_household: household.id });
  if (error) {
    log('warn', 'snow day not saved', { code: error.code, hint: error.hint });
    back(error.hint === 'no_year' ? 'no-year' : 'failed');
  }
  revalidatePath('/admin/school');
  back('snow');
}

/** [SCH-01] Undo: today's own snow day goes again, and today is re-planned as a school day. */
export async function undoNoSchool(form: FormData): Promise<void> {
  const { db, household } = await context();
  const { error } = await db.rpc('undo_no_school_today', {
    p_household: household.id,
    p_closure: String(form.get('id') ?? ''),
  });
  if (error) {
    log('warn', 'snow day not undone', { code: error.code, hint: error.hint });
    back('failed');
  }
  revalidatePath('/admin/school');
  back('school-back');
}

/** [MENU-04][NFR-17] Fetches every school menu feed now, as the morning's job would. */
export async function refreshMenus(): Promise<void> {
  const { db, household } = await context();
  const { data: feeds, error } = await db
    .from('menu_source')
    .select('id, config')
    .eq('household_id', household.id)
    .eq('adapter', 'nutrislice');
  if (error || !feeds?.length) back('no-feed');
  let failed = 0;
  for (const f of feeds!) {
    const outcome = await fetchSource(db, {
      id: f.id,
      config: f.config as NutrisliceConfig,
      contentHash: null,
      timeZone: household.timezone,
    }).catch((e: unknown) => {
      log('error', 'menu fetch not recorded', { error: String(e) });
      return null;
    });
    if (!outcome || outcome.status === 'error') failed += 1;
  }
  revalidatePath('/admin/meals/menus');
  back(failed ? 'menus-failed' : 'menus-fetched');
}
