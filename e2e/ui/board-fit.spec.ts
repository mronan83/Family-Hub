import { boardZoom, TEXT_SIZES } from '../../packages/ui/src/board-fit';
import { expect, test, type Page } from '@playwright/test';

// [BRD-08] The board fits the screen it is on (WP-47, D-73), on /dev/board with the made-up family:
// laid out on the 1920×1080 canvas and zoomed to the screen, so a 4K panel shows it twice as large
// (sharper, the same layout), a laptop smaller, and a wider or taller screen gives it more room. Each
// text size zooms it further; with larger text the dashboard puts the list under the calendar and
// scrolls inside the screen (D-74), never the page. The
// zoom follows the window, swipes are measured in the board's own px, and the board starts at the
// text size it last had before it has read anything. The preview's done-when is in
// e2e/tests/board-fit.spec.ts.

const zoom = (page: Page) =>
  page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.board')!).getPropertyValue('--fw-zoom')),
  );

for (const [width, height, scale, screen] of [
  [1470, 830, 2, 'a 13" laptop’s browser'],
  [1920, 1080, 1, 'a 1080p screen'],
  [3840, 2160, 1, 'a 4K panel at device scale 1'],
  [2560, 1080, 1, 'an ultrawide screen'],
  [1920, 1200, 1, 'a 16:10 screen'],
] as const) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: scale });
    test(`[BRD-08][BRD-03] fits ${width}×${height}: zoomed to the canvas, no sideways scroll, everything in proportion`, async ({
      page,
    }) => {
      await page.goto('/dev/board');
      await expect(page.locator('.fw-dash')).toBeVisible();
      const z = boardZoom(width, height);
      expect(await zoom(page)).toBe(z);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const m = await page.evaluate(() => {
        const board = document.querySelector<HTMLElement>('.fw-board')!;
        const bar = document.querySelector<HTMLElement>('.fw-board__bar')!;
        const people = [...document.querySelectorAll<HTMLElement>('.fw-today__people button')];
        return {
          boardWidth: board.getBoundingClientRect().width,
          bar: bar.offsetHeight,
          barOnScreen: bar.getBoundingClientRect().height,
          // [D-74] One screen: the page itself never scrolls.
          pageScroll: document.documentElement.scrollHeight - innerHeight,
          smallest: Math.min(...people.map((b) => b.offsetHeight)),
          smallestOnScreen: Math.min(...people.map((b) => b.getBoundingClientRect().height)),
        };
      });
      // The board uses the whole width of the screen, at the zoom.
      expect(m.boardWidth).toBeCloseTo(width, 0);
      // offsetHeight is whole px; on screen it is within one board px of that times the zoom.
      expect(Math.abs(m.barOnScreen - m.bar * z)).toBeLessThanOrEqual(z);
      expect(m.pageScroll).toBeLessThanOrEqual(0);
      // Touch targets keep their 56 px in the board's own px, and grow or shrink with it on screen.
      expect(m.smallest).toBeGreaterThanOrEqual(56);
      expect(Math.abs(m.smallestOnScreen - m.smallest * z)).toBeLessThanOrEqual(z);
    });
  });
}

test.describe('text sizes on a 1080p screen', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  for (const size of TEXT_SIZES) {
    test(`[BRD-08][US-1007] ${size.label}: zoomed ${size.scale}×, ${size.scale > 1 ? 'the list under the calendar' : 'the list beside the calendar'}, no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(`/dev/board?text=${size.value}`);
      await expect(page.locator('html')).toHaveAttribute('data-text-size', size.value);
      expect(await zoom(page)).toBe(size.scale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
      const [cal, list] = await Promise.all([
        page.locator('.fw-dash__cal').boundingBox(),
        page.locator('.fw-dash__list').boundingBox(),
      ]);
      if (size.scale > 1) expect(list!.y).toBeGreaterThanOrEqual(cal!.y + cal!.height);
      else expect(list!.x).toBeGreaterThanOrEqual(cal!.x + cal!.width);
    });
  }

  test('[BRD-08] at Largest, More info opens whole on the screen', async ({ page }) => {
    await page.goto('/dev/board?text=largest');
    // At Largest the list is below the fold, in the screen that scrolls (D-74): the tap may come
    // before the page has hydrated, so tap until the sheet opens.
    await expect(async () => {
      await page
        .getByRole('button', { name: /More info/ })
        .first()
        .click();
      await expect(page.locator('.fw-details')).toBeVisible({ timeout: 1_000 });
    }).toPass();
    const sheet = (await page.locator('.fw-details').boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(1920);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(1080);
  });

  test('[BRD-08] stays fitted when React has to draw the page afresh', async ({ page }) => {
    // A board clock days away from the server's: the first draw doesn't match, and React replaces
    // the page's elements. The zoom lives on <html>, which React keeps, and the board fits again.
    await page.clock.setFixedTime(new Date(Date.now() + 3 * 86_400_000));
    await page.goto('/dev/board?text=largest');
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'largest');
    await expect.poll(() => zoom(page)).toBe(1.3);
  });

  test('[BRD-08] the board fits again when the window changes size', async ({ page }) => {
    await page.goto('/dev/board');
    expect(await zoom(page)).toBe(1);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(() => zoom(page)).toBe(boardZoom(1280, 720));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  });

  // With no service worker: it would serve the app's code from its cache, past the blocked
  // requests below, and the app would set the dev page's own size (Standard) before the check.
  test.describe('before any app code', () => {
    test.use({ serviceWorkers: 'block' });

    test('[BRD-08] the board starts at the text size it last had, before it has read anything', async ({
      page,
    }) => {
      await page.goto('/dev/board?text=larger');
      await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
      // Only the page's own first-paint scripts run: no app code, as before a board's first read.
      await page.route('**/_next/static/chunks/**', (route) => route.abort());
      await page.goto('/dev/board');
      expect(await zoom(page)).toBe(1.15);
      await expect(page.locator('html')).toHaveAttribute('data-text-size', 'larger');
    });
  });
});

test.describe('a swipe on a 4K panel at device scale 1', () => {
  test.use({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
  test('[BRD-08][CAL-04] is measured in the board’s own px: the same reach turns the page', async ({
    page,
  }) => {
    await page.goto('/dev/board');
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page
      .getByRole('group', { name: 'Calendar view' })
      .getByRole('button', { name: 'Day' })
      .click();
    const title = page.locator('#cal-title');
    const first = await title.textContent();
    const box = (await page.locator('.fw-bcal__body').boundingBox())!;
    const swipe = async (dx: number) => {
      await page.mouse.move(box.x + box.width / 2, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + 100, { steps: 5 });
      await page.mouse.up();
    };
    // 200 px on screen is 100 of the board's: short of a turn (120).
    await swipe(-200);
    await expect(title).toHaveText(first!);
    // 400 on screen is 200 of the board's: a turn.
    await swipe(-400);
    await expect(title).not.toHaveText(first!);
  });
});
