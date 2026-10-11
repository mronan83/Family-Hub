'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GENERIC, hintMessage } from '@/lib/auth/messages';
import { signInPath } from '@/lib/auth/next';
import { requestOrigin } from '@/lib/auth/origin';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';
import { runWeather } from '@/lib/weather';

export interface InviteState {
  message?: string;
  link?: string;
  email?: string;
}

/**
 * [ACC-03] A new invite link for one email address. The token is shown once, here, and stored only
 * as a hash; it rides after `#` so it never reaches a server log. A new invite to the same email
 * replaces the open one.
 */
export async function createInvite(_prev: InviteState, form: FormData): Promise<InviteState> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = db ? await adminHousehold(db, user.userId) : null;
  if (!db || !household) return { message: hintMessage({ hint: 'not_admin' }) };
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const { data, error } = await db.rpc('create_invite', {
    p_household_id: household.id,
    p_email: email,
  });
  if (error || typeof data !== 'string') {
    log('warn', 'invite not created', { code: error?.code, hint: error?.hint });
    return { message: error ? hintMessage(error) : GENERIC };
  }
  revalidatePath('/admin');
  return { link: `${requestOrigin(await headers())}/invite#${data}`, email };
}

/** [ACC-03] Cancels an open invite; RLS limits it to this admin's household. */
export async function revokeInvite(form: FormData): Promise<void> {
  const db = await serverClient();
  await requireSignedIn(db, '/admin');
  const id = String(form.get('id') ?? '');
  const { error } = await db!
    .from('invite')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_at', null);
  if (error) log('warn', 'invite not revoked', { code: error.code });
  revalidatePath('/admin');
}

/** Signs out this browser and goes to sign in, coming back to `next` if given. */
export async function signOut(form: FormData): Promise<void> {
  const db = await serverClient();
  if (db) await db.auth.signOut({ scope: 'local' });
  redirect(signInPath(String(form.get('next') ?? '')));
}

/**
 * [CHR-05][D-22] Whether a parent approves the children's check-offs. Switching re-resolves only
 * items still to do (the database's trigger); check-offs already waiting stay in the queue, and
 * those already done stay done.
 */
export async function setApprovalMode(form: FormData): Promise<void> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = db ? await adminHousehold(db, user.userId) : null;
  if (!db || !household) redirect('/setup');
  const mode = form.get('approval') === 'on' ? 'on' : 'off';
  const { error } = await db
    .from('household_settings')
    .update({ approval_mode: mode })
    .eq('household_id', household.id);
  if (error) {
    log('warn', 'approval mode not saved', { code: error.code });
    redirect('/admin?approval=failed');
  }
  revalidatePath('/admin');
  redirect(`/admin?approval=${mode}`);
}

/**
 * [BRD-04][US-1003] The household's place for the weather (WP-45, D-69), as chosen from what matched
 * a search, or none. A place is read at once, so the boards show it within moments, not at the next
 * half hour.
 */
export async function setWeatherPlace(form: FormData): Promise<void> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = db ? await adminHousehold(db, user.userId) : null;
  if (!db || !household) redirect('/setup');
  const clear = form.get('clear') === '1';
  const { error } = await db.rpc('set_weather_place', {
    p_household: household.id,
    p_place: clear ? null : String(form.get('name') ?? ''),
    p_latitude: clear ? null : Number(form.get('latitude')),
    p_longitude: clear ? null : Number(form.get('longitude')),
  });
  if (error) {
    log('warn', 'weather place not saved', { code: error.code, hint: error.hint });
    redirect('/admin?weather=failed#weather');
  }
  if (!clear) await readWeatherNow(db, household.id);
  revalidatePath('/admin');
  redirect(`/admin?weather=${clear ? 'cleared' : 'saved'}#weather`);
}

/** [BRD-04] °F or °C for the boards' weather; the weather is read again at once in the new unit. */
export async function setTemperatureUnit(form: FormData): Promise<void> {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = db ? await adminHousehold(db, user.userId) : null;
  if (!db || !household) redirect('/setup');
  const { error } = await db.rpc('set_temperature_unit', {
    p_household: household.id,
    p_unit: form.get('unit') === 'celsius' ? 'celsius' : 'fahrenheit',
  });
  if (error) {
    log('warn', 'temperature unit not saved', { code: error.code, hint: error.hint });
    redirect('/admin?weather=failed#weather');
  }
  await readWeatherNow(db, household.id);
  revalidatePath('/admin');
  redirect('/admin?weather=unit#weather');
}

/** Reads the weather right after a change. A failure here is the reading's own (Home says why). */
async function readWeatherNow(db: SupabaseClient, householdId: string) {
  try {
    await runWeather(db, householdId);
  } catch (e) {
    log('warn', 'weather not read after a change', { error: String(e) });
  }
}
