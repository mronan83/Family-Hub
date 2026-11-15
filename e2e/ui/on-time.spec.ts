import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './test';
import { foldOf } from '../support/fold';

// [CHR-24][D-151] Mark done on time (WP-117) on its /dev pages, as the approved mockup draws it: Today
// three days back with a missed chore and one ticked late, Done on time… open, a settled week's
// confirm, and the page after with its trace; Maya's page with Missed or late; a goal's missed day
// opened; and the points register's trace. Made up, no database. In Chrome, as an iPhone and as
// Safari on a Mac (e2e/ui.config.ts), in Day and Evening.

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

/** Nothing wider than the screen, and every word readable. */
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

const row = (page: Page, title: string) =>
  page.locator('li.fw-day__row').filter({ hasText: title });

for (const theme of ['day', 'evening'] as const) {
  test(`[CHR-24-k][US-326] Today on a past day: Done on time… on the missed and the late chore, open as drawn (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/admin?ontime=open&theme=${theme}`);
    const missed = row(page, 'Homework folder home');
    await expect(missed).toContainText('Maya: missed');
    await expect(
      missed.getByRole('button', { name: 'Mark Homework folder home (Maya) done' }),
    ).toBeVisible();
    const panel = missed.locator('details.fw-ontime');
    await expect(panel).toHaveAttribute('open', '');
    await expect(
      panel.getByRole('group', { name: /When was Homework folder home done on \w+day, \w+ \d+\?/ }),
    ).toBeVisible();
    await expect(panel.getByRole('radio', { name: /On time/ })).toBeChecked();
    await expect(panel.getByText('By its time, 3:30 pm. Counts for every goal.')).toBeVisible();
    await expect(panel.getByLabel('The time Homework folder home was done')).toHaveValue('15:30');
    await expect(panel.getByLabel('The time Homework folder home was done')).toHaveAttribute(
      'max',
      '15:30',
    );
    await expect(panel).toContainText('Counts for Homework home every school day.');
    await expect(
      panel.getByRole('button', { name: 'Mark Homework folder home done on time' }),
    ).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      /\/admin\/today\?date=\d{4}-\d{2}-\d{2}$/,
    );
    // Ticked at 8:10 pm, after 3:30 pm: late, with Done on time… folded beside Uncheck.
    const late = row(page, 'Reading, 20 minutes');
    await expect(late).toContainText('Leo: done late · ticked 8:10 pm, after 3:30 pm');
    await expect(late.locator('details.fw-ontime')).not.toHaveAttribute('open', '');
    await late.locator('details.fw-ontime > summary').click();
    await expect(late.getByRole('radio', { name: /On time/ })).toBeVisible();
    // Done on time is not on a chore done on time.
    await expect(row(page, 'Piano practice').locator('details.fw-ontime')).toHaveCount(0);
    await fits(page);
  });

  test(`[CHR-24-k][CHR-24-h] a settled week asks first, saying what it pays (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/admin?ontime=confirm&theme=${theme}`);
    const panel = row(page, 'Homework folder home').locator('details.fw-ontime');
    await expect(panel).toHaveAttribute('open', '');
    await expect(panel.getByRole('status')).toHaveText(
      /^This makes Maya’s week of \w+ \d+ a win: 10 points\. It’s paid once\.$/,
    );
    await expect(
      panel.getByRole('button', { name: 'Mark Homework folder home done on time' }),
    ).toHaveText('Mark on time and pay 10 points');
    await fits(page);
  });

  test(`[CHR-24-k][CHR-24-g] after it: the notice, done, and "Marked on time by Alex" (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/admin?ontime=after&theme=${theme}`);
    await expect(
      page.getByText('Marked Homework folder home done on time. It counts for Maya’s goals.'),
    ).toBeVisible();
    const marked = row(page, 'Homework folder home');
    await expect(marked).toContainText('Maya: done');
    await expect(marked.locator('.fw-ontime__trace')).toHaveText(
      /^Marked on time by Alex, \w+ \d+$/,
    );
    await expect(
      marked.getByRole('button', { name: 'Uncheck Homework folder home (Maya)' }),
    ).toBeVisible();
    await expect(marked.locator('details.fw-ontime')).toHaveCount(0);
    await fits(page);
  });

  test(`[CHR-24-k][CHR-24-j] Maya’s page: Missed or late, the last 14 days (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/members?page=member&late=open&theme=${theme}`);
    const fold = foldOf(page, 'Missed or late');
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator(':scope > summary')).toContainText('2 to look at');
    const rows = fold.locator('li.fw-day__row');
    // The fold's own rows, not a panel's (a panel is a <details> inside a row).
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Homework folder home');
    await expect(rows.nth(0)).toContainText('Tue, Oct 13 · 3:30 pm');
    await expect(rows.nth(0)).toContainText('Missed');
    await expect(rows.nth(0).locator('details.fw-ontime')).toHaveAttribute('open', '');
    await expect(rows.nth(1)).toContainText('Done late · ticked 6:05 pm, after 4:30 pm');
    await expect(rows.nth(2).locator('.fw-ontime__trace')).toHaveText(
      'Marked on time (3:45 pm) by Sam, Oct 8',
    );
    await expect(rows.nth(2).locator('details.fw-ontime')).toHaveCount(0);
    // Its own form: the request id and the way back.
    const form = rows.nth(0).locator('form.fw-ontime__body');
    await expect(form.locator('input[name="request"]')).toHaveCount(1);
    await expect(form.locator('input[name="return"]')).toHaveValue(
      /\/admin\/members\/.+\?open=late$/,
    );
    await fits(page);
  });

  test(`[CHR-24-k] a goal’s missed day opens, with Done on time… (${theme})`, async ({ page }) => {
    await open(page, `/dev/goals?day=open&theme=${theme}`);
    const goal = page.getByRole('listitem', { name: 'Homework home every school day' });
    const wednesday = goal.getByRole('link', { name: 'Wed: missed. Open the day' });
    await expect(wednesday).toHaveAttribute('aria-current', 'true');
    await expect(wednesday).toHaveAttribute('href', '/admin/goals?day=g8:2026-10-14');
    // A done day and today are not links.
    await expect(goal.getByRole('link', { name: /^Mon: / })).toHaveCount(0);
    const day = page.getByRole('region', { name: 'Wednesday, Oct 14' });
    await expect(day).toContainText('Homework folder home');
    await expect(day).toContainText('Missed');
    await expect(day.locator('details.fw-ontime')).toHaveAttribute('open', '');
    await expect(day.getByRole('link', { name: 'Open the day' })).toHaveAttribute(
      'href',
      '/admin/today?date=2026-10-14',
    );
    await fits(page);
  });

  test(`[CHR-24-k][CHR-24-g] a goal’s day after it: done, with "Marked on time by Alex" (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/goals?day=after&theme=${theme}`);
    const goal = page.getByRole('listitem', { name: 'Homework home every school day' });
    await expect(goal.getByRole('link', { name: 'Wed: done. Open the day' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const day = page.getByRole('region', { name: 'Wednesday, Oct 14' });
    await expect(day).toContainText('Done');
    await expect(day.locator('.fw-ontime__trace')).toHaveText('Marked on time by Alex, Oct 15');
    await expect(day.locator('details.fw-ontime')).toHaveCount(0);
    await fits(page);
  });

  test(`[CHR-24-k][CHR-24-g] the points register says who marked an earn on time (${theme})`, async ({
    page,
  }) => {
    await open(page, `/dev/rewards/points?ontime=1&theme=${theme}`);
    const first = page.locator('li.fw-ledger').first();
    await expect(first).toContainText('Feed the dog');
    await expect(first.locator('.fw-ontime__trace')).toHaveText('Marked on time by Alex, Oct 27');
    await fits(page);
  });
}
