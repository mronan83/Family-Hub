import { expect, test } from '@playwright/test';

// [NFR-14][D-105] The app marks a page once React has hydrated it (apps/web/app/hydrated.tsx): e2e
// waits for the mark after every page load, since a form submitted before it is the browser's own
// (a reload that saves nothing). On the admin app's sign-in page, the board and a dev page.

for (const path of ['/sign-in', '/board', '/dev/goals']) {
  test(`[NFR-14] ${path} is marked hydrated once React has taken over`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  });
}
