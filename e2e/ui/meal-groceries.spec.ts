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
  await open(page, '/dev/meals?page=library');
  await page.getByText('Edit Tacos').click();
  return page.getByRole('form', { name: 'Edit Tacos' });
}
const sent = async (form: ReturnType<Page['getByRole']>) =>
  JSON.parse(await form.locator('input[name="ingredients"]').inputValue()) as unknown[];

test('[MEAL-07-b] a meal’s Ingredients: amount, name and We usually have it; the last row adds one, × takes one away', async ({
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
      await page.goto(`/dev/meals?page=library&theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
      await page.getByText('Edit Tacos').click();
      await expect(page.getByRole('group', { name: 'Ingredients' })).toBeVisible();
      await fits(page);
      await contrastOk(page);
    });
  }
}
