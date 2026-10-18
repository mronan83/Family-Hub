import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-07][MEAL-19][MEAL-25] Meals → groceries in the admin app (WP-105, D-138) on /dev/meals: a
// made-up family, no database. A library meal's Ingredients in its form; the week's Add to groceries
// review; a meal's Recipe. On a phone and a laptop in Day and Evening (it runs as an iPhone in WebKit
// too). Taps wait for React to take the page over (D-110).

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
async function fits(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main button, main input:not([type=hidden]):not(.fw-visually-hidden)',
      ),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return r.height > 0 && r.height < 44 && type !== 'checkbox' && type !== 'radio';
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent),
  );
  expect(small).toEqual([]);
}

/** The Tacos form in the library, opened. */
async function tacos(page: Page) {
  // [D-132] ⋯ → Edit opens the meal's form in place under its row (WP-96).
  await open(page, '/dev/meals?page=library&edit=Tacos');
  return page.getByRole('form', { name: 'Edit Tacos' });
}
const sent = async (form: ReturnType<Page['getByRole']>) =>
  JSON.parse(await form.locator('input[name="ingredients"]').inputValue()) as unknown[];

test('[MEAL-07-b][US-706] a meal’s Ingredients: amount, name and We usually have it; the last row adds one, × takes one away', async ({
  page,
}) => {
  const form = await tacos(page);
  const ing = form.getByRole('group', { name: 'Ingredients' });
  await expect(ing.getByRole('textbox', { name: 'Ingredient 1' })).toHaveValue('Ground beef');
  await expect(ing.getByRole('textbox', { name: 'Amount of Ground beef' })).toHaveValue('1 lb');
  await expect(ing.getByRole('checkbox', { name: 'We usually have it' })).toHaveCount(7);
  await expect(ing.getByRole('checkbox', { name: 'We usually have it' }).nth(5)).toBeChecked();
  // The last row adds one as it is typed in.
  await ing.getByRole('textbox', { name: 'Add an ingredient' }).fill('Salsa');
  await expect(ing.getByRole('textbox', { name: 'Add an ingredient' })).toHaveValue('');
  await ing.getByRole('textbox', { name: 'Amount of Salsa' }).fill('1 jar');
  await ing.getByRole('checkbox', { name: 'We usually have it' }).nth(7).check();
  // × takes one away.
  await ing.getByRole('button', { name: 'Remove Lettuce' }).click();
  expect(await sent(form)).toEqual([
    { name: 'Ground beef', amount: '1 lb', have: false },
    { name: 'Tortillas', amount: '8', have: false },
    { name: 'Onion', amount: '1', have: false },
    { name: 'Cheddar', amount: null, have: false },
    { name: 'Taco seasoning', amount: null, have: true },
    { name: 'Olive oil', amount: null, have: true },
    { name: 'Salsa', amount: '1 jar', have: true },
  ]);
});

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-07-b] a meal’s form with its ingredients fits a ${device} in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      // [D-132] Opened from ⋯ → Edit, under its row (WP-96).
      await page.goto(`/dev/meals?page=library&edit=Tacos&theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
      await expect(page.getByRole('group', { name: 'Ingredients' })).toBeVisible();
      await fits(page);
      await contrastOk(page);
    });
  }
}

test('[MEAL-19-e][US-715] the week’s Add to groceries: by meal in day order, the notes, Add n to groceries and Cancel', async ({
  page,
}) => {
  await open(page, '/dev/meals');
  await expect(page.getByRole('link', { name: 'Add to groceries' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-11&groceries=1',
  );
  await open(page, '/dev/meals?groceries=1');
  const sheet = page.getByRole('dialog', { name: 'Add this week to groceries' });
  await expect(sheet).toBeFocused();
  await expect(sheet.locator('legend b')).toHaveText(['Tacos', 'Spaghetti', 'Pancakes']);
  await expect(sheet.locator('legend')).toHaveText([
    /Tacos\s+Mon/,
    /Spaghetti\s+Tue/,
    /Pancakes\s+Sat/,
  ]);
  await expect(sheet).toContainText('have no ingredients yet');
  const row = (name: string, nth = 0) => sheet.locator('label').filter({ hasText: name }).nth(nth);
  await expect(row('Taco seasoning')).toContainText('We usually have it');
  await expect(row('Taco seasoning').getByRole('checkbox')).not.toBeChecked();
  await expect(row('Eggs').getByRole('checkbox')).not.toBeChecked();
  await expect(row('Eggs')).toContainText('Added Sun');
  await expect(row('Cheddar')).toContainText('On the list already');
  await expect(row('Ground beef', 1)).toContainText('With Tacos: 2 lb');
  await expect(row('Onions')).toContainText('With Tacos: ×3');
  await expect(sheet.getByRole('button', { name: 'Add 9 to groceries' })).toBeEnabled();
  // Unticking changes the count and what merges with what.
  await row('Ground beef').getByRole('checkbox').uncheck();
  await expect(sheet.getByRole('button', { name: 'Add 8 to groceries' })).toBeVisible();
  await expect(row('Ground beef', 1)).not.toContainText('With Tacos');
  await expect(sheet.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-11',
  );
});

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-19-e] the week’s review fits a ${device} in ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page, `/dev/meals?groceries=1&theme=${theme}`);
      await expect(page.getByRole('dialog', { name: 'Add this week to groceries' })).toBeVisible();
      await fits(page);
      await contrastOk(page);
    });
  }
}

test.describe('with no service worker', () => {
  // A page the service worker controls sends its fetches through it, and WebKit then doesn't route
  // them to the test: the recipe link's answer couldn't be given here.
  test.use({ serviceWorkers: 'block' });

  test('[MEAL-25-g][US-720] a meal’s Recipe: the link with Read ingredients, its photos and PDFs, and what was read filled in to check', async ({
    page,
  }) => {
    await open(page, '/dev/meals?page=library&edit=Tacos');
    const form = page.getByRole('form', { name: 'Edit Tacos' });
    const recipe = form.getByRole('group', { name: 'Recipe' });
    await expect(recipe.getByRole('textbox', { name: 'Recipe link' })).toHaveValue(
      'https://example.com/tacos',
    );
    const files = recipe.getByRole('list', { name: 'Photos and PDFs' }).getByRole('listitem');
    await expect(files).toHaveCount(2);
    await expect(files.first()).toContainText('Grandma’s card.jpg');
    await expect(files.first()).toContainText('Photo · 1.2 MB');
    await expect(files.nth(1)).toContainText('PDF · 340 KB');
    await expect(
      recipe.getByRole('button', { name: 'Read ingredients from Taco night.pdf' }),
    ).toBeVisible();
    await expect(recipe.getByRole('button', { name: 'Remove Taco night.pdf' })).toBeVisible();
    await expect(recipe.getByRole('button', { name: 'Add a photo or PDF' })).toBeVisible();
    // Read ingredients from the link: the server reads the page; here it answers as the route would.
    await page.route('**/api/recipes/read', (route) =>
      route.fulfill({
        json: {
          ok: true,
          site: 'example.com',
          ingredients: [
            { name: 'Ground beef', amount: '1 lb', have: false },
            { name: 'Corn tortillas', amount: '8', have: false },
            { name: 'Chili powder', amount: null, have: false },
          ],
          steps: ['Brown the beef.', 'Warm the tortillas.'],
        },
      }),
    );
    await recipe.getByRole('button', { name: 'Read ingredients', exact: true }).click();
    await expect(recipe.getByRole('status')).toHaveText(
      'Found 3 ingredients on the page. They are filled in below for you to check.',
    );
    // Filled in to check, never saved by themselves: the form still has Save.
    expect(await sent(form)).toEqual([
      { name: 'Ground beef', amount: '1 lb', have: false },
      { name: 'Corn tortillas', amount: '8', have: false },
      { name: 'Chili powder', amount: null, have: false },
    ]);
    await expect(form.locator('input[name="recipeSteps"]')).toHaveValue(
      JSON.stringify(['Brown the beef.', 'Warm the tortillas.']),
    );
    // A page that publishes no recipe says so and changes nothing.
    await page.route('**/api/recipes/read', (route) =>
      route.fulfill({ json: { ok: false, why: 'no_recipe' } }),
    );
    await recipe.getByRole('button', { name: 'Read ingredients', exact: true }).click();
    await expect(recipe.getByRole('status')).toContainText('doesn’t publish its recipe');
    expect(await sent(form)).toHaveLength(3);
    // A new meal adds photos and PDFs once it is saved.
    await page.getByText('Add a meal', { exact: true }).first().click();
    await expect(page.getByRole('form', { name: 'Add a meal' })).toContainText(
      'Add photos and PDFs of the recipe once the meal is saved.',
    );
    await fits(page);
    await contrastOk(page);
  });
});
