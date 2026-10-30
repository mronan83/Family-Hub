import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { floors } from '../support/floors';

// [MEAL-18][MEAL-23][US-714] Groceries on the board (WP-104, D-138) on /dev/board, at the board's
// 1920×1080: Groceries in the rail once the household has had an item; the list by category, A to Z,
// each thing with its picture, amount, and why for a meal or a child's ask; store chips that change
// only what the board shows; an emptied list says so. The made-up list is fixtureGroceries, the same
// as /dev/groceries's. Since WP-107 each thing is a button that opens its sheet (ticking off and
// taking off: board-grocery-asks.spec.ts).
test.use({ viewport: { width: 1920, height: 1080 } });

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const screen = (page: Page) => page.getByRole('region', { name: /^Groceries/ });

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
const fit = (page: Page) => page.evaluate(floors, { buttons: '.fw-board', text: '.fw-today' });

async function openGroceries(page: Page, query: string) {
  await page.goto(`/dev/board?${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await people(page).getByRole('button', { name: 'Groceries' }).click();
  await expect(screen(page)).toBeVisible();
}

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-18-e] the list by category, A to Z, with pictures, amounts and why, in ${theme}`, async ({
    page,
  }) => {
    await openGroceries(page, `groceries=1&theme=${theme}`);
    await expect(screen(page)).toContainText('19 to get');
    // The categories, then (WP-107) the Asked for and Got today cards beside them.
    await expect(screen(page).getByRole('heading', { level: 3 })).toHaveText([
      /^Produce/,
      /^Dairy & Eggs/,
      /^Bakery/,
      /^Meat & Seafood/,
      /^Pantry/,
      /^Household/,
      'Asked for',
      'Got today',
    ]);
    const produce = screen(page).getByRole('region', { name: /^Produce/ });
    await expect(produce.locator('.fw-bgroc__nm')).toHaveText([
      'Apples ×6',
      'Avocados ×2',
      'Baby spinach',
      'Bananas',
      'Lettuce',
      'Onions ×3',
    ]);
    await expect(produce.getByRole('listitem').filter({ hasText: 'Onions' })).toContainText(
      'For Tacos, Chili',
    );
    await expect(produce.getByRole('listitem').filter({ hasText: 'Apples' })).toContainText(
      'Leo asked',
    );
    // A picture where one fits: apples and bananas their own, spinach the salad's.
    await expect(produce.locator('.fw-bgroc__it > [data-icon]')).toHaveCount(6);
    await expect(
      produce
        .getByRole('listitem')
        .filter({ hasText: 'Apples' })
        .locator('.fw-bgroc__it > [data-icon="apple"]'),
    ).toHaveCount(1);
    // [MEAL-30] Each thing opens its sheet (WP-107); the list itself changes nothing, no checkbox.
    await expect(produce.getByRole('button', { name: /got it or take it off$/ })).toHaveCount(6);
    await expect(screen(page).getByRole('checkbox')).toHaveCount(0);
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    // The rail and the family still fit beside it, without scrolling.
    expect(
      await page.evaluate(() => {
        const r = document.querySelector('.fw-today__people')!;
        return r.scrollHeight <= r.clientHeight;
      }),
    ).toBe(true);
    await contrastOk(page);
  });
}

test('[MEAL-18-e] store chips change only what the board shows', async ({ page }) => {
  await openGroceries(page, 'groceries=1');
  const chips = screen(page).getByRole('group', { name: 'Stores' });
  await expect(chips.getByRole('button')).toHaveText([
    'All 19',
    'Costco 3',
    'Kroger 3',
    'Aldi 3',
    'Walmart 1',
    'Any store 9',
  ]);
  await chips.getByRole('button', { name: 'Kroger 3' }).click();
  await expect(chips.getByRole('button', { name: 'Kroger 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(screen(page).locator('.fw-bgroc__nm')).toHaveText([
    'Cheddar',
    'Tortillas · Mission ×8',
    'Ground beef 2 lb',
  ]);
  await chips.getByRole('button', { name: 'All 19' }).click();
  await expect(screen(page).locator('.fw-bgroc__nm')).toHaveCount(19);
});

test('[MEAL-18-e] an emptied list says so; a household with none has no Groceries in the rail', async ({
  page,
}) => {
  await openGroceries(page, 'groceries=empty');
  await expect(screen(page)).toContainText('Nothing to get');
  await expect(
    screen(page).getByRole('heading', { name: 'Nothing on the list right now' }),
  ).toBeVisible();
  expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
  await contrastOk(page);
  await page.goto('/dev/board');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(people(page).getByRole('button', { name: 'Meals' })).toBeVisible();
  await expect(people(page).getByRole('button', { name: 'Groceries' })).toHaveCount(0);
});

test('[MEAL-29-k] each thing shows its brand after its name, softer', async ({ page }) => {
  await openGroceries(page, 'groceries=1');
  const dairy = screen(page).getByRole('region', { name: /^Dairy & Eggs/ });
  await expect(dairy.locator('.fw-bgroc__nm')).toHaveText([
    'Cheddar',
    'Eggs 1 dozen',
    'Greek yogurt · Chobani',
    'Milk · Kirkland ×2',
  ]);
  expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
  await contrastOk(page);
});
