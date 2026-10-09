import { adminClient } from './supabase/admin';
import { log, scrub } from './log';

export type AppError = {
  requestId?: string;
  method?: string;
  route?: string;
  kind: string;
  error: unknown;
};

/**
 * [NFR-07] Keeps a server error in private.app_error (30 days) so it outlives Hobby's one hour of
 * logs, for the System Health page. Never throws: a failure to record is only logged.
 */
export async function recordAppError({
  requestId,
  method,
  route,
  kind,
  error,
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
  });
  if (failed) log('warn', 'could not record the error', { reason: failed.message });
}
