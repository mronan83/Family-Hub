import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-21][US-716] Staples by how often they run out (WP-106, D-138 (7), D-150), on the made-up demo
// family on Sun, Oct 18, no database: Groceries' Running low? (Butter, Trash bags and Cereal due,
// with Add and Not now), after Add (Butter on the list as a staple, with Undo) and after Not now;
// Staples (learned, still learning, not suggested); nothing due; and Home's "3 running low ·
// Review". On a phone and a laptop, Day and Evening; in Chrome, as an iPhone in WebKit and as Safari
// on a Mac (e2e/ui.config.ts). Adding for real runs against the database in e2e/tests/staples.spec.ts.

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Nothing wider than the screen, and a fold's buttons 44 px tall at least. */
async function fits(page: Page, fold: string) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page
    .locator(fold)
    .evaluate((c) =>
      [...c.querySelectorAll('button, summary')]
        .filter((b) => b.getBoundingClientRect().height < 44)
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    );
  expect(small).toEqual([]);
}

const low = (page: Page) => page.locator('#low');
const staples = (page: Page) => page.locator('#staples');

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`staples on ${device}`, () => {
    test.use({ viewport: { width, height } });

    for (const theme of ['day', 'evening'] as const) {
      test(`[MEAL-21-g][US-716] Running low? with Add and Not now, under Asked for, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/groceries?theme=${theme}`);
        await expect(low(page).getByRole('heading', { name: /Running low\?/ })).toBeVisible();
        const rows = low(page).getByRole('list', { name: 'Running low' }).getByRole('listitem');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('Butter · Kirkland');
        await expect(rows.nth(0)).toContainText(
          'Usually every 9 days · last got Fri, Oct 9 · Costco',
        );
        await expect(rows.nth(1)).toContainText('Trash bags · Kirkland Signature');
        await expect(rows.nth(2)).toContainText('Cereal');
        await expect(rows.nth(2)).toContainText(
          'Usually every week · last got Mon, Oct 12 · Kroger',
        );
        await expect(
          rows.nth(0).getByRole('button', { name: 'Add Butter to the list' }),
        ).toBeVisible();
        await expect(rows.nth(0).getByRole('button', { name: 'Not now: Butter' })).toBeVisible();
        await expect(low(page)).toContainText('Nothing is added by itself.');
        // Right after Asked for, before the list.
        const order = await page.evaluate(() =>
          [...document.querySelectorAll('main > section')].map((s) => s.id).filter(Boolean),
        );
        expect(order.indexOf('low')).toBe(order.indexOf('asked') + 1);
        await fits(page, '#low');
        await contrastOk(page);
      });

      test(`[MEAL-21-g] Staples: learned, still learning, not suggested, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/groceries?theme=${theme}`);
        await expect(staples(page)).toContainText('8 learned · 3 still learning · 1 not suggested');
        await open(page, `/dev/groceries?theme=${theme}&open=staples`);
        const learned = staples(page).getByRole('list', { name: 'Learned' }).getByRole('listitem');
        await expect(learned).toHaveCount(8);
        await expect(learned.filter({ hasText: 'Butter' })).toContainText(
          'Every 9 days · Running low',
        );
        await expect(learned.filter({ hasText: 'Coffee' })).toContainText(
          'Every 2 weeks · Due Oct 29',
        );
        await expect(learned.filter({ hasText: 'Milk' })).toContainText(
          'Every 5 days · On the list',
        );
        await expect(
          learned.filter({ hasText: 'Milk' }).getByRole('button', { name: 'Don’t suggest: Milk' }),
        ).toBeVisible();
        await expect(staples(page)).toContainText(
          'Strawberries (no steady gap), Tortillas (3 buys), Cheddar (2 buys)',
        );
        const off = staples(page)
          .getByRole('list', { name: 'Not suggested' })
          .getByRole('listitem');
        await expect(off).toContainText('Birthday candles');
        await expect(off).toContainText('You chose Don’t suggest on Sep 12');
        await expect(
          off.getByRole('button', { name: 'Suggest again: Birthday candles' }),
        ).toBeVisible();
        await fits(page, '#staples');
        await contrastOk(page);
      });

      test(`[MEAL-21-g] after Add and after Not now, in ${theme}`, async ({ page }) => {
        await open(page, `/dev/groceries?theme=${theme}&staple=added`);
        const banner = page.getByRole('status').filter({ hasText: 'Added Butter' });
        await expect(banner).toContainText('Added Butter · Kirkland to Dairy & Eggs, at Costco.');
        await expect(
          banner.getByRole('button', { name: 'Undo: take Butter off the list' }),
        ).toBeVisible();
        await expect(
          low(page).getByRole('list', { name: 'Running low' }).getByRole('listitem'),
        ).toHaveCount(2);
        await expect(page.locator('.fw-groc__list')).toContainText('Butter · Kirkland');
        await open(
          page,
          `/dev/groceries?theme=${theme}&did=staple-not-now&name=Butter&until=2026-10-27`,
        );
        await expect(page.getByText('Butter won’t be suggested until Oct 27.')).toBeVisible();
        await contrastOk(page);
      });

      test(`[MEAL-21-g] nothing due folds Running low? to Nothing due, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/groceries?theme=${theme}&state=empty`);
        await expect(low(page)).toContainText('Nothing due');
        await expect(low(page).locator('details')).not.toHaveAttribute('open', '');
        await expect(staples(page)).toContainText('0 learned · 0 still learning');
      });

      test(`[MEAL-21-g] Home’s Groceries card says 3 running low, with Review, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/home?theme=${theme}`);
        const card = page.locator('.fw-quick__card--wide');
        await expect(card).toContainText('3 running low · Review');
        await expect(card.getByRole('link', { name: 'Review' })).toHaveAttribute(
          'href',
          '/admin/groceries?open=low#low',
        );
        await open(page, `/dev/home?theme=${theme}&groceries=empty`);
        await expect(page.locator('.fw-quick__card--wide')).not.toContainText('running low');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      });
    }
  });
}
