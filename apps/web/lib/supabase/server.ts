import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** The browser-safe project settings (01 §9.8): set on Production and Preview, absent in CI builds. */
export function supabaseSettings(
  env: Record<string, string | undefined> = process.env,
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/**
 * [ACC-02] A Supabase client for this request, acting as the signed-in admin through RLS (the
 * session lives in cookies). Create one per request. In a Server Component cookies are read-only,
 * so a refreshed session is written by proxy.ts instead; actions and route handlers write it here.
 * Null when the project settings are missing (CI builds), so pages can say sign-in is off.
 */
export async function serverClient(): Promise<SupabaseClient | null> {
  // Read cookies first, even when sign-in is off, so every page that asks is rendered per request.
  const store = await cookies();
  const settings = supabaseSettings();
  if (!settings) return null;
  return createServerClient(settings.url, settings.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // A Server Component render: proxy.ts has already refreshed the session.
        }
      },
    },
  });
}
