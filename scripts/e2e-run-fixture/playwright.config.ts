import { defineConfig } from '@playwright/test';

// [NFR-14][D-104] A tiny suite for scripts/e2e-run.selftest.mjs: the run script's verdicts on an
// injected statement timeout, a Supabase 5xx the browser saw, and an assertion failure.
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  reporter: process.env.E2E_JSON ? [['json', { outputFile: process.env.E2E_JSON }]] : 'list',
  use: executablePath ? { launchOptions: { executablePath } } : {},
});
