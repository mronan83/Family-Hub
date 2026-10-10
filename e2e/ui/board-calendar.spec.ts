import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CAL-04][CAL-05][CAL-06][US-503] The board's calendar (WP-23) on /dev/board: the made-up family's
// Family, School (Maya's) and Work (Alex's) calendars around today, read from a stand-in for
// board_calendar(), at the board's 1920×1080. ?busy=1 adds 40 events this month; ?calbehind=1 makes
// School's sync fail. Unticking a calendar on a real board runs in e2e/tests/board-calendar.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const views = (page: Page) => page.getByRole('group', { name: 'Calendar view' });

async function openCalendar(page: Page, query = '') {
  await page.goto(`/dev/board${query}`);
  await people(page).getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('#cal-title')).toBeVisible();
}

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

for (const theme of ['day', 'evening'] as const) {
  test(`[CAL-04][BRD-03][NFR-11] day, week and month fit the board in ${theme}: 56 px targets, 28 px text`, async ({
    page,
  }) => {
    await openCalendar(page, `?theme=${theme}&busy=1`);
    for (const view of ['Day', 'Week', 'Month']) {
      await views(page).getByRole('button', { name: view }).click();
      await expect(views(page).getByRole('button', { name: view })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const report = await page.evaluate(() => {
        const small = [...document.querySelectorAll('.fw-bcal button')]
          .filter((b) => b.getBoundingClientRect().height < 56)
          .map((b) => b.getAttribute('aria-label') ?? b.textContent);
        const tiny = [...document.querySelectorAll('.fw-bcal *')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
          .map((el) => el.textContent?.trim());
        return { wide: document.documentElement.scrollWidth, small, tiny };
      });
      expect(report, view).toEqual({ wide: 1920, small: [], tiny: [] });
      await contrastOk(page);
    }
  });
}

test('[CAL-04][CAL-05] the week: today’s events in their calendars’ colors, with whose they are', async ({
  page,
}) => {
  await openCalendar(page);
  await expect(views(page).getByRole('button', { name: 'Week' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const today = page.locator('.fw-bcal__col[data-today]');
  await expect(today.locator('.fw-bcal__event')).toHaveText([
    /^All day\s*Spelling test/,
    /^5:00 pm\s*Swim/,
  ]);
  const spelling = today.locator('.fw-bcal__event', { hasText: 'Spelling test' });
  await expect(spelling).toHaveAttribute('data-calendar', 'School');
  // School is Maya's calendar: her avatar beside its events.
  await expect(spelling.getByRole('img', { name: 'Maya' })).toBeVisible();
  const colors = await today
    .locator('.fw-bcal__event')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderLeftColor));
  expect(new Set(colors).size).toBe(2);
  // [CAL-03] Events are only read: nothing offers to add or change one.
  await expect(page.getByRole('button', { name: /add|edit|new event/i })).toHaveCount(0);
});

test('[CAL-04][US-503] arrows, a swipe and Today move through days, weeks and months', async ({
  page,
}) => {
  await openCalendar(page);
  await views(page).getByRole('button', { name: 'Day' }).click();
  const title = page.locator('#cal-title');
  const first = await title.textContent();
  await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title).not.toHaveText(first!);
  // Tomorrow: the dentist (moved in Apple Calendar) and Alex's meeting.
  await expect(page.locator('.fw-bcal__event')).toHaveText([
    /^9:30 am\s*Dentist/,
    /^2:00 pm\s*Team meeting/,
  ]);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(title).toHaveText(first!);

  // A swipe left turns to the next day, a swipe right back.
  const body = page.locator('.fw-bcal__body');
  const box = (await body.boundingBox())!;
  const swipe = async (dx: number) => {
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 50, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(-400);
  await expect(title).not.toHaveText(first!);
  await swipe(400);
  await expect(title).toHaveText(first!);

  await views(page).getByRole('button', { name: 'Month' }).click();
  const month = await title.textContent();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(title).not.toHaveText(month!);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(title).toHaveText(month!);
});

test('[US-503] 40 events in a month show at once, three a day and "+N more"; a day opens', async ({
  page,
}) => {
  await openCalendar(page, '?busy=1');
  const started = Date.now();
  await views(page).getByRole('button', { name: 'Month' }).click();
  const busiest = page.locator('.fw-bcal__cell', { hasText: /\+\d+ more/ }).first();
  await expect(busiest).toBeVisible();
  const ms = Date.now() - started;
  console.log(`[US-503] month view with 40 events drawn in ${ms} ms`);
  expect(ms).toBeLessThan(2000);
  await expect(busiest.locator('.fw-bcal__chip')).toHaveCount(3);
  const more = Number((await busiest.locator('.fw-bcal__more').textContent())!.match(/\d+/)![0]);
  await busiest.click();
  await expect(views(page).getByRole('button', { name: 'Day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.fw-bcal__event')).toHaveCount(3 + more);
});

test('[CAL-06] a calendar that can’t sync says so; its last good events stay', async ({ page }) => {
  await openCalendar(page, '?calbehind=1');
  await expect(page.getByText('School hasn’t updated since', { exact: false })).toBeVisible();
  await expect(page.getByText('Showing its last good events.', { exact: false })).toBeVisible();
  await expect(page.locator('.fw-bcal__col[data-today]')).toContainText('Spelling test');
});

test('[CAL-04] offline, a range the board hasn’t read shows what it has, and says so', async ({
  page,
  context,
}) => {
  await openCalendar(page);
  await context.setOffline(true);
  await views(page).getByRole('button', { name: 'Month' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByText('Showing what this board has for these dates.')).toBeVisible();
  await context.setOffline(false);
});

test('[CAL-04][CAL-05] a person’s screen lists today’s events from their calendars and the family’s', async ({
  page,
}) => {
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Today', level: 3 }),
  });
  await expect(card.locator('.fw-bcal__event')).toHaveText([
    /^All day\s*Spelling test/,
    /^5:00 pm\s*Swim/,
  ]);
  await people(page).getByRole('button', { name: 'Alex', exact: true }).click();
  // School is Maya's: not on Alex's screen; the family's swim is.
  await expect(card.locator('.fw-bcal__event')).toHaveText([/^5:00 pm\s*Swim/]);
});
