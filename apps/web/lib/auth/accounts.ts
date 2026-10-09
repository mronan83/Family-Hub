import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../log';
import { accountMessage, MIN_PASSWORD, PASSWORD_RULE } from './messages';

/**
 * [ACC-02][ACC-03] Accounts are created by the server, never by public sign-up (D-39): only for
 * someone holding a valid setup code or invite, and only in production, where the secret key lives.
 * The account is created confirmed, so the first sign-in needs no email: Supabase's built-in mailer
 * reaches only the Supabase team (01 §9.10), and password sign-in must work for everyone else.
 * Returns an admin-facing message, or null once the account exists.
 */
export async function createAccount(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<string | null> {
  if (password.length < MIN_PASSWORD) return PASSWORD_RULE;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return null;
  log('warn', 'account not created', { code: error.code, status: error.status });
  return accountMessage(error);
}
