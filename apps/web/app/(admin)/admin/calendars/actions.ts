'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { syncSource } from '@/lib/calendar/sync';
import { calendarSaveMessage, parseCalendar } from '@/lib/calendars';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/calendars');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/**
 * [CAL-01][US-501] Adds a calendar by its link, or changes one (a link typed replaces the old one in
 * Vault). A link just typed is synced at once with that link, as the admin (D-63): they see its
 * events, or what's wrong with it, now, not in 15 minutes; previews, which can't read Vault, too.
 */
export async function saveCalendar(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '') || null;
  const parsed = parseCalendar(form, !id);
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const { data, error } = await db.rpc('save_calendar_source', {
    p_household: household.id,
    p_source: id,
    p_name: v.name,
    p_url: v.url,
    p_color: v.color,
    p_member: v.memberId,
    p_show_on_board: v.showOnBoard,
  });
  if (error) {
    log('warn', 'calendar not saved', { code: error.code, hint: error.hint });
    return { message: calendarSaveMessage(error) };
  }
  let did = id ? 'saved' : 'added';
  if (v.url) {
    const outcome = await syncSource(db, {
      id: data as string,
      url: v.url,
      contentHash: null,
      timeZone: household.timezone,
    }).catch((e: unknown) => {
      // Saved all the same: the calendar_sync job tries again within 15 minutes.
      log('error', 'first calendar sync not recorded', { error: String(e) });
      return null;
    });
    did += outcome?.status === 'synced' ? '_synced' : '_failed';
  }
  revalidatePath('/admin/calendars');
  redirect(`/admin/calendars?did=${did}&name=${encodeURIComponent(v.name)}`);
}

/** [CAL-01] Removes a calendar: its events leave FamilyWise and its link leaves Vault. */
export async function removeCalendar(form: FormData): Promise<void> {
  const { db } = await context();
  const name = String(form.get('name') ?? '');
  const { error } = await db.rpc('remove_calendar_source', {
    p_source: String(form.get('id') ?? ''),
  });
  if (error) log('warn', 'calendar not removed', { code: error.code });
  revalidatePath('/admin/calendars');
  redirect(
    error
      ? '/admin/calendars?error=remove'
      : `/admin/calendars?did=removed&name=${encodeURIComponent(name)}`,
  );
}
