import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [PTS-03][PTS-04] The rewards shop for a parent (WP-18) on /dev/rewards: a made-up family, no
// database. The page's words, buttons and layout on a phone and a laptop, in Day and Evening. The same
// page runs signed in against the database in e2e/tests/rewards.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const theme of ['day', 'evening'] as const) {
    test(`[PTS-03][NFR-11] fits a phone in ${theme}: no sideways scroll, 44 px buttons, AA contrast`, async ({
      page,
    }) => {
      await page.goto(`/dev/rewards?theme=${theme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main button')]
          .filter((b) => b.getBoundingClientRect().height < 44)
          .map((b) => b.getAttribute('aria-label') ?? b.textContent),
      );
      expect(small).toEqual([]);
      await contrastOk(page);
    });
  }
});

test('[PTS-04][US-1105] what was asked for, oldest first, with each child’s balance: approve or not this time', async ({
  page,
}) => {
  await page.goto('/dev/rewards');
  const asked = page.getByRole('list', { name: 'Asked for' });
  await expect(asked.getByRole('listitem')).toHaveCount(2);
  await expect(asked.getByRole('listitem').first()).toContainText('Maya: Movie night');
  await expect(asked.getByRole('listitem').first()).toContainText('has 120 points');
  await expect(
    asked.getByRole('button', { name: 'Approve Pick the dinner for Leo' }),
  ).toBeVisible();
  await expect(
    asked.getByRole('button', { name: 'Not this time: Pick the dinner for Leo' }),
  ).toBeVisible();
});

test('[PTS-04][US-1105] approved rewards are to give: mark given, or cancel and refund', async ({
  page,
}) => {
  await page.goto('/dev/rewards');
  const give = page.getByRole('list', { name: 'To give' });
  await expect(
    give.getByRole('button', { name: 'Mark Ice cream trip given to Maya' }),
  ).toBeVisible();
  await expect(
    give.getByRole('button', { name: 'Cancel Ice cream trip for Maya and refund' }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Lately' })).toContainText('Given');
  await expect(page.getByRole('list', { name: 'Lately' })).toContainText('Not this time');
});

test('[PTS-03][US-1103] the shop: each reward’s cost, what is left, its limit; a photo or its icon; archived ones aside', async ({
  page,
}) => {
  await page.goto('/dev/rewards');
  const shop = page.getByRole('list', { name: 'The shop' });
  await expect(shop.getByRole('listitem')).toHaveCount(4);
  await expect(shop.getByRole('listitem').filter({ hasText: 'Pick the dinner' })).toContainText(
    '30 points · 1 left',
  );
  await expect(shop.getByRole('listitem').filter({ hasText: 'Ice cream trip' })).toContainText(
    'once a week',
  );
  await expect(shop.getByRole('listitem').filter({ hasText: 'Stay up late' })).toContainText(
    'not in the shop now',
  );
  await expect(shop.locator('img')).toHaveCount(1);
  await expect(page.getByText('Archived (1)', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a reward' })).toHaveAttribute(
    'href',
    '/admin/rewards/new',
  );
});

test('[PTS-06] the shop says who is saving for what', async ({ page }) => {
  await page.goto('/dev/rewards');
  const shop = page.getByRole('list', { name: 'The shop' });
  await expect(shop.getByRole('listitem').filter({ hasText: 'Movie night' })).toContainText(
    'Maya is saving for it',
  );
  await expect(shop.getByText(/saving for it/)).toHaveCount(1);
});

test('[PTS-05][US-1107] bonus points: each rule in words, from when it counts, on or off; archived ones aside', async ({
  page,
}) => {
  await page.goto('/dev/rewards');
  const rules = page.getByRole('list', { name: 'Bonus points' });
  await expect(rules.getByRole('listitem')).toHaveCount(2);
  const streak = rules
    .getByRole('listitem')
    .filter({ hasText: '20 points for 7 good days in a row' });
  await expect(streak).toContainText('counts from Thu, Oct 1');
  await expect(
    streak.getByRole('button', { name: 'Turn off: 20 points for 7 good days in a row' }),
  ).toBeVisible();
  await expect(
    streak.getByRole('button', { name: 'Archive: 20 points for 7 good days in a row' }),
  ).toBeVisible();
  const perfect = rules
    .getByRole('listitem')
    .filter({ hasText: '5 points for each day with everything done' });
  await expect(perfect).toContainText('counts from Mon, Oct 5 · off');
  await expect(
    perfect.getByRole('button', { name: 'Turn on: 5 points for each day with everything done' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay bonuses now' })).toBeVisible();
  await page.getByText('Archived bonuses (1)').click();
  await expect(page.getByRole('list', { name: 'Archived bonuses' })).toContainText(
    '2 points for 3 good days in a row',
  );
});

test('[PTS-05] adding a bonus: a streak asks how long; a perfect day doesn’t', async ({ page }) => {
  await page.goto('/dev/rewards');
  await page.getByText('Add a bonus', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Add a bonus' });
  await expect(form.getByRole('radio', { name: 'A streak' })).toBeChecked();
  await expect(form.getByLabel('Good days in a row')).toHaveValue('7');
  await expect(form.getByLabel('Bonus points')).toHaveValue('20');
  await expect(form.getByLabel('Counts from')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await form.getByRole('radio', { name: 'A perfect day' }).check();
  await expect(form.getByLabel('Good days in a row')).toHaveCount(0);
  await expect(form.getByLabel('Bonus points')).toHaveValue('5');
  await expect(form).toContainText('Each day with everything on the list done.');
  await expect(form.getByRole('button', { name: 'Add bonus' })).toBeVisible();
});
