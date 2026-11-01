import { test as base } from '@playwright/test';
import { answerPrefetches } from '../../scripts/next-prefetch.mjs';

// [NFR-16-u][D-110][D-152] The UI suite's `test`: Playwright's, with Next.js's router prefetches
// answered by the suite (scripts/next-prefetch.mjs, WP-118). A page.goto that cancels a prefetch still
// in flight fails in WebKit ("WebKit encountered an internal error") or never answers; every spec
// imports `test` from here, so no page of the iPhone or Mac projects has one in flight.
// [NFR-16-w] A spec that sets `realPrefetches` keeps the app's own prefetches (prefetch.spec.ts).

export * from '@playwright/test';

export const test = base.extend<{ realPrefetches: boolean }>({
  realPrefetches: [false, { option: true }],
  context: async ({ context, realPrefetches }, use) => {
    if (!realPrefetches) await answerPrefetches(context);
    await use(context);
  },
});
