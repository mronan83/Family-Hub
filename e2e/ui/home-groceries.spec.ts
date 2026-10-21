import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-27][MEAL-28][US-721] Home's Groceries card (WP-112, D-142) on /dev/home: the made-up demo
// family, no database; 8 on the list (Onions ×3 among them), Ground beef had before at Kroger, Costco
// preferred. First among the cards; Groceries' own field (two lines on a phone, one on a laptop, two
// columns wide there); the line under it as an item is typed; after Add; an empty list. It runs in
// Chrome, as an iPhone in WebKit and as Safari on a Mac (e2e/ui.config.ts). Adding for real runs
// signed in against the database in e2e/tests/home-groceries.spec.ts. Taps wait for React (D-110).

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

/** Nothing wider than the screen, and the card's buttons, links and field 44 px tall at least. */
async function fits(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await card(page).evaluate((c) =>
    [...c.querySelectorAll('button, a.fw-btn, textarea')]
      .filter((b) => b.getBoundingClientRect().height < 44)
      .map((b) => b.textContent || b.getAttribute('name')),
  );
  expect(small).toEqual([]);
}

const cards = (page: Page) => page.getByRole('list', { name: 'More quick actions' });
const card = (page: Page) => cards(page).getByRole('listitem').filter({ hasText: 'Groceries' });
const field = (page: Page) => card(page).getByRole('textbox', { name: 'Add an item' });
const line = (page: Page) => card(page).getByRole('status');

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`Home’s Groceries card on ${device}`, () => {
    test.use({ viewport: { width, height } });

    for (const theme of ['day', 'evening'] as const) {
      test(`[MEAL-27-c][US-721] first among the cards, with the count, the field and both links, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/home?theme=${theme}`);
        const names = cards(page).locator(':scope > li .fw-quick__name');
        await expect(names.nth(0)).toHaveText('Groceries');
        await expect(names.nth(1)).toHaveText('Add a meal');
        await expect(card(page)).toContainText('8 on the list');
        await expect(field(page)).toHaveAttribute(
          'placeholder',
          'Add an item, like 2 lb ground beef',
        );
        await expect(card(page).getByRole('link', { name: 'Open the list' })).toHaveAttribute(
          'href',
          '/admin/groceries',
        );
        await expect(card(page).getByRole('link', { name: 'This week’s meals' })).toHaveAttribute(
          'href',
          '/admin/meals?groceries=1',
        );
        // Nothing typed: no line under the field.
        await expect(line(page)).toBeHidden();
        const f = (await field(page).boundingBox())!;
        const meal = (await cards(page).getByRole('listitem').nth(1).boundingBox())!;
        const mine = (await card(page).boundingBox())!;
        if (width < 600) {
          // Two lines on a phone, so the hint shows in full; the card as wide as the others.
          expect(f.height, 'the field’s height on a phone').toBeGreaterThanOrEqual(56);
          expect(Math.abs(mine.width - meal.width)).toBeLessThan(2);
        } else {
          // One line on a laptop, the card two columns of the cards wide.
          expect(f.height, 'the field’s height on a laptop').toBeLessThan(50);
          expect(mine.width, 'the card spans two columns').toBeGreaterThan(meal.width * 1.8);
        }
        await fits(page);
        await contrastOk(page);
      });
    }

    test('[MEAL-27-c] as an item is typed, the line says where it goes, or that it is on the list already', async ({
      page,
    }) => {
      await open(page, '/dev/home');
      await field(page).fill('2 lb ground beef');
      await expect(line(page)).toHaveText('Meat & Seafood · Kroger, where it went last time');
      await field(page).fill('olive oil');
      await expect(line(page)).toHaveText('Pantry · Costco, your preferred store');
      await field(page).fill('1 onion');
      await expect(line(page)).toHaveText('Onions ×3 are on the list already. Adding makes ×4.');
      await field(page).fill('');
      await expect(line(page)).toBeHidden();
      await fits(page);
    });

    for (const theme of ['day', 'evening'] as const) {
      test(`[MEAL-27-c] after Add: what was added and where, with Change, and the count up, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/home?groceries=added&theme=${theme}`);
        await expect(card(page)).toContainText('9 on the list');
        await expect(line(page)).toHaveText('Added Ground beef 2 lb to Meat & Seafood. Change');
        await expect(line(page).getByRole('link', { name: 'Change' })).toHaveAttribute(
          'href',
          /^\/admin\/groceries\?item=[0-9a-f-]{36}#item-[0-9a-f-]{36}$/,
        );
        await expect(field(page)).toHaveValue('');
        await fits(page);
        await contrastOk(page);
      });

      test(`[MEAL-27-c] with nothing on the list the card still shows, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/home?groceries=empty&theme=${theme}`);
        await expect(card(page)).toContainText('Nothing on the list');
        await expect(field(page)).toBeVisible();
        await fits(page);
        await contrastOk(page);
      });
    }
  });
}

test.describe('with no service worker', () => {
  // A page the service worker controls sends its fetches through it, and WebKit then doesn't route
  // them to the test: the add went to the dev page's server, which answered it, whenever the worker
  // took control before Enter (WP-113, from the iPhone's trace; as Groceries' ⋯ test, WP-104).
  test.use({ serviceWorkers: 'block' });

  test('[MEAL-27-d] Enter adds from Home’s field and never makes a new line', async ({ page }) => {
    await open(page, '/dev/home');
    // The dev page has no database: hold the add itself (never answered), and see that Enter sent it.
    await page.route('**/dev/home**', (route) =>
      route.request().method() === 'POST' ? undefined : route.continue(),
    );
    await field(page).fill('olive oil');
    const sent = page.waitForRequest((r) => r.method() === 'POST');
    await field(page).press('Enter');
    const body = (await sent).postData() ?? '';
    expect(body).toContain('olive oil');
    await expect(field(page)).toHaveValue('olive oil');
    await expect(card(page).getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});

test('[MEAL-27-d] a line break pasted into Home’s field is a space', async ({ page }) => {
  await open(page, '/dev/home');
  await field(page).fill('olive\noil');
  await expect(field(page)).toHaveValue('olive oil');
});

test('[MEAL-27-d] Change opens the item’s ⋯ on Groceries', async ({ page }) => {
  await open(page, '/dev/groceries');
  const id = await page
    .getByRole('button', { name: 'Got Onions' })
    .evaluate((b) => b.closest('li')!.id.replace('item-', ''));
  await open(page, `/dev/groceries?item=${id}#item-${id}`);
  const row = page.locator(`#item-${id}`);
  await expect(row.locator('details.fw-groc__more')).toHaveAttribute('open', '');
  await expect(row.getByRole('link', { name: /Move to…/ })).toBeVisible();
  await expect(row.getByRole('link', { name: /Store…/ })).toBeVisible();
});
