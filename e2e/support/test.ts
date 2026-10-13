import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test as base } from '@playwright/test';

export * from '@playwright/test';

// [NFR-14][D-85] Every spec imports `test` from here, not from @playwright/test. Playwright runs the
// files in one worker and starts a new worker only after a failure, to retry it or to carry on with
// the next file; that new worker first loads the demo family again (scripts/preview-db.sh
// --demo-family-only, on the test database only), so a retry starts where the first attempt did
// instead of on what the failed attempt left behind.
export const test = base.extend<object, { cleanStart: void }>({
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
});
