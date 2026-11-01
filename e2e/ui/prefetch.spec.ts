import { expect, test } from './test';

// [NFR-16-w][D-152] The suite answers Next.js's link prefetches itself (e2e/ui/test.ts, WP-118), so
// this spec keeps the app's own: on the made-up family's Settings, the admin menu's links prefetch
// for real, and a tap on Help while a prefetch is still on its way opens Help. In Chrome, as an
// iPhone in WebKit and as Safari on a Mac: a person's tap must never meet WebKit's failed loads.
test.use({ realPrefetches: true });

test('[NFR-16-w] a tap on a link while the app’s own prefetch is on its way opens the page', async ({
  page,
}) => {
  const prefetching = page.waitForRequest((r) => Boolean(r.headers()['next-router-prefetch']));
  await page.goto('/dev/settings');
  await page.locator('html[data-hydrated]').waitFor();
  const nav = page.getByRole('navigation', { name: 'Admin' });
  // On a phone the menu is behind its button; its links prefetch once they are shown.
  const menu = page.getByRole('button', { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  const prefetch = await prefetching;
  // The prefetch went to the server, not to the suite.
  expect(prefetch.url(), 'a prefetch of the app').toContain('_rsc=');
  await nav.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
});
