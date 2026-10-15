import { expect, test, type Page } from '@playwright/test';

// [DEV-05] A board picks up a new deploy by itself (WP-78, D-99), on /dev/board with made-up data and
// no database: the board runs commit aaaaaaa (?deploy=aaaaaaa) and /api/health answers bbbbbbb. The
// page's clock is Playwright's, so minutes pass at once. A reload is seen as a mark left on the
// window being gone.

const RUNNING = 'aaaaaaa';

async function open(page: Page, deployed: string) {
  await page.clock.install();
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', app: 'familywise', commit: deployed } }),
  );
  await page.goto(`/dev/board?lunches=1&deploy=${RUNNING}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { mark?: boolean }).mark = true;
  });
}

const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { mark?: boolean }).mark === true);

test.use({ viewport: { width: 1920, height: 1080 } });

test('[DEV-05] WP-78: an idle board reloads once a new version is deployed', async ({ page }) => {
  await open(page, 'b'.repeat(40));
  const reloaded = page.waitForEvent('load');
  await page.clock.runFor(6 * 60_000);
  await reloaded;
  expect(await marked(page)).toBe(false);
});

test('[DEV-05] WP-78: never with a dialog open, however long it is left', async ({ page }) => {
  await open(page, 'b'.repeat(40));
  // A new version is seen at 5 minutes; Leo then opens a day's choices.
  await page.clock.runFor(5 * 60_000 + 1_000);
  expect(await marked(page)).toBe(true);
  await page.getByRole('button', { name: 'Open Pick next week’s lunches for Leo' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await page
    .getByRole('list', { name: /’s week$/ })
    .getByRole('listitem')
    .nth(2)
    .getByRole('button', { name: 'Pick your lunch' })
    .click();
  const dialog = page.getByRole('dialog', { name: /^Leo’s lunch on / });
  await expect(dialog).toBeVisible();
  await page.clock.runFor(80_000);
  expect(await marked(page), 'WP-78 the board reloaded while Leo was picking').toBe(true);
  await expect(dialog).toBeVisible();
  // The board's own dialogs close after 90 s untouched (BRD-06); one that stays open, however long,
  // holds the reload.
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.id = 'stays-open';
    document.body.append(d);
  });
  await page.clock.runFor(30 * 60_000);
  expect(await marked(page), 'WP-78 the board reloaded with a dialog open').toBe(true);
  // Closed, and left alone: now it reloads.
  await page.evaluate(() => document.getElementById('stays-open')?.remove());
  const reloaded = page.waitForEvent('load');
  await page.clock.runFor(60_000);
  await reloaded;
  expect(await marked(page)).toBe(false);
});

test('[DEV-05] WP-78: not while someone is tapping, and not when the version is the same', async ({
  page,
}) => {
  await open(page, `${RUNNING}${'f'.repeat(33)}`);
  await page.clock.runFor(30 * 60_000);
  expect(await marked(page), 'WP-78 reloaded with no new version').toBe(true);
  await page.unroute('**/api/health');
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { status: 'ok', app: 'familywise', commit: 'b'.repeat(40) } }),
  );
  // A tap every minute: never two minutes untouched, so no reload.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Shift');
    await page.clock.runFor(60_000);
  }
  expect(await marked(page), 'WP-78 reloaded while someone was tapping').toBe(true);
});
