import type { Cookie, Page } from '@playwright/test';

/** The demo family's sign-ins a spec works as (supabase/seed.sql). */
export type Persona = 'Alex' | 'Sam';

/**
 * Each persona's session in this worker: its Supabase cookies and when it was made. Module state,
 * so each Playwright worker has its own; a worker starts after any reload of the demo family
 * (e2e/support/test.ts cleanStart, scripts/e2e-run.mjs's re-run), so its sessions are never older
 * than the sign-ins they belong to.
 */
const sessions = new Map<Persona, { cookies: Cookie[]; at: number }>();

/**
 * A session is reused for 30 minutes: its access token lasts an hour (supabase/config.toml
 * jwt_expiry), so a page using it never refreshes it, and two pages sharing it never race to
 * rotate its refresh token.
 */
const REUSE_MS = 30 * 60_000;

/**
 * [ACC-02][NFR-14][D-105] Signs the page's browser context in as a demo persona and opens /admin.
 * Each worker signs in once per persona, by the preview's one-tap sign-in, and every later call
 * reuses that session's cookies: no test pays for a sign-in, and a run asks Supabase Auth for a
 * handful of sign-ins instead of one per test. If the reused session no longer opens /admin, it
 * signs in again. auth.spec.ts tests signing in itself, and signs in on its own.
 */
export async function signIn(page: Page, who: Persona = 'Alex'): Promise<void> {
  const held = sessions.get(who);
  if (held && Date.now() - held.at < REUSE_MS) {
    await page.context().addCookies(held.cookies);
    await page.goto('/admin');
    if (new URL(page.url()).pathname === '/admin') return;
    sessions.delete(who);
  }
  await page.goto('/sign-in');
  await page.getByRole('button', { name: `Sign in as ${who}`, exact: true }).click();
  await page.waitForURL(/\/admin$/);
  const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith('sb-'));
  sessions.set(who, { cookies, at: Date.now() });
}
