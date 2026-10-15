import { defineConfig, devices } from '@playwright/test';

// e2e runs against a deployed preview (01 §9.3). E2E_BASE_URL is the Vercel preview URL;
// VERCEL_AUTOMATION_BYPASS_SECRET lets the run through deployment protection.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// A Chromium of another version, when Playwright's own isn't installed (as in e2e/ui.config.ts).
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  // Every spec works on the one demo family (on the test database, D-85) and resets only what it
  // changes, so two files at once race: the board's live-update test renames Maya while the list tests pick her by name.
  // Files run one after another.
  fullyParallel: false,
  workers: 1,
  // [NFR-14][D-104] No blind retries: an assertion failure is red at once. A failure the
  // infrastructure caused (a statement timeout, a refused connection, a 5xx from Supabase) re-runs
  // once, that test only, decided by scripts/e2e-run.mjs from the evidence e2e/support/test.ts records.
  retries: 0,
  // [D-105] A test's time limit comes from its measured time on the free test database with at least
  // 3× headroom; the run's summary lists any test that used more than a third of its limit. Most tests
  // take 2 to 20 s; a test that needs more sets its own limit (test.setTimeout) from its measured time.
  timeout: 90_000,
  // Assertions that wait on a server round trip allow 15 s: on a preview, a server action now and
  // then takes over 5 s to answer (seen in pairing and in saving an item). Speed itself is measured
  // by the tests that time it (DEV-05, the WP-08 list entry), not by this timeout.
  expect: { timeout: 15_000 },
  // The HTML report sits next to this file, where the workflow uploads it from on a failure.
  // E2E_JSON is where scripts/e2e-run.mjs reads each result from.
  reporter: [
    ...(process.env.CI
      ? ([['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] as const)
      : ([['list']] as const)),
    ...(process.env.E2E_JSON ? ([['json', { outputFile: process.env.E2E_JSON }]] as const) : []),
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: bypass
      ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    // [D-105] The household's own zone and locale, as the kiosk and the parents' phones have them, so
    // a browser's "today" is the family's today at any hour of the runner's UTC day.
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  projects: [
    {
      // NFR-02: the reference panel is 3840×2160, laid out at 1920×1080 logical px with DPR 2.
      name: 'board-4k',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
