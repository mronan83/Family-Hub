import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [DEV-06][DEV-08][NFR-01] The board offline (WP-13) on /dev/board: a made-up family whose stand-in
// server fails while the browser is offline, like a real post. The board keeps its outbox in
// IndexedDB and the service worker keeps its page, so check-offs made offline outlast a reload with
// no network and are sent once each when it returns. The same flow runs on a real board and
// database in e2e/tests/offline.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

type Posted = { id: string; occurrence_id: string; event_type: string }[][];
const posts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fwPosts?: Posted }).__fwPosts ?? []);
const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const health = (page: Page) => page.locator('[data-health]');

/** The page as the service worker controls it, with its page and files cached. */
async function controlled(page: Page, path = '/dev/board') {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load was not the worker's; this one is, so the page and its files are kept.
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function asMaya(page: Page) {
  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
}

const MAYAS = ['Make bed', 'Return library books', 'Feed the dog'];

test('[DEV-06][NFR-01][US-205] three check-offs offline outlast a reload with no network and are sent once each when it returns', async ({
  page,
  context,
}) => {
  await controlled(page);
  const served = await page.locator('[data-rendered]').getAttribute('data-rendered');
  await asMaya(page);
  await context.setOffline(true);
  await expect(health(page)).toHaveText(['Offline: your check-offs are saved']);
  for (const title of MAYAS) {
    await page.getByRole('button', { name: `Check off ${title}`, exact: true }).click();
  }
  // Shown at once; Maya's points are marked as not saved yet.
  for (const title of MAYAS) {
    await expect(page.getByRole('button', { name: `Check off ${title}`, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(page.locator('[data-provisional]')).toContainText('Not saved yet');
  expect(await posts(page)).toEqual([]);

  // A reload with no network: the page is the worker's copy, and the check-offs are still there.
  await page.reload();
  expect(await page.locator('[data-rendered]').getAttribute('data-rendered')).toBe(served);
  await asMaya(page);
  for (const title of MAYAS) {
    await expect(page.getByRole('button', { name: `Check off ${title}`, exact: true })).toHaveCount(
      0,
    );
  }
  await expect(health(page)).toHaveText(['Offline: your check-offs are saved']);

  // The network returns: each is sent once, in the order it was made.
  await context.setOffline(false);
  await expect.poll(async () => (await posts(page)).flat().length).toBe(3);
  const sent = (await posts(page)).flat();
  expect(sent.map((e) => e.occurrence_id)).toEqual(['bed-maya', 'books', 'dog']);
  expect(new Set(sent.map((e) => e.id)).size).toBe(3);
  await expect(health(page)).toHaveCount(0);
  await expect(page.locator('[data-provisional]')).toHaveCount(0);
  // Nothing is left to send after another reload.
  await page.reload();
  await page.waitForTimeout(500);
  expect(await posts(page)).toEqual([]);
});

test('[NFR-01] a day offline: the board keeps running on its cached page, then sends what waited once', async ({
  page,
  context,
}) => {
  // A simulated day runs every timer in it (about 20 s on CI).
  test.setTimeout(120_000);
  await page.clock.install();
  await controlled(page);
  await asMaya(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
  // Every timer runs for 24 hours: the clock, the outbox's retries, the idle return to everyone.
  await page.clock.runFor('24:00:00');
  // [US-205] Still showing its day, saying it is offline and how old that is.
  await expect(page.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  await expect(health(page)).toHaveText([
    'Offline: your check-offs are saved',
    'Updated 1 day ago',
  ]);
  // Back on the dashboard after a while untouched (D-66), with Maya's bed still done.
  const list = page.locator('.fw-dash__list');
  await expect(
    list.getByRole('button', { name: 'Make bed: done for Maya', exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole('button', { name: 'Check off Make bed for Maya', exact: true }),
  ).toHaveCount(0);
  expect(await posts(page)).toEqual([]);
  await context.setOffline(false);
  await page.clock.runFor(1_000);
  await expect
    .poll(async () => (await posts(page)).flat().map((e) => e.occurrence_id))
    .toEqual(['bed-maya']);
});

for (const theme of ['day', 'evening'] as const) {
  test(`[DEV-08][US-206] says when its data is old or a job is behind, in the bar, legible in ${theme}`, async ({
    page,
    context,
  }) => {
    await page.goto(`/dev/board?theme=${theme}&stale=1`);
    await expect(health(page)).toHaveText(['Updated 12 minutes ago']);
    await expect(page.locator('[data-health="stale"] svg')).toBeVisible();
    await page.goto(`/dev/board?theme=${theme}&jobs=1`);
    await expect(health(page)).toHaveText(['Today’s list may be out of date']);
    await page.goto(`/dev/board?theme=${theme}`);
    await expect(health(page)).toHaveCount(0);

    // Offline and old at once, with a provisional balance: in the bar, above the chores, no overflow.
    await page.goto(`/dev/board?theme=${theme}&stale=1`);
    await asMaya(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
    await expect(health(page)).toHaveText([
      'Offline: your check-offs are saved',
      'Updated 12 minutes ago',
    ]);
    await expect(page.locator('[data-provisional]')).toBeVisible();
    const bar = (await page.locator('.fw-board__bar').boundingBox())!;
    for (const line of await health(page).all()) {
      const box = (await line.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Not a second live region: the board's connection status is the page's one.
    await expect(page.getByRole('status')).toHaveCount(0);
    const { violations } = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .include('.fw-board__bar')
      .include('[data-provisional]')
      .analyze();
    expect(
      violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`)),
    ).toEqual([]);
    await context.setOffline(false);
  });
}
