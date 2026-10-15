import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test as base, type BrowserContext, type Page, type Response } from '@playwright/test';

export * from '@playwright/test';

const DEMO = '0de00000-0000-4000-8000-000000000001';

/** Where a browser context reports what it saw: the test running now. */
let sink: ((what: string) => void) | null = null;
/** Bodies of Supabase 5xx answers still being read; a test's record waits for them (up to 5 s). */
const reading = new Set<Promise<void>>();
const watched = new WeakSet<BrowserContext>();

/**
 * [NFR-14][D-104] Records, for the test running now, any sign that the infrastructure failed under it:
 * Supabase answering 5xx (a statement timeout among them) or the preview's gateway answering 502, 503
 * or 504. A failed test with such a record re-runs once (scripts/e2e-run.mjs); an app's own 500 is an
 * assertion failure like any other, and never re-runs.
 */
/**
 * [NFR-14][D-105] After a page load (goto, reload), waits until React has hydrated the page
 * (`<html data-hydrated>`, apps/web/app/hydrated.tsx). A click before then is the browser's own:
 * a form reloads the page with its fields in the URL and saves nothing, which a test sees as a save
 * that never answered. Pages that aren't the app's (JSON, a gateway's error page) are left alone
 * after 15 s; what the test checks next says what it found.
 */
function waitForHydration(page: Page): void {
  const settle = async (response: Response | null) => {
    if (!response || !(response.headers()['content-type'] ?? '').includes('text/html')) return;
    await page
      .waitForFunction(() => document.documentElement.dataset.hydrated === 'true', null, {
        timeout: 15_000,
      })
      .catch(() => {});
  };
  const goto = page.goto.bind(page);
  page.goto = async (...args: Parameters<Page['goto']>) => {
    const response = await goto(...args);
    await settle(response);
    return response;
  };
  const reload = page.reload.bind(page);
  page.reload = async (...args: Parameters<Page['reload']>) => {
    const response = await reload(...args);
    await settle(response);
    return response;
  };
}

function watch(context: BrowserContext): void {
  if (watched.has(context)) return;
  watched.add(context);
  for (const page of context.pages()) waitForHydration(page);
  context.on('page', waitForHydration);
  context.on('response', (response) => {
    const status = response.status();
    if (status < 500) return;
    const url = new URL(response.url());
    const what = `${response.request().method()} ${url.pathname}`;
    if (url.hostname.endsWith('.supabase.co')) {
      const read: Promise<void> = response
        .text()
        .then((body) => {
          const timeout = /57014|statement timeout/.test(body) ? ', a statement timeout' : '';
          sink?.(`the browser saw Supabase answer ${status}${timeout} to ${what}`);
        })
        .catch(() => sink?.(`the browser saw Supabase answer ${status} to ${what}`))
        .finally(() => reading.delete(read));
      reading.add(read);
    } else if (status === 502 || status === 503 || status === 504) {
      sink?.(`the browser saw the preview's gateway answer ${status} to ${what}`);
    }
  });
}

/** The demo family's day as the database has it, and the day its data was loaded. */
function demoDays(): { today: string; loaded: string } | null {
  const db = process.env.SUPABASE_DB_URL;
  if (!db) return null;
  try {
    const [today, loaded] = execFileSync(
      'psql',
      [
        db,
        '-X',
        '-A',
        '-t',
        '-q',
        '-F',
        ' ',
        '-c',
        `select (now() at time zone timezone)::date, (created_at at time zone timezone)::date
           from public.household where id = '${DEMO}'`,
      ],
      { encoding: 'utf8', timeout: 15_000 },
    )
      .trim()
      .split(' ');
    return today && loaded ? { today, loaded } : null;
  } catch {
    return null;
  }
}

// [NFR-14][D-85] Every spec imports `test` from here, not from @playwright/test. Playwright runs the
// files in one worker and starts a new worker only after a failure, to carry on with the next file;
// that new worker first loads the demo family again (scripts/preview-db.sh --demo-family-only, on the
// test database only), so the next file starts from the demo family as seeded, not from what the
// failed test left behind.
export const test = base.extend<{ infraWatch: void }, { cleanStart: void; contextWatch: void }>({
  cleanStart: [
    async ({}, use, workerInfo) => {
      if (workerInfo.workerIndex > 0 && process.env.CI && process.env.SUPABASE_DB_URL) {
        execFileSync(
          'bash',
          [path.resolve(__dirname, '../../scripts/preview-db.sh'), '--demo-family-only'],
          {
            stdio: 'inherit',
          },
        );
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  // Every context a test makes, by browser.newContext() or newPage() as most specs do, is watched.
  contextWatch: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args: Parameters<typeof browser.newContext>) => {
        const context = await newContext(...args);
        watch(context);
        return context;
      };
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  context: async ({ context }, use) => {
    watch(context);
    await use(context);
  },
  // [NFR-14][D-104] What the run's verdict reads (scripts/e2e-run.mjs): the test's time limit, any
  // infrastructure failure seen under it, and, when it failed, whether the demo family's day had
  // turned since its data was loaded (seed data counts from the day it was loaded, so a test after
  // the family's midnight reads yesterday's seed; it re-runs once on a reloaded family). It takes
  // `context` so it ends before the test's own context closes, and can wait for the bodies it reads.
  infraWatch: [
    async ({ context }, use, testInfo) => {
      void context;
      const seen: string[] = [];
      sink = (what) => {
        if (seen.length < 5) seen.push(what);
      };
      try {
        await use();
      } finally {
        if (reading.size) {
          await Promise.race([
            Promise.allSettled([...reading]),
            new Promise((done) => setTimeout(done, 5_000)),
          ]);
        }
        sink = null;
        if (testInfo.status !== testInfo.expectedStatus) {
          const days = demoDays();
          if (days && days.today !== days.loaded) {
            seen.push(
              `the demo family's day turned from ${days.loaded} to ${days.today} after its data was loaded`,
            );
          }
        }
        for (const what of seen) testInfo.annotations.push({ type: 'infra', description: what });
        testInfo.annotations.push({ type: 'limit', description: String(testInfo.timeout) });
      }
    },
    { auto: true },
  ],
});
