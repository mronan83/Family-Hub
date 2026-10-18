import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { floors } from '../support/floors';

// [MEAL-26][US-720] A meal's recipe on the board (WP-105, D-138 (6), Q22) on /dev/board, at the board's
// 1920×1080: on Meals, a meal with a recipe is a button; a tap opens it full screen, read-only: its
// photos and PDFs with chips between them, its ingredients and the steps its link publishes, text 28
// px or more; Close or Escape goes back. The made-up recipes are fixtureRecipes.
test.use({ viewport: { width: 1920, height: 1080 } });

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
const fit = (page: Page) => page.evaluate(floors, { buttons: '.fw-board', text: '.fw-today' });

async function meals(page: Page, theme: string) {
  await page.goto(`/dev/board?theme=${theme}`);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await page
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Meals' })
    .click();
  await expect(page.getByRole('heading', { name: /^Meals this week/ })).toBeVisible();
}

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-26-a] a tap on a meal opens its recipe full screen, read-only, and Close goes back, in ${theme}`, async ({
    page,
  }) => {
    await meals(page, theme);
    const table = page.getByRole('table');
    // Only a meal with a recipe opens one.
    await expect(table.getByRole('button', { name: /open the recipe$/ })).toHaveCount(2);
    await expect(table.getByRole('button', { name: /^Fish pie/ })).toHaveCount(0);
    await table.getByRole('button', { name: 'Tacos: open the recipe' }).click();
    const sheet = page.getByRole('dialog', { name: /^Tacos/ });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
    const chips = sheet.getByRole('group', { name: 'Photos and PDFs' }).getByRole('button');
    await expect(chips).toHaveText(['Grandma’s card', 'Taco night.pdf']);
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('img', { name: 'Grandma’s card' })).toBeVisible();
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.locator('object[type="application/pdf"]')).toHaveCount(1);
    await expect(
      sheet.getByRole('region', { name: 'Ingredients' }).getByRole('listitem'),
    ).toHaveText([
      '1 lb ground beef',
      '8 tortillas',
      '1 onion',
      '1 lettuce',
      'Cheddar',
      'Taco seasoning',
      'Olive oil',
    ]);
    await expect(
      sheet.getByRole('region', { name: 'From tasty-tacos.example' }).getByRole('listitem'),
    ).toHaveCount(4);
    // Read-only: nothing on it but Close and the chips.
    await expect(sheet.getByRole('button')).toHaveCount(3);
    await expect(sheet.getByRole('textbox')).toHaveCount(0);
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    // Escape closes it too; a meal with ingredients only shows them.
    await table.getByRole('button', { name: 'Spaghetti: open the recipe' }).click();
    const plain = page.getByRole('dialog', { name: /^Spaghetti · tonight/ });
    await expect(plain.getByRole('region', { name: 'Ingredients' })).toContainText(
      '1 box spaghetti',
    );
    await page.keyboard.press('Escape');
    await expect(plain).toHaveCount(0);
  });
}
