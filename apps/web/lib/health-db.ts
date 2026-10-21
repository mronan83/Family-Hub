// [NFR-12] GET /api/health/db (WP-113): the preview's own path to the database, timed. A save in the
// admin app goes from the browser to the preview's function and from there to the database; the e2e
// run asks this every 15 s (scripts/e2e-run.mjs), so a save that never answered while this path was
// slow is the test database slow under the test, not the app. Previews only: production's health
// check never touches the database, and nothing else needs this.

/** One call to the database: resolves with an error message, or null when it answered. */
export type Probe = () => PromiseLike<{ error: { message: string } | null }>;

/**
 * The answer: 404 outside a preview; else how long one call to public.db_probe() took, 200 when it
 * answered and 503 with its error when it did not.
 */
export async function dbHealth(
  probe: Probe | null,
  env: Record<string, string | undefined> = process.env,
  now: () => number = () => performance.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (env.VERCEL_ENV !== 'preview') return { status: 404, body: { error: 'not found' } };
  if (!probe) return { status: 503, body: { status: 'off', error: 'no database settings' } };
  const from = now();
  let error: string | null;
  try {
    error = (await probe()).error?.message ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Math.round(now() - from);
  return error
    ? { status: 503, body: { status: 'failed', ms, error } }
    : { status: 200, body: { status: 'ok', ms } };
}
