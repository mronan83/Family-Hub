'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { GENERIC, hintMessage } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { BOARD_THEMES } from '@/lib/devices';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/devices');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

export interface PairingState {
  message?: string;
  code?: string;
  name?: string;
  expiresAt?: string;
}

/** [DEV-01] Names a board and issues its 8-digit code (10 minutes, once). Shown once, here. */
export async function startPairing(_prev: PairingState, form: FormData): Promise<PairingState> {
  const { db, household } = await context();
  const name = String(form.get('name') ?? '').trim();
  const { data, error } = await db.rpc('create_pairing_code', {
    p_household_id: household.id,
    p_device_name: name,
  });
  if (error || typeof data !== 'string') {
    log('warn', 'pairing code not issued', { code: error?.code, hint: error?.hint });
    return { message: error ? hintMessage(error) : GENERIC };
  }
  return { code: data, name, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
}

/** [DEV-03] Renames a board (RLS and the column grant allow the name and settings only). */
export async function renameDevice(form: FormData): Promise<void> {
  const { db, household } = await context();
  const name = String(form.get('name') ?? '').trim();
  if (name.length >= 1 && name.length <= 60) {
    const { error } = await db
      .from('device')
      .update({ name })
      .eq('id', String(form.get('id') ?? ''))
      .eq('household_id', household.id);
    if (error) log('warn', 'board not renamed', { code: error.code });
  }
  revalidatePath('/admin/devices');
  redirect('/admin/devices');
}

/**
 * [DEV-05] Holds a board on Day or Evening, or lets it follow the household's time (06 §4.1). The
 * board hears the change through Realtime and switches at once.
 */
export async function setBoardTheme(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  const theme = BOARD_THEMES.find((t) => t.value === form.get('theme'))?.value;
  if (theme) {
    const { data } = await db
      .from('device')
      .select('board_config')
      .eq('id', id)
      .eq('household_id', household.id)
      .maybeSingle();
    if (data) {
      const { error } = await db
        .from('device')
        .update({ board_config: { ...(data.board_config as object), theme } })
        .eq('id', id)
        .eq('household_id', household.id);
      if (error) log('warn', 'board theme not set', { code: error.code });
    }
  }
  revalidatePath('/admin/devices');
  redirect('/admin/devices');
}

/** [DEV-02][DEV-03] Disconnects a board for good: its reads stop now, and it cannot sign in again. */
export async function disconnectDevice(form: FormData): Promise<void> {
  const { db } = await context();
  const { error } = await db.rpc('revoke_device', { p_device_id: String(form.get('id') ?? '') });
  if (error) log('warn', 'board not disconnected', { code: error.code, hint: error.hint });
  revalidatePath('/admin/devices');
  redirect('/admin/devices');
}

/**
 * [CAL-05][US-507] Saves which calendars a board shows: those ticked, and none other (a calendar
 * connected later stays off this board until ticked). The board hears it through Realtime.
 */
export async function setBoardCalendars(form: FormData): Promise<void> {
  const { db } = await context();
  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '');
  const { error } = await db.rpc('set_board_calendars', {
    p_device: id,
    p_calendars: form.getAll('calendars').map(String),
  });
  if (error) log('warn', 'board calendars not saved', { code: error.code });
  revalidatePath('/admin/devices');
  redirect(
    error
      ? '/admin/devices?error=calendars'
      : `/admin/devices?did=calendars&name=${encodeURIComponent(name)}`,
  );
}
