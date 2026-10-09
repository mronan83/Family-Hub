import { createServerClient } from '@supabase/ssr';
import { adminClient } from './supabase/admin';
import { supabaseSettings } from './supabase/server';
import { log, scrub } from './log';

export type AppError = {
  requestId?: string;
  method?: string;
  route?: string;
  kind: string;
  error: unknown;
  /** The household it happened for, shown on that household's System Health page (D-42). */
  householdId?: string | null;
};

/** Cookies from a raw Cookie header. */
function parseCookies(header: string | string[] | undefined): { name: string; value: string }[] {
  const raw = Array.isArray(header) ? header.join('; ') : (header ?? '');
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      return i < 0
        ? { name: part, value: '' }
        : { name: part.slice(0, i), value: decodeURIComponent(part.slice(i + 1)) };
    });
}

/**
 * [NFR-07] The household a failed request was for: a board's own, or the signed-in admin's. Null
 * when signed out or unknown. Best effort, from the request's session cookies; never throws.
 */
export async function householdOfRequest(
  headers: Record<string, string | string[] | undefined>,
): Promise<string | null> {
  try {
    const settings = supabaseSettings();
    const admin = adminClient();
    if (!settings || !admin) return null;
    const cookies = parseCookies(headers.cookie);
    if (!cookies.some((c) => c.name.startsWith('sb-'))) return null;
    const session = createServerClient(settings.url, settings.key, {
      cookies: { getAll: () => cookies, setAll: () => undefined },
    });
    const { data } = await session.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return null;
    const app = claims.app_metadata as { role?: string; household_id?: string } | undefined;
    if (app?.role === 'device') return app.household_id ?? null;
    const { data: link } = await admin
      .from('household_user')
      .select('household_id')
      .eq('user_id', claims.sub)
      .maybeSingle();
    return (link?.household_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * [NFR-07] Keeps a server error in private.app_error (30 days) so it outlives Hobby's one hour of
 * logs, for its household's System Health page. Never throws: a failure to record is only logged.
 */
export async function recordAppError({
  requestId,
  method,
  route,
  kind,
  error,
  householdId,
}: AppError): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = (err as Error & { digest?: string }).digest;
  log('error', 'server error', { requestId, method, route, kind, error: err, digest });
  const db = adminClient();
  if (!db) return;
  const { error: failed } = await db.rpc('record_app_error', {
    p_request_id: requestId ?? null,
    p_method: method ?? null,
    p_route: route ?? null,
    p_kind: kind,
    p_message: scrub(`${err.name}: ${err.message}`),
    p_digest: digest ?? null,
    p_household_id: householdId ?? null,
  });
  if (failed) log('warn', 'could not record the error', { reason: failed.message });
}
