'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { GENERIC, hintMessage } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
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

/** [DEV-02][DEV-03] Disconnects a board for good: its reads stop now, and it cannot sign in again. */
export async function disconnectDevice(form: FormData): Promise<void> {
  const { db } = await context();
  const { error } = await db.rpc('revoke_device', { p_device_id: String(form.get('id') ?? '') });
  if (error) log('warn', 'board not disconnected', { code: error.code, hint: error.hint });
  revalidatePath('/admin/devices');
  redirect('/admin/devices');
}
