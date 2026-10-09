import { defineConfig, devices } from '@playwright/test';

// e2e runs against a deployed preview (01 §9.3). E2E_BASE_URL is the Vercel preview URL;
// VERCEL_AUTOMATION_BYPASS_SECRET lets the run through deployment protection.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests',
  // Every spec works on the one demo family (D-37) and resets only what it changes, so two files at
  // once race: the board's live-update test renames Maya while the list tests pick her by name.
  // Files run one after another.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Assertions that wait on a server round trip allow 15 s: on a preview, a server action now and
  // then takes over 5 s to answer (seen in pairing and in saving an item). Speed itself is measured
  // by the tests that time it (DEV-05, the WP-08 list entry), not by this timeout.
  expect: { timeout: 15_000 },
  // The HTML report sits next to this file, where the workflow uploads it from on a failure.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: bypass
      ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
    trace: 'retain-on-failure',
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
