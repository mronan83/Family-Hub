'use server';

import { redirect } from 'next/navigation';
import { createAccount } from '@/lib/auth/accounts';
import { type FormState, GENERIC, hintMessage, SIGN_IN_OFF } from '@/lib/auth/messages';
import { signedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { adminClient } from '@/lib/supabase/admin';
import { serverClient } from '@/lib/supabase/server';

/**
 * [ACC-01] Creates the household with a setup code (the setup-code workflow issues one, for 24 hours)
 * and makes the signed-in admin its owner. Signed out, in production only, it first creates the
 * owner's account, confirmed, after checking the code (D-39).
 */
export async function setUpHousehold(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: SIGN_IN_OFF };
  const code = String(form.get('code') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  const timezone = String(form.get('timezone') ?? '');
  const weekStart = Number(form.get('weekStart') ?? 0);
  if (!code) return { message: hintMessage({ hint: 'setup_code_invalid' }) };
  if (!name || name.length > 80)
    return { message: 'Give the household a name of up to 80 characters.' };
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) return { message: GENERIC };

  if (!(await signedIn(db))) {
    const admin = adminClient();
    if (!admin) return { message: hintMessage({ hint: 'not_signed_in' }) };
    const { data: usable, error: checkError } = await admin.rpc('setup_code_usable', {
      p_code: code,
    });
    if (checkError) {
      log('error', 'setup code check', { code: checkError.code });
      return { message: GENERIC };
    }
    if (!usable) return { message: hintMessage({ hint: 'setup_code_invalid' }) };
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') ?? '');
    if (!email.includes('@')) return { message: hintMessage({ hint: 'bad_email' }) };
    const problem = await createAccount(admin, email, password);
    if (problem) return { message: problem };
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      log('error', 'sign-in after account creation', { code: error.code });
      return { message: GENERIC };
    }
  }

  const { error } = await db.rpc('create_household', {
    p_code: code,
    p_name: name,
    p_timezone: timezone,
    p_week_start: weekStart,
  });
  if (error) {
    log('warn', 'household not created', { code: error.code, hint: error.hint });
    return { message: hintMessage(error) };
  }
  redirect('/admin?welcome=1');
}
