'use server';

import { redirect } from 'next/navigation';
import { createAccount } from '@/lib/auth/accounts';
import { type FormState, GENERIC, hintMessage, SIGN_IN_OFF } from '@/lib/auth/messages';
import { signedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { adminClient } from '@/lib/supabase/admin';
import { serverClient } from '@/lib/supabase/server';

export interface InvitePreview {
  householdName: string;
  email: string;
  state: 'valid' | 'used' | 'revoked' | 'expired';
}

/** [ACC-03] What an invite link shows before anyone signs in; null for a token that matches nothing. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const db = await serverClient();
  if (!db || !token || token.length > 200) return null;
  const { data, error } = await db.rpc('invite_preview', { p_token: token });
  if (error) {
    log('warn', 'invite preview', { code: error.code });
    return null;
  }
  const row = (
    data as { household_name: string; email: string; state: InvitePreview['state'] }[]
  )[0];
  return row ? { householdName: row.household_name, email: row.email, state: row.state } : null;
}

async function accept(token: string): Promise<FormState> {
  const db = await serverClient();
  if (!db) return { message: SIGN_IN_OFF };
  const { error } = await db.rpc('accept_invite', { p_token: token });
  if (error) {
    log('warn', 'invite not accepted', { code: error.code, hint: error.hint });
    return { message: hintMessage(error) };
  }
  redirect('/admin?joined=1');
}

/** [ACC-03] The signed-in admin accepts (the database checks the token and the email). */
export async function acceptInvite(_prev: FormState, form: FormData): Promise<FormState> {
  return accept(String(form.get('token') ?? ''));
}

/**
 * [ACC-03] Signed out, in production: create the invited email's account with the chosen password,
 * sign in, accept. The email comes from the invite, not the form.
 */
export async function joinWithNewAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await serverClient();
  const admin = adminClient();
  if (!db) return { message: SIGN_IN_OFF };
  if (!admin || (await signedIn(db))) return { message: GENERIC };
  const token = String(form.get('token') ?? '');
  const invite = await previewInvite(token);
  if (!invite) return { message: hintMessage({ hint: 'invite_unknown' }) };
  if (invite.state !== 'valid') return { message: hintMessage({ hint: `invite_${invite.state}` }) };
  const password = String(form.get('password') ?? '');
  const problem = await createAccount(admin, invite.email, password);
  if (problem) return { message: problem };
  const { error } = await db.auth.signInWithPassword({ email: invite.email, password });
  if (error) {
    log('error', 'sign-in after account creation', { code: error.code });
    return { message: GENERIC };
  }
  return accept(token);
}
