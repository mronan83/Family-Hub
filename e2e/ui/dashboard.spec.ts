import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [BRD-01][BRD-05][BRD-07][US-1001][US-1004][US-1006] The family dashboard (WP-35, D-66) on
// /dev/board: the board's home screen, its calendar (?span=3|5|7|month), today's list with a face per
// person, the cards in the layout's order (?cards=…), "More info", tiles of one height, the pinned
// top bar and the idle return. At the board's 1920×1080. Saving a layout on Boards and seeing it on a
// real board within 3 seconds runs in e2e/tests/board-layout.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

const MAYA = 'f1000000-0000-4000-8000-000000000001';
const ALEX = 'f1000000-0000-4000-8000-000000000003';

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const list = (page: Page) => page.locator('.fw-dash__list');
const posts = (page: Page) =>
  page.evaluate(() =>
    (
      (
        window as unknown as {
          __fwPosts?: { occurrence_id: string; event_type: string; done_by?: string[] }[][];
        }
      ).__fwPosts ?? []
    ).flat(),
  );

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Buttons under 56 px, text under 28 px and the page's width, for BRD-03 and NFR-11. */
const fit = (page: Page) =>
  page.evaluate(() => {
    const small = [...document.querySelectorAll('.fw-board button')]
      .filter((b) => b.getBoundingClientRect().height < 56)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    const tiny = [...document.querySelectorAll('.fw-today *')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
      .map((el) => el.textContent?.trim());
    return { wide: document.documentElement.scrollWidth, small, tiny };
  });

/** Text in the dashboard that runs out of its box: a long word in a narrow day, a long title. */
const spills = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.fw-dash .fw-bcal__title, .fw-dash .fw-dash__title')]
      .filter((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = (el.closest('.fw-bcal__event, li') ?? el).getBoundingClientRect();
        return range.getBoundingClientRect().right > box.right + 1;
      })
      .map((el) => el.textContent),
  );

for (const theme of ['day', 'evening'] as const) {
  for (const span of ['5', 'month'] as const) {
    test(`[BRD-03][NFR-11] the dashboard with ${span === 'month' ? 'the month' : 'five days'} fits the board in ${theme}: 56 px targets, 28 px text, AA contrast`, async ({
      page,
    }) => {
      await page.goto(`/dev/board?theme=${theme}&span=${span}`);
      await expect(page.locator('.fw-dash')).toHaveAttribute('data-span', span);
      expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
      expect(await spills(page)).toEqual([]);
      await contrastOk(page);
    });
  }
}

test('[BRD-01][D-66] home is the dashboard: the calendar first, today’s list beside it, then the cards', async ({
  page,
}) => {
  await page.goto('/dev/board');
  await expect(people(page).getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: /^Next 5 days/, level: 2 })).toBeVisible();
  await expect(page.locator('.fw-dash__day')).toHaveCount(5);
  await expect(page.locator('.fw-dash__day').first()).toHaveAttribute('data-today', '');
  await expect(list(page).getByRole('heading', { level: 3 })).toHaveText([
    'Overdue',
    'Morning',
    'After school',
    'Evening',
    'Anytime',
  ]);
  // The cards, in the default order (meals are hidden until there are meals).
  await expect(page.locator('.fw-dash__cards > section h2')).toHaveText([
    'Goals',
    'Waiting for a parent',
    'Coming up',
  ]);
  // [PTS-02] Each child's points in their button; adults have none.
  await expect(people(page).locator('[data-pill-balance]')).toHaveCount(2);
  await expect(
    people(page).getByRole('button', { name: 'Maya', exact: true }).locator('[data-pill-balance]'),
  ).toHaveAttribute('data-pill-balance', '42');
});

test('[BRD-07][D-66] an item everyone does their own is one row with a face each; a tap checks it off for that person', async ({
  page,
}) => {
  await page.goto('/dev/board');
  const bed = list(page).locator('li[data-row]', { hasText: 'Make bed' });
  await expect(bed).toHaveCount(1);
  await expect(bed.locator('.fw-face')).toHaveCount(2);
  await bed.getByRole('button', { name: 'Check off Make bed for Maya', exact: true }).click();
  await expect(
    bed.getByRole('button', { name: 'Undo Make bed for Maya', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => posts(page))
    .toEqual([
      expect.objectContaining({
        occurrence_id: 'bed-maya',
        event_type: 'complete',
        done_by: [MAYA],
      }),
    ]);
  // [PTS-02] Maya's points in the top bar move at once.
  await expect(
    people(page).getByRole('button', { name: 'Maya', exact: true }).locator('[data-pill-balance]'),
  ).toHaveAttribute('data-pill-balance', '47');
});

test('[US-305] a done face undoes with a second tap', async ({ page }) => {
  await page.goto('/dev/board');
  await page.getByRole('button', { name: 'Check off Make bed for Maya', exact: true }).click();
  await page.getByRole('button', { name: 'Undo Make bed for Maya', exact: true }).click();
  await page
    .getByRole('button', { name: 'Tap again to undo Make bed for Maya', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Check off Make bed for Maya', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await posts(page)).map((e) => e.event_type))
    .toEqual(['complete', 'undo']);
});

test('[CHR-04][D-30] a shared item: the face tapped is who did it, and the others are covered', async ({
  page,
}) => {
  await page.goto('/dev/board');
  const dog = list(page).locator('li[data-row]', { hasText: 'Feed the dog' });
  await dog.getByRole('button', { name: 'Check off Feed the dog for Alex', exact: true }).click();
  await expect(dog.locator('.fw-face[data-state="covered"]')).toHaveCount(1);
  await expect(
    dog.getByRole('button', { name: 'Feed the dog: done by someone else for Maya', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => posts(page))
    .toEqual([expect.objectContaining({ occurrence_id: 'dog', done_by: [ALEX] })]);
});

test('[CAL-04][D-66] the month: a dot per calendar on a day with events; a tap opens that day', async ({
  page,
}) => {
  await page.goto('/dev/board?span=month');
  const cells = page.locator('.fw-dash__cells li');
  expect(await cells.count()).toBeGreaterThanOrEqual(35);
  const today = page.locator('.fw-dash__cells li[data-today]');
  // Today: Spelling test (School) and Swim (Family), two calendars, two dots.
  await expect(today.locator('.fw-dash__dots i')).toHaveCount(2);
  const label = await today.getByRole('button').getAttribute('aria-label');
  expect(label).toMatch(/: 2 events$/);
  await today.getByRole('button').click();
  await expect(
    page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Day' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fw-bcal__event')).toHaveText([/Spelling test/, /Swim/]);
});

test('[CAL-04][D-66] a word too long for a narrow day wraps inside its event, in five and seven days', async ({
  page,
}) => {
  for (const span of ['5', '7']) {
    await page.goto(`/dev/board?span=${span}`);
    await expect(page.locator('.fw-dash__day').first()).toBeVisible();
    await expect(
      page.locator('.fw-dash__day .fw-bcal__title', { hasText: 'Grandparents' }).first(),
    ).toBeVisible();
    expect(await spills(page), `${span} days`).toEqual([]);
  }
});

test('[CAL-04][D-66] a day’s head in the columns opens that day too', async ({ page }) => {
  await page.goto('/dev/board?span=3');
  await expect(page.locator('.fw-dash__day')).toHaveCount(3);
  await page.locator('.fw-dash__day').nth(1).getByRole('button').click();
  await expect(
    page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Day' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Tomorrow: the dentist and Alex's meeting.
  await expect(page.locator('.fw-bcal__event')).toHaveText([/Dentist/, /Team meeting/]);
});

test('[BRD-05][US-1004] the cards show in the layout’s order, and only those shown', async ({
  page,
}) => {
  await page.goto('/dev/board?cards=coming,goals');
  await expect(page.locator('.fw-dash__cards > section h2')).toHaveText(['Coming up', 'Goals']);
  await expect(page.locator('.fw-dash__coming')).toContainText([
    'Grandparents visit',
    'Picture day',
  ]);
});

test('[D-66] "More info" opens an item in full; Escape closes it', async ({ page }) => {
  await page.goto('/dev/board');
  await page.getByRole('button', { name: 'More info about Feed the dog', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feed the dog' });
  await expect(dialog).toContainText('One scoop of dry food, and fresh water in the blue bowl.');
  await expect(dialog).toContainText('By 5:00 pm (evening)');
  await expect(dialog).toContainText('Maya:');
  await expect(dialog).toContainText('Alex:');
  await contrastOk(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // No "More info" where there is nothing more.
  await expect(page.getByRole('button', { name: 'More info about Set the table' })).toHaveCount(0);
  // A tile has it too, on a person's screen.
  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  await page.getByRole('button', { name: 'More info about Homework', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Homework' })).toContainText(
    'Reading log and spelling words',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('[D-66] every tile in a list is one height, on Chores and on a person’s screen', async ({
  page,
}) => {
  await page.goto('/dev/board');
  for (const view of ['Chores', 'Maya']) {
    await people(page).getByRole('button', { name: view, exact: true }).click();
    const heights = await page
      .locator('.fw-today__tile .fw-tile')
      .evaluateAll((els) => [
        ...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height))),
      ]);
    expect(heights, view).toHaveLength(1);
  }
});

test('[BRD-06][D-66] the top stays pinned while the dashboard scrolls; untouched, it goes back to the top', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: 'Chores', exact: true }).click();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  const pinned = (await people(page).boundingBox())!;
  expect(pinned.y).toBeGreaterThanOrEqual(0);
  expect(pinned.y).toBeLessThan(300);
  await page.clock.runFor(91_000);
  await expect(people(page).getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
