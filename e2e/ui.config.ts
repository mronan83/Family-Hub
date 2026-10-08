import { defineConfig, devices } from '@playwright/test';

// Brand checks (WP-37, 06 §11): tile style snapshots in both themes, axe contrast on the shells,
// manifests, fonts and the service worker. CI's build job runs them against `next start` on the
// build it just made, so they gate every pull request without a deployment.
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: './ui',
  // Computed styles are the same on every machine, so one snapshot per name, no platform suffix.
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3100',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'pnpm --filter @familywise/web exec next start -p 3100',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
