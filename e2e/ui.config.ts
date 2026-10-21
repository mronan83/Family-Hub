import { defineConfig, devices } from '@playwright/test';

// Brand checks (WP-37, 06 §11): tile style snapshots in both themes, axe contrast on the shells,
// manifests, fonts and the service worker. CI's build job runs them against `next start` on the
// build it just made, so they gate every pull request without a deployment.
// [NFR-16][D-127] The admin app runs on parents' iPhones, so the goal, form and admin layout specs
// run again as an iPhone in WebKit, Safari's engine (WP-100): iPhone Safari draws its own form
// controls, which Chrome never showed. CI installs WebKit; a machine without it runs `--project=chrome`.
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './ui',
  // Computed styles are the same on every machine, so one snapshot per name, no platform suffix.
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    // [D-110] A failed test keeps its trace (CI uploads test-results as brand-checks), so a red that
    // shows only in WebKit, where no one here can run it, says its own cause (WP-113).
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
      // [D-110] Measured on CI's WebKit: the slowest, goals.spec's fit check (four pages, each with
      // axe's contrast scan), took 15 to 27 s and timed out past 30 s on a slower runner; 100 s
      // keeps more than 3× the slowest. Every other iPhone test took under 17 s.
      timeout: 100_000,
      testMatch: [
        'controls.spec.ts',
        'goals.spec.ts',
        'goal-steps.spec.ts',
        'goal-perfect.spec.ts',
        'goal-form-summary.spec.ts',
        'forms.spec.ts',
        'admin-day.spec.ts',
        'admin-menu.spec.ts',
        'groceries.spec.ts',
        'meal-groceries.spec.ts',
        'chores.spec.ts',
        'home-groceries.spec.ts',
      ],
    },
    // [NFR-16][D-132] Safari on a Mac (WP-96): the screens WP-96 changes again in desktop WebKit at
    // 1280 px, as the laptop pictures of the side-by-side are. Desktop Safari's own chrome is not
    // drawn; WebKit is its engine, so its layout and form controls are. Limit as the iPhone's.
    // [MEAL-27] WP-112's Home Groceries card too.
    {
      name: 'mac',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
      timeout: 100_000,
      testMatch: ['chores.spec.ts', 'home-groceries.spec.ts'],
    },
  ],
  webServer: {
    command: 'pnpm --filter @familywise/web exec next start -p 3100',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
