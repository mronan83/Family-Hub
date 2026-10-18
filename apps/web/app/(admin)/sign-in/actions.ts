'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  demoEmail,
  demoPassword,
  demoSecret,
  isDemoPersona,
  isE2eHousehold,
} from '@/lib/auth/demo';
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

/**
 * [ACC-02] One tap into a demo sign-in, on previews only (lib/auth/demo.ts): the demo family's, or
 * an e2e household's copy when the form names one (D-136).
 */
export async function demoSignIn(form: FormData): Promise<void> {
  const secret = demoSecret();
  const persona = form.get('persona');
  const household = form.get('household');
  const db = await serverClient();
  if (!secret || !db || !isDemoPersona(persona)) redirect('/sign-in');
  if (household !== null && !isE2eHousehold(household)) redirect('/sign-in');
  const email = demoEmail(persona, household);
  const credentials = { email, password: demoPassword(secret, email) };
  let { error } = await db.auth.signInWithPassword(credentials);
  // Supabase Auth answering 5xx, or not answering (status 0), is its own failure, not a refusal:
  // asked once more. A refusal (a 4xx) is final.
  if (error && (!error.status || error.status >= 500)) {
    log('warn', 'demo sign-in: Auth did not answer; asking once more', {
      persona,
      status: error.status ?? 0,
    });
    ({ error } = await db.auth.signInWithPassword(credentials));
  }
  if (error && (!error.status || error.status >= 500)) {
    // Not a refusal: e2e reads `error=auth` as Supabase failing under the test (e2e/support/test.ts).
    log('warn', 'demo sign-in: Auth did not answer', { persona, status: error.status ?? 0 });
    redirect('/sign-in?error=auth');
  }
  if (error) {
    log('warn', 'demo sign-in refused', { persona, code: error.code, status: error.status });
    redirect('/sign-in?error=demo');
  }
  redirect(safeNext(form.get('next')));
}
