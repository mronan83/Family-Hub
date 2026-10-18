import { appendFileSync } from 'node:fs';
import { expect, test } from '../support/test';
import { addDays, householdToday, weekday } from '../support/day';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-12][US-709][D-98] The lunch picks one tap from Home, on the preview (WP-73). The done-when:
// Alex taps **Pick lunches** on Home and lands on the lunch week, this week Monday to Friday and the
// coming week on Saturday and Sunday (by the household's today, read once from the database), on the
// child they chose last. The server's clock can't be set from a test, so the week for each day of the
// week is proved by the unit tests on lunchWeekToOpen() (D-113); this spec checks the day it runs on,
// and the nightly run covers weekdays and weekends in turn. It changes nothing in the database: the
// child chosen last is kept in this page's own storage.
const family = ownHousehold('lunch-quick');
const db = process.env.SUPABASE_DB_URL;

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

test('[MEAL-12][US-709][NFR-14-f] done-when: Pick lunches on Home opens the lunch week to pick, on the child chosen last', async ({
  browser,
}) => {
  // Signing in on a cold preview can take most of 30 s, as in lunch-week.spec.ts.
  test.setTimeout(120_000);
  const today = householdToday(db!);
  const dow = weekday(today); // 0 Sunday … 6 Saturday
  const weekend = dow === 0 || dow === 6;
  const monday = addDays(today, weekend ? (dow === 6 ? 2 : 1) : 1 - dow);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await signIn(page, 'Alex');
    const pick = async () => {
      await page.goto('/admin');
      const card = page
        .getByRole('list', { name: 'More quick actions' })
        .getByRole('listitem')
        .filter({ hasText: 'School lunches' });
      await expect(card).toContainText(weekend ? 'Next week:' : 'This week:');
      await card.getByRole('link', { name: 'Pick lunches' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/meals\\?week=${monday}#lunch$`));
    };
    const whose = page.getByRole('group', { name: 'Whose lunches' });

    await test.step(`[MEAL-12] ${weekend ? 'a weekend: the coming week' : 'a weekday: this week'}, Monday ${monday}`, async () => {
      await pick();
      // The shown child's lunch week only: the planner's days above it are .fw-lunchday too (WP-75).
      const days = page.getByRole('list', { name: /’s lunch week$/ }).locator('.fw-lunchday');
      await expect(days.first()).toHaveAttribute('data-date', monday);
      await expect(days.last()).toHaveAttribute('data-date', addDays(monday, 4));
    });

    await test.step('[MEAL-12] Leo chosen, then Home again: it opens on Leo', async () => {
      await whose.getByRole('button', { name: /^Leo/ }).click();
      await expect(page.getByRole('list', { name: 'Leo’s lunch week' })).toBeVisible();
      await pick();
      await expect(whose.getByRole('button', { name: /^Leo/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('list', { name: 'Leo’s lunch week' })).toBeVisible();
    });

    await test.step('[MEAL-12] Maya chosen: Home opens on Maya', async () => {
      await whose.getByRole('button', { name: /^Maya/ }).click();
      await expect(page.getByRole('list', { name: 'Maya’s lunch week' })).toBeVisible();
      await pick();
      await expect(page.getByRole('list', { name: 'Maya’s lunch week' })).toBeVisible();
    });
    report(`MEAL-12 Pick lunches on ${weekend ? 'a weekend' : 'a weekday'}: week of ${monday}`);
  } finally {
    await page.close();
  }
});
