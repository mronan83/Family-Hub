'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import {
  BOARD_CREDENTIAL_COOKIE,
  BOARD_CREDENTIAL_MAX_AGE,
  encodeCredential,
  normalizeCode,
  PAIRING_MESSAGES,
} from '@/lib/devices';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

interface Redeemed {
  ok: boolean;
  reason?: 'invalid' | 'paused';
  email?: string;
  password?: string;
}

/**
 * [DEV-01] Redeems the code with the browser-safe key (the database creates the board's own sign-in,
 * D-40), signs this browser in as the board, and keeps the credential in an httpOnly cookie so the
 * board can sign in again unattended.
 */
export async function pairBoard(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: PAIRING_MESSAGES.off };
  const code = normalizeCode(form.get('code'));
  if (code.length !== 8) return { message: PAIRING_MESSAGES.short };

  const { data, error } = await db.rpc('redeem_pairing_code', { p_code: code });
  const result = data as Redeemed | null;
  if (error || !result) {
    log('error', 'pairing code not redeemed', { code: error?.code });
    return { message: PAIRING_MESSAGES.failed };
  }
  if (!result.ok || !result.email || !result.password) {
    return {
      message: result.reason === 'paused' ? PAIRING_MESSAGES.paused : PAIRING_MESSAGES.invalid,
    };
  }

  // An admin signed in on this browser is signed out: the browser is a board from now on.
  await db.auth.signOut({ scope: 'local' });
  const { error: signInError } = await db.auth.signInWithPassword({
    email: result.email,
    password: result.password,
  });
  if (signInError) {
    log('error', 'new board could not sign in', { code: signInError.code });
    return { message: PAIRING_MESSAGES.failed };
  }
  (await cookies()).set(
    BOARD_CREDENTIAL_COOKIE,
    encodeCredential({ email: result.email, password: result.password }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/board',
      maxAge: BOARD_CREDENTIAL_MAX_AGE,
    },
  );
  redirect('/board');
}
