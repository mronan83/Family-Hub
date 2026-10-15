import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { floors } from '../support/floors';

// [CAL-04][CAL-05][CAL-06][CAL-10][US-503][US-509] The board's calendar (WP-23; the time grid, WP-52,
// D-82) on /dev/board: the made-up family's Family, School (Maya's) and Work (Alex's) calendars around
// today, read from a stand-in for board_calendar(), at the board's 1920×1080. ?busy=1 adds 40 events
// this month; ?allday=1 three more all-day events today and an appointment beside tomorrow's meeting;
// ?calbehind=1 makes School's sync fail. Unticking a calendar on a real board runs in
// e2e/tests/board-calendar.spec.ts.
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
  test(`[CAL-04][BRD-03][NFR-11][D-82] day, week and month fit the board in ${theme}: 56 px targets and 28 px text, the grid's own 30 px and 20 px`, async ({
    page,
  }) => {
    await openCalendar(page, `?theme=${theme}&busy=1&allday=1`);
    for (const view of ['Day', 'Week', 'Month']) {
      await views(page).getByRole('button', { name: view }).click();
      await expect(views(page).getByRole('button', { name: view })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const report = await page.evaluate(floors, { buttons: '.fw-bcal', text: '.fw-bcal' });
      expect(report, view).toEqual({ wide: 1920, small: [], tiny: [] });
      await contrastOk(page);
    }
    // [CAL-10] An event's details keep the board's floors.
    await views(page).getByRole('button', { name: 'Week' }).click();
    await page.locator('.fw-tgrid__event', { hasText: 'Swim' }).first().click();
    expect(
      await page.evaluate(floors, { buttons: '[role="dialog"]', text: '[role="dialog"]' }),
    ).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
  });
}

test('[CAL-04][CAL-05][D-82] the week: all-day events across the top, the rest by the hour, in their calendars’ colors, with whose they are', async ({
  page,
}) => {
  // A Monday at 3:10 pm, New York: the hours from 8 am, now among them.
  await page.clock.install({ time: new Date('2026-10-12T15:10:00-04:00') });
  await openCalendar(page);
  await expect(views(page).getByRole('button', { name: 'Week' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Today's test is all day: across the top, not among the hours; its swim at 5 pm.
  const spelling = page.locator('.fw-tgrid__bar', { hasText: 'Spelling test' });
  await expect(spelling).toHaveAttribute('data-calendar', 'School');
  // School is Maya's calendar: she is in its name, and in its details.
  await expect(spelling).toHaveAccessibleName(/^Spelling test, .*, all day, Maya$/);
  const today = page.locator('.fw-bcal__col[data-today]');
  await expect(today.locator('.fw-bcal__event')).toHaveText([/Swim/]);
  await expect(today.locator('.fw-bcal__event')).toHaveAccessibleName(
    /^Swim, .*, 5:00 – 6:00 pm, Family$/,
  );
  // The three-day visit is one bar over its days.
  const visit = page.locator('.fw-tgrid__bar', { hasText: 'Grandparents visit' });
  await expect(visit).toHaveCount(1);
  const [bar, day] = await Promise.all([
    visit.boundingBox(),
    page.locator('.fw-bcal__col').first().boundingBox(),
  ]);
  expect(bar!.width).toBeGreaterThan(day!.width * 2);
  const colors = await Promise.all(
    [spelling, today.locator('.fw-bcal__event')].map((l) =>
      l.evaluate((el) => getComputedStyle(el).borderLeftColor),
    ),
  );
  expect(new Set(colors).size).toBe(2);
  // The hours: each one's line, 8 am at the top; now a line across today.
  await expect(page.locator('.fw-tgrid__hour').first()).toHaveText('8 am');
  await expect(today.locator('.fw-tgrid__now')).toHaveCount(1);
  await expect(page.locator('.fw-tgrid__now-tag')).toHaveText('3:10');
  // [CAL-03] Events are only read: nothing offers to add or change one.
  await expect(page.getByRole('button', { name: /add|edit|new event/i })).toHaveCount(0);
});

test('[D-82] early in the morning the hours reach back to now, so its line is there', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-12T05:50:00-04:00') });
  await openCalendar(page);
  await expect(page.locator('.fw-tgrid__hour').first()).toHaveText('5 am');
  await expect(page.locator('.fw-bcal__col[data-today] .fw-tgrid__now')).toHaveCount(1);
  await expect(page.locator('.fw-tgrid__now-tag')).toHaveText('5:50');
});

test('[D-82] a day with more all-day events than lanes says how many more; overlapping events sit side by side', async ({
  page,
}) => {
  await openCalendar(page, '?allday=1');
  // Today has four all-day events: three lanes, and "+1" on its head.
  const head = page.locator('.fw-tgrid__head[data-today]');
  await expect(head).toContainText('+1');
  await expect(head).toHaveAccessibleName(/, 1 more all-day$/);
  await head.click();
  // As a day, all four show.
  await expect(views(page).getByRole('button', { name: 'Day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.fw-tgrid__bar')).toHaveCount(4);
  // Tomorrow: the meeting and the orthodontist overlap, side by side.
  await page.getByRole('button', { name: 'Next day' }).click();
  const [meeting, ortho] = await Promise.all(
    ['Team meeting', 'Orthodontist'].map((t) =>
      page.locator('.fw-tgrid__event', { hasText: t }).boundingBox(),
    ),
  );
  expect(ortho!.x).toBeGreaterThanOrEqual(meeting!.x + meeting!.width - 1);
  expect(ortho!.y).toBeGreaterThan(meeting!.y);
  expect(ortho!.y).toBeLessThan(meeting!.y + meeting!.height);
});

test('[CAL-10][US-509] a tap on an event shows it in full: when, where, its calendar and whose it is', async ({
  page,
}) => {
  await openCalendar(page);
  await views(page).getByRole('button', { name: 'Day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.locator('.fw-tgrid__event', { hasText: 'Dentist' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dentist' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('dt')).toHaveText(['When', 'Where', 'Calendar', 'Whose', 'Note']);
  await expect(sheet.locator('dd')).toHaveText([
    /, 9:30 – 10:15 am$/,
    '12 Made-up Street',
    'Family',
    'Everyone',
    'Moved or changed on its own in Apple Calendar.',
  ]);
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // An event without a place has no Where; a person's calendar says whose.
  await page.locator('.fw-tgrid__event', { hasText: 'Team meeting' }).click();
  const meeting = page.getByRole('dialog', { name: 'Team meeting' });
  await expect(meeting.locator('dt')).toHaveText(['When', 'Calendar', 'Whose']);
  await expect(meeting.locator('dd').last()).toHaveText('Alex');
  await meeting.getByRole('button', { name: 'Close' }).click();
  await expect(meeting).toBeHidden();
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
  // Tomorrow: the dentist (moved in Apple Calendar) and Alex's meeting, each with its time.
  await expect(page.locator('.fw-bcal__event')).toHaveText([
    /^Dentist\s*9:30 – 10:15$/,
    /^Team meeting\s*2:00 – 3:00$/,
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
  // [WP-70] The month draws first from the board's own days, then from the whole month when its read
  // lands; the calendar is aria-busy till then. Read once it has finished drawing, the first day
  // with "+N more" stays that day (before WP-70 the test read it from the first draw).
  await expect(page.locator('.fw-bcal__month')).toBeVisible();
  await expect(page.locator('section.fw-bcal')).toHaveAttribute('aria-busy', 'false');
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
  await expect(page.locator('section.fw-bcal')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.fw-bcal__event, .fw-tgrid__bar')).toHaveCount(3 + more);
});

test('[CAL-06] a calendar that can’t sync says so; its last good events stay', async ({ page }) => {
  await openCalendar(page, '?calbehind=1');
  await expect(page.getByText('School hasn’t updated since', { exact: false })).toBeVisible();
  await expect(page.getByText('Showing its last good events.', { exact: false })).toBeVisible();
  await expect(page.locator('.fw-tgrid__bar', { hasText: 'Spelling test' })).toBeVisible();
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
  // [WP-70] Its read failed, so the calendar has finished drawing: it is not left busy.
  await expect(page.locator('section.fw-bcal')).toHaveAttribute('aria-busy', 'false');
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
