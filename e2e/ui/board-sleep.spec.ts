import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [DEV-07][US-207] Sleep and wake per board (WP-34, D-116, D-117), with the made-up family
// and no database. The board, /dev/board?sleep=kitchen: Kitchen's set times from the mockup (school
// nights 9:30 pm to 6:30 am, weekends 10:30 pm to 7:30 am, 15 minutes untouched; school Monday to
// Friday), or ?sleep=idle (5 minutes untouched). The page's clock is Playwright's, set to a day and
// time, so minutes pass at once and the test holds at any real hour. Boards, /dev/boards: the
// section on a phone and a laptop, in Day and Evening. Saving, Home and the real board run on the
// preview (e2e/tests/board-sleep.spec.ts). Boards' folds themselves (WP-91) are in boards.spec.ts.

const cover = (page: Page) => page.locator('.fw-sleep');
const board = (page: Page) => page.locator('main.fw-board');
/** Today's list's first check-off, in sight at the top of the list. */
const firstCheck = (page: Page) =>
  page
    .locator('.fw-dash__list')
    .getByRole('button', { name: /^Check off / })
    .first();
const posts = (page: Page) =>
  page.evaluate(
    () => ((window as unknown as { __fwPosts?: unknown[][] }).__fwPosts ?? []).flat().length,
  );

async function open(page: Page, at: string, sleep: 'kitchen' | 'idle') {
  await page.clock.install({ time: new Date(at) });
  await page.goto(`/dev/board?sleep=${sleep}`);
  // [D-110] React has hydrated the page: its timers and handlers are live.
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The middle of a control the black cover hides (it is there, under the cover). */
async function middleOf(page: Page) {
  const box = await firstCheck(page).boundingBox();
  expect(box, 'a check-off is on the board').not.toBeNull();
  expect(box!.y + box!.height, 'the check-off is in sight').toBeLessThan(1080);
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test.describe('the board', () => {
  test.use({ viewport: { width: 1920, height: 1080 }, hasTouch: true });

  test('[DEV-07][US-207] WP-34: asleep at its time, black; a touch wakes it and presses nothing; it sleeps again', async ({
    page,
  }) => {
    // Thursday: school on Friday, so a school night from 9:30 pm.
    await open(page, '2026-10-15T21:29:00-04:00', 'kitchen');
    await test.step('awake until 9:30 pm, then black over everything', async () => {
      await expect(board(page)).toHaveAttribute('data-asleep', 'false');
      await expect(cover(page)).toHaveCount(0);
      await page.clock.runFor(2 * 60_000);
      await expect(
        page.getByRole('button', { name: 'Kitchen is asleep. Touch to wake it.' }),
      ).toBeVisible();
      await expect(board(page)).toHaveAttribute('data-asleep', 'true');
      expect(await cover(page).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
        'rgb(0, 0, 0)',
      );
      const { x, y } = await middleOf(page);
      expect(
        await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.className, [x, y]),
        'the cover is what a touch lands on',
      ).toBe('fw-sleep');
    });
    await test.step('a touch on a check-off wakes it, and doesn’t check it off', async () => {
      const name = await firstCheck(page).getAttribute('aria-label');
      const { x, y } = await middleOf(page);
      await page.touchscreen.tap(x, y);
      await expect(cover(page)).toHaveCount(0);
      await expect(board(page)).toHaveAttribute('data-asleep', 'false');
      await expect(page.getByRole('button', { name: name!, exact: true })).toBeVisible();
      expect(await posts(page), 'the waking touch checked something off').toBe(0);
    });
    await test.step('the next touch works as always', async () => {
      await page.touchscreen.tap(...(Object.values(await middleOf(page)) as [number, number]));
      await expect.poll(() => posts(page)).toBe(1);
    });
    await test.step('15 minutes untouched, in its set times, it sleeps again', async () => {
      await page.clock.runFor(14 * 60_000);
      await expect(board(page)).toHaveAttribute('data-asleep', 'false');
      await page.clock.runFor(60_000 + 16_000);
      await expect(cover(page)).toHaveAttribute('data-state', 'asleep');
    });
  });

  test('[DEV-07][US-207] WP-34: opened in the night it stays asleep until touched, and wakes at 6:30', async ({
    page,
  }) => {
    await open(page, '2026-10-16T02:00:00-04:00', 'kitchen');
    await expect(cover(page)).toHaveAttribute('data-state', 'asleep');
    // Friday's school-night wake time.
    await page.clock.runFor((4 * 60 + 29) * 60_000);
    await expect(cover(page)).toHaveAttribute('data-state', 'asleep');
    await page.clock.runFor(60_000 + 16_000);
    await expect(cover(page)).toHaveCount(0);
  });

  test('[DEV-07][US-207] WP-34: untouched for its idle time it sleeps; the mouse moving wakes it', async ({
    page,
  }) => {
    await open(page, '2026-10-15T12:00:00-04:00', 'idle');
    await page.clock.runFor(4 * 60_000);
    await expect(board(page)).toHaveAttribute('data-asleep', 'false');
    await page.clock.runFor(60_000 + 16_000);
    await expect(cover(page)).toHaveAttribute('data-state', 'asleep');
    await page.mouse.move(400, 400);
    await page.mouse.move(420, 410);
    await expect(cover(page)).toHaveCount(0);
    expect(await posts(page)).toBe(0);
    // Asleep again, a click where the mouse rests (on a check-off) only wakes it too.
    const { x, y } = await middleOf(page);
    await page.mouse.move(x, y);
    await page.clock.runFor(5 * 60_000 + 16_000);
    await expect(cover(page)).toHaveAttribute('data-state', 'asleep');
    await page.mouse.down();
    await page.mouse.up();
    await expect(cover(page)).toHaveCount(0);
    expect(await posts(page), 'the waking click checked something off').toBe(0);
  });
});

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** The page's width, and controls in Kitchen's open section under 44 px tall (radios aside). */
const fit = (page: Page) =>
  page.evaluate(() => ({
    wide: document.documentElement.scrollWidth,
    small: [
      ...document.querySelectorAll<HTMLElement>(
        '#sleep-kitchen button, #sleep-kitchen select, #sleep-kitchen input, #sleep-kitchen summary',
      ),
    ]
      .filter(
        (e) => !(e instanceof HTMLInputElement && ['radio', 'checkbox', 'hidden'].includes(e.type)),
      )
      .filter((e) => e.getBoundingClientRect().height < 44)
      .map((e) => e.getAttribute('name') || e.textContent?.trim()),
  }));

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`Boards on ${device}`, () => {
    test.use({ viewport: { width, height } });

    for (const theme of ['day', 'evening'] as const) {
      test(`[DEV-07][US-207] WP-34: each board’s sleep and wake, in ${theme}`, async ({ page }) => {
        // Kitchen opened, as after a save there (WP-91).
        await page.goto(`/dev/boards?open=kitchen${theme === 'evening' ? '&theme=evening' : ''}`);
        const kitchen = page.getByRole('form', { name: 'Sleep and wake for Kitchen' });
        await expect(kitchen).toBeVisible();
        await expect(page.getByText(/^Awake · sleeps at 9:30 pm · seen 1 min ago/)).toBeVisible();
        await expect(
          page.getByText(
            'School nights 9:30 pm to 6:30 am, weekends 10:30 pm to 7:30 am; sleeps after 15 minutes untouched; missed only while awake.',
          ),
        ).toBeVisible();
        await expect(kitchen.getByRole('radio', { name: /^Only while awake/ })).toBeChecked();
        await expect(
          kitchen.getByRole('checkbox', { name: 'Kitchen sleeps and wakes at set times' }),
        ).toBeChecked();
        await expect(kitchen.locator('input[name=school_sleep]')).toHaveValue('21:30');
        await expect(kitchen.locator('input[name=weekend_wake]')).toHaveValue('07:30');
        await expect(
          kitchen.getByRole('combobox', { name: 'Sleep when nobody touches it' }),
        ).toHaveValue('15');
        // Hallway tablet, folded: asleep at its set times, with its wake time.
        await expect(page.getByText(/^Asleep · wakes at 8:00 am · seen 7 h ago/)).toBeVisible();
        expect(await fit(page)).toEqual({ wide: width, small: [] });
        await contrastOk(page);
      });
    }
  });
}
