'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { demoEmail, demoPassword, demoSecret, isDemoPersona } from '@/lib/auth/demo';
import {
  type FormState,
  hintMessage,
  LINK_SENT,
  SIGN_IN_OFF as OFF,
  SIGN_IN_FAILED,
} from '@/lib/auth/messages';
import { safeNext } from '@/lib/auth/next';
import { requestOrigin } from '@/lib/auth/origin';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

function emailOf(form: FormData): string {
  return String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
}

/** [ACC-02] Email and password. One neutral line on any refusal. */
export async function signInWithPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: OFF };
  const email = emailOf(form);
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { message: SIGN_IN_FAILED };
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    log('warn', 'password sign-in refused', { code: error.code, status: error.status });
    return { message: SIGN_IN_FAILED };
  }
  redirect(safeNext(form.get('next')));
}

/**
 * [ACC-02] Magic link, for existing accounts only (never creates one, D-39). The page says the same
 * thing whether or not the account exists, and whether or not the mailer sent it.
 */
export async function sendMagicLink(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: OFF };
  const email = emailOf(form);
  if (!email.includes('@')) return { message: hintMessage({ hint: 'bad_email' }) };
  const next = safeNext(form.get('next'));
  const origin = requestOrigin(await headers());
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) log('warn', 'magic link not sent', { code: error.code, status: error.status });
  return { sent: true, message: LINK_SENT };
}

/** [ACC-02] One tap into a demo sign-in, on previews only (lib/auth/demo.ts). */
export async function demoSignIn(form: FormData): Promise<void> {
  const secret = demoSecret();
  const persona = form.get('persona');
  const db = await serverClient();
  if (!secret || !db || !isDemoPersona(persona)) redirect('/sign-in');
  const email = demoEmail(persona);
  const { error } = await db.auth.signInWithPassword({
    email,
    password: demoPassword(secret, email),
  });
  if (error) {
    log('warn', 'demo sign-in refused', { persona, code: error.code });
    redirect('/sign-in?error=demo');
  }
  redirect(safeNext(form.get('next')));
}
