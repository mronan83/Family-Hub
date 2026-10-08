import { defineConfig, devices } from '@playwright/test';

// e2e runs against a deployed preview (01 §9.3). E2E_BASE_URL is the Vercel preview URL;
// VERCEL_AUTOMATION_BYPASS_SECRET lets the run through deployment protection.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
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
