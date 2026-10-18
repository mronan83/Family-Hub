import { test, type Cookie, type Page } from '@playwright/test';
import { currentHousehold } from './household';

/** The demo sign-ins a spec works as, in its own household (supabase/seed.sql, D-137). */
export type Persona = 'Alex' | 'Sam';

/**
 * Each sign-in's session in this worker, by its email: its Supabase cookies and when it was made.
 * Module state, so each Playwright worker has its own. A spec's household is made afresh when the
 * spec starts (e2e/support/household.ts), with its own sign-ins, so a session never outlives them.
 */
const sessions = new Map<string, { cookies: Cookie[]; at: number }>();

/**
 * A session is reused for 30 minutes: its access token lasts an hour (supabase/config.toml
 * jwt_expiry), so a page using it never refreshes it, and two pages sharing it never race to
 * rotate its refresh token.
 */
const REUSE_MS = 30 * 60_000;

/**
 * [NFR-14-z][D-137] Notes a sign-in to Supabase Auth in the test's annotations ("sign-in": when, and
 * whose), so the run counts them against Auth's limit (scripts/e2e-run.mjs, signInWords).
 */
export function noteSignIn(whose: string): void {
  test
    .info()
    .annotations.push({ type: 'sign-in', description: `${new Date().toISOString()} ${whose}` });
}

/**
 * [ACC-02][NFR-14][D-110][D-137] Signs the page's browser context in as a demo persona of the
 * spec's own household (ownHousehold(), e2e/support/household.ts) and opens /admin. Each worker
 * signs in once per persona and household, by the preview's one-tap sign-in with the household's
 * key, and every later call reuses that session's cookies: no test pays for a sign-in, and a run asks
 * Supabase Auth for two or so sign-ins per spec instead of one per test. If the reused session no
 * longer opens /admin, it signs in again. auth.spec.ts tests signing in itself, and signs in on its own.
 */
export async function signIn(page: Page, who: Persona = 'Alex'): Promise<void> {
  const household = currentHousehold();
  const email = household.email(who === 'Alex' ? 'alex' : 'sam');
  const held = sessions.get(email);
  if (held && Date.now() - held.at < REUSE_MS) {
    await page.context().addCookies(held.cookies);
    await page.goto('/admin');
    if (new URL(page.url()).pathname === '/admin') return;
    sessions.delete(email);
  }
  await page.goto(`/sign-in?household=${household.key}`);
  await page.getByRole('button', { name: `Sign in as ${who}`, exact: true }).click();
  await page.waitForURL(/\/admin$/);
  noteSignIn(email);
  const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith('sb-'));
  sessions.set(email, { cookies, at: Date.now() });
}
