'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GENERIC, hintMessage } from '@/lib/auth/messages';
import { signInPath } from '@/lib/auth/next';
import { requestOrigin } from '@/lib/auth/origin';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

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
