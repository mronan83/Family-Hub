import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-22][MEAL-30][US-717][US-723] The children's asks in the admin app (WP-107, D-149), on the made-up
// demo family, no database: Groceries' Asked for (Maya's popcorn and Leo's orange juice wait, with
// Add it, Not this time and Add all), each child's "Wait for a grown-up's OK" at its foot, Got
// recently saying who got a thing at the board, and Home's Needs you line. On a phone and a laptop,
// Day and Evening; in Chrome, as an iPhone in WebKit and as Safari on a Mac (e2e/ui.config.ts). Adding
// for real runs signed in against the database in e2e/tests/board-grocery-asks.spec.ts.

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

/** Nothing wider than the screen, and Asked for's buttons 44 px tall at least. */
async function fits(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await asked(page).evaluate((c) =>
    [...c.querySelectorAll('button, summary')]
      .filter((b) => b.getBoundingClientRect().height < 44)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent),
  );
  expect(small).toEqual([]);
}

const asked = (page: Page) => page.locator('#asked');

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`grocery asks on ${device}`, () => {
    test.use({ viewport: { width, height } });

    for (const theme of ['day', 'evening'] as const) {
      test(`[MEAL-22-i] Asked for with Add it, Not this time, Add all and each child’s OK, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/groceries?theme=${theme}`);
        await expect(asked(page).getByRole('heading', { name: 'Asked for' })).toBeVisible();
        await expect(asked(page)).toContainText('2 waiting');
        const asks = asked(page).getByRole('list', { name: 'Asks waiting' }).getByRole('listitem');
        await expect(asks).toHaveCount(2);
        await expect(asks.nth(0)).toContainText('Popcorn');
        await expect(asks.nth(0)).toContainText('Maya asked at the Kitchen board');
        await expect(asks.nth(1)).toContainText('Orange juice · Kirkland');
        await expect(
          asks.nth(0).getByRole('button', { name: 'Add Popcorn to the list' }),
        ).toBeVisible();
        await expect(
          asks.nth(1).getByRole('button', { name: 'Not this time: Orange juice, Leo’s ask' }),
        ).toBeVisible();
        await expect(asked(page).getByRole('button', { name: 'Add all' })).toBeVisible();
        // Asked for comes before the list.
        const before = await page.evaluate(() => {
          const a = document.querySelector('#asked')!;
          const l = document.querySelector('#list-heading')!;
          return !!(a.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(before).toBe(true);
        const oks = asked(page).getByRole('group', { name: 'Wait for a grown-up’s OK' });
        await expect(oks.getByRole('switch')).toHaveCount(2);
        await expect(
          oks.getByRole('switch', { name: 'Maya’s asks wait for a grown-up’s OK' }),
        ).toHaveAttribute('aria-checked', 'true');
        await fits(page);
        await contrastOk(page);
      });
    }

    test('[MEAL-22-i] Home’s Needs you counts the grocery asks and opens Asked for', async ({
      page,
    }) => {
      await open(page, '/dev/home?asks=1');
      const needs = page.getByRole('list', { name: 'Needs you' });
      const line = needs.getByRole('listitem').filter({ hasText: '2 grocery asks wait for you' });
      await expect(line).toHaveCount(1);
      await expect(line.getByRole('link', { name: /Review/ })).toHaveAttribute(
        'href',
        '/admin/groceries#asked',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await contrastOk(page);
    });

    test('[MEAL-30-c] Got recently says who got a thing at the board', async ({ page }) => {
      await open(page, '/dev/groceries?open=got');
      const got = page.getByRole('list', { name: 'Got recently' });
      await expect(got.getByRole('listitem').filter({ hasText: 'Coffee' })).toContainText(
        'by Sam at the Kitchen board',
      );
    });
  });
}
