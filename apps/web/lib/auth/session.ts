import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { signInPath } from './next';

export interface SignedIn {
  userId: string;
  email: string | null;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  weekStart: number;
  role: 'owner' | 'admin';
}

/**
 * [ACC-02] The signed-in user, verified on the server: getClaims checks the session's JWT (against
 * the project's signing keys, or with Supabase Auth), never trusting the cookie as it stands. A board
 * session (app_metadata.role = device, WP-05) is not an admin and gets null here.
 */
export async function signedIn(db: SupabaseClient): Promise<SignedIn | null> {
  const { data, error } = await db.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const appRole = (claims.app_metadata as { role?: string } | undefined)?.role;
  if (appRole === 'device') return null;
  return { userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

/** The signed-in admin, or a redirect to sign in and come back to `next`. */
export async function requireSignedIn(db: SupabaseClient | null, next: string): Promise<SignedIn> {
  const user = db ? await signedIn(db) : null;
  if (!user) redirect(signInPath(next));
  return user;
}

/** The household this admin runs (one per admin, ACC-01), read through RLS; null before setup. */
export async function adminHousehold(
  db: SupabaseClient,
  userId: string,
): Promise<Household | null> {
  const { data, error } = await db
    .from('household_user')
    .select('role, household:household_id (id, name, timezone, week_start)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`household lookup: ${error.message}`);
  const h = data?.household as unknown as
    { id: string; name: string; timezone: string; week_start: number } | null | undefined;
  if (!data || !h) return null;
  return {
    id: h.id,
    name: h.name,
    timezone: h.timezone,
    weekStart: h.week_start,
    role: data.role as Household['role'],
  };
}
