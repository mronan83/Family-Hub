'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  type FormState,
  GENERIC,
  hintMessage,
  LINK_SENT,
  MIN_PASSWORD,
  PASSWORD_RULE,
  SIGN_IN_OFF,
} from '@/lib/auth/messages';
import { requestOrigin } from '@/lib/auth/origin';
import { signedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

/** [ACC-02] Sends a reset link; the same line whether or not the account exists. */
export async function sendResetLink(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: SIGN_IN_OFF };
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email.includes('@')) return { message: hintMessage({ hint: 'bad_email' }) };
  const origin = requestOrigin(await headers());
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/reset-password/new')}`,
  });
  if (error) log('warn', 'reset link not sent', { code: error.code, status: error.status });
  return { sent: true, message: LINK_SENT };
}

/** [ACC-02] Sets a new password for the signed-in admin (arriving from the reset link). */
export async function setNewPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db || !(await signedIn(db))) redirect('/sign-in');
  const password = String(form.get('password') ?? '');
  if (password.length < MIN_PASSWORD) return { message: PASSWORD_RULE };
  const { error } = await db.auth.updateUser({ password });
  if (error) {
    log('warn', 'password not changed', { code: error.code, status: error.status });
    return { message: error.code === 'weak_password' ? PASSWORD_RULE : GENERIC };
  }
  await db.auth.signOut({ scope: 'others' });
  redirect('/admin?password=changed');
}
