import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf } from '../support/fold';

// [PTS-08][D-147] The household points register (WP-115) on its /dev page: the demo family on Tuesday,
// Oct 27, 2026, made up, no database, its entries filtered as points_register() filters them. Every
// filter is a link or a GET form, so each step waits on the address and the rows it brings, after
// React has taken the page over (D-110). Rewards' Points card and payouts, and a child's Points, on
// their own /dev pages. In Chrome, as an iPhone and as Safari on a Mac (e2e/ui.config.ts).

const REGISTER = '/dev/rewards/points';
const ALL_DONE = 'f3000000-0000-4000-8000-000000000001';

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

const entries = (page: Page) => page.locator('li.fw-ledger');
const entry = (page: Page, what: string) => entries(page).filter({ hasText: what });

test('[PTS-08-l][US-1110] the register as drawn: every entry newest first under days, each with who, when, what, its type, who issued it and the amount', async ({
  page,
}) => {
  await open(page, REGISTER);
  await expect(page.getByRole('heading', { level: 1, name: 'Points register' })).toBeVisible();
  await expect(page.locator('.fw-register__total')).toHaveText(
    /^95 entries · \+\d+ · −\d+ · net \+\d+$/,
  );
  await expect(page.locator('.fw-dh').first()).toHaveText('Today · 5');
  await expect(page.locator('.fw-dh').nth(1)).toHaveText('Yesterday · 5');
  await expect(entries(page).first()).toContainText('Feed the dog');
  await expect(entries(page).first()).toContainText('Earned Leo · 6:58 pm · done');
  await expect(entries(page).first().locator('.fw-ledger__amt')).toHaveText('+5');
  await expect(entry(page, 'Movie night')).toContainText('Spent Maya · 6:40 pm · approved by Alex');
  await expect(entry(page, 'Movie night').locator('.fw-ledger__amt')).toHaveText('−100');
  await expect(entry(page, 'Helped carry the groceries')).toContainText(
    'By hand Maya · 4:15 pm · by Sam',
  );
  await expect(entry(page, '7 good days in a row')).toContainText(
    'Bonus Maya · 2:05 am · paid automatically',
  );
  await expect(entry(page, 'Reached Read 5 books')).toContainText(
    'Goal payout Maya · 7:31 pm · goal Read 5 books',
  );
  await expect(entry(page, 'Pick the dinner')).toContainText(
    'Refunded Leo · 5:20 pm · cancelled by Sam',
  );
  // [PTS-08-c] Sam's private item, which Alex may not see.
  await expect(entry(page, 'A private item')).toContainText('Earned Leo · 7:02 pm · done');
  // A bonus's name opens the register filtered to it.
  await expect(
    entry(page, '7 good days in a row').getByRole('link', { name: '7 good days in a row' }),
  ).toHaveAttribute('href', /\?rule=f3000000-0000-4000-8000-000000000002$/);
  // Nothing wider than the screen, and every word readable.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
});

test('[PTS-08-l] a child’s chip, a type, the dates and a bonus filter it; Clear and ✕ undo them', async ({
  page,
}) => {
  await open(page, REGISTER);
  await test.step('a child’s chip', async () => {
    await page.getByRole('button', { name: 'Maya' }).click();
    await expect(page).toHaveURL(/\?who=f1000000-0000-4000-8000-000000000001$/);
    await expect(page.getByRole('button', { name: 'Maya' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(entries(page).filter({ hasText: ' Leo · ' })).toHaveCount(0);
    await expect(entry(page, 'Movie night')).toBeVisible();
  });
  await test.step('a type, under More filters', async () => {
    await foldOf(page, 'More filters').locator(':scope > summary').click();
    await expect(foldOf(page, 'More filters')).toHaveAttribute('open', '');
    await page
      .getByRole('group', { name: 'Type' })
      .getByRole('button', { name: 'By hand' })
      .click();
    await expect(page).toHaveURL(/who=f1000000-0000-4000-8000-000000000001&type=adjustment/);
    await expect(foldOf(page, 'More filters')).toHaveAttribute('open', '');
    await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Spent' }).click();
    await expect(page).toHaveURL(/type=adjustment,spend/);
    await expect(page.locator('.fw-register__total')).toHaveText(
      '4 entries · +10 · −155 · net −145',
    );
    await expect(entries(page)).toHaveCount(4);
  });
  await test.step('the dates, in the household’s own days', async () => {
    await page.getByRole('textbox', { name: 'From', exact: true }).fill('2026-10-20');
    await page.getByRole('textbox', { name: 'To', exact: true }).fill('2026-10-27');
    await page.getByRole('button', { name: 'Show these days' }).click();
    await expect(page).toHaveURL(/from=2026-10-20&to=2026-10-27/);
    await expect(page.locator('.fw-register__total')).toHaveText(
      '3 entries · +10 · −140 · net −130',
    );
    await expect(foldOf(page, 'More filters').locator(':scope > summary')).toContainText(
      'By hand, Spent · Tue, Oct 20, 2026 to Tue, Oct 27, 2026',
    );
    await page.getByRole('link', { name: 'Any day' }).click();
    await expect(page).not.toHaveURL(/from=/);
    await expect(entries(page)).toHaveCount(4);
  });
  await test.step('Clear', async () => {
    await page.getByRole('group', { name: 'Type' }).getByRole('link', { name: 'Clear' }).click();
    await expect(page).not.toHaveURL(/type=/);
    await page.getByRole('group', { name: 'Whose' }).getByRole('link', { name: 'Clear' }).click();
    await expect(page).toHaveURL(new RegExp(`${REGISTER}$`));
    await expect(page.locator('.fw-register__total')).toContainText('95 entries');
  });
  await test.step('a bonus, and its ✕', async () => {
    await entry(page, 'Everything done')
      .first()
      .getByRole('link', { name: 'Everything done' })
      .click();
    await expect(page).toHaveURL(new RegExp(`\\?rule=${ALL_DONE}$`));
    await expect(page.locator('.fw-register__total')).toHaveText(
      /^Paid \d+ times · \+\d+ · Maya \d+ times, Leo \d+ · latest today$/,
    );
    await expect(entries(page).filter({ hasNotText: 'Everything done' })).toHaveCount(0);
    await page
      .getByRole('button', { name: /^Bonus: 5 points for each day with everything done/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${REGISTER}$`));
  });
});

test('[PTS-08-k] Show older adds the next 50 below, until the first entry', async ({ page }) => {
  await open(page, REGISTER);
  await expect(entries(page)).toHaveCount(50);
  await expect(page.getByText('Showing the newest 50 of 95.')).toBeVisible();
  const fiftieth = await entries(page).nth(49).getAttribute('id');
  await page.getByRole('link', { name: 'Show older' }).click();
  await expect(page).toHaveURL(/\?older=1#e-/);
  await expect(entries(page)).toHaveCount(95);
  // The 50 already seen stay where they were, with the next ones after them.
  await expect(entries(page).nth(49)).toHaveAttribute('id', fiftieth!);
  await expect(page.getByRole('link', { name: 'Show older' })).toHaveCount(0);
});

test('[PTS-08-m] Rewards’ Points card, each bonus’s payouts and a child’s Points open the register', async ({
  page,
}) => {
  await open(page, '/dev/rewards?bonus=archive');
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Points', exact: true }),
  });
  await expect(card.getByRole('list', { name: 'Balances' })).toContainText('Maya');
  await expect(card.getByRole('link', { name: 'Points register' })).toHaveAttribute(
    'href',
    '/admin/rewards/points',
  );
  const bonuses = page.getByRole('list', { name: 'Bonus points' });
  await expect(bonuses.locator('[data-bonus="b1"]')).toContainText('Paid once, today · See it');
  await expect(bonuses.locator('[data-bonus="b2"]')).toContainText(
    'Paid 14 times, latest yesterday · See them',
  );
  await expect(bonuses.getByRole('link', { name: /^See them:/ })).toHaveAttribute(
    'href',
    '/admin/rewards/points?rule=b2',
  );

  await open(page, '/dev/members?page=member&adjusted=5');
  await expect(page.getByRole('link', { name: 'All of Maya’s points' })).toHaveAttribute(
    'href',
    /^\/admin\/rewards\/points\?who=f2000000-0000-4000-8000-0000000000\d\d$/,
  );
});
