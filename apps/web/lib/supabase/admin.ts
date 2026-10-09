import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

/**
 * The service-role client for server code: jobs and the error log (01 §9.8). It bypasses RLS, so
 * it never reaches the browser. Production only: previews hold no secret key (D-37), and there this
 * returns null.
 */
export function adminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return cached;
}
