import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-29] Grocery brands (WP-116, D-148) on /dev/groceries and /dev/home: the made-up demo family,
// no database. Kirkland, Kirkland Signature, Chobani, Peet's (Coffee's last time) and more; Horizon
// archived. The Brand field's offers and keys, a row's Brand…, Select's Brand…, the Brands list, and
// Home's card. It runs in Chrome, as an iPhone in WebKit and as Safari on a Mac (e2e/ui.config.ts).
// Adding for real runs signed in against the database in e2e/tests/grocery-brands.spec.ts. Taps wait
// for React to take the page over (D-110).

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

/** Nothing wider than the screen, and the brand field and its offers 44 px tall at least. */
async function fits(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.fw-groc__brand input, .fw-groc__offer')]
      .filter((b) => b.getBoundingClientRect().height < 44)
      .map((b) => b.textContent || b.getAttribute('name')),
  );
  expect(small).toEqual([]);
}

const addForm = (page: Page) => page.getByRole('form', { name: 'Add to the list' });
const brand = (page: Page) => addForm(page).getByRole('combobox', { name: 'Brand' });
const offers = (page: Page) => addForm(page).getByRole('listbox', { name: 'Brands' });

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-29-i] typing a brand offers the saved ones and Add, in ${theme}`, async ({
    page,
  }) => {
    await open(page, `/dev/groceries?typed=milk&brand=kirk&theme=${theme}`);
    await expect(offers(page).getByRole('option')).toHaveText([
      'Kirkland',
      'Kirkland Signature',
      'Add “kirk”',
    ]);
    await expect(addForm(page)).toContainText('kirk is new. Adding saves it to your brands.');
    await fits(page);
    await contrastOk(page);
  });
}

test('[MEAL-29-i][US-722] the Brand field shows once something is typed, filled with last time’s brand', async ({
  page,
}) => {
  await open(page, '/dev/groceries');
  await expect(brand(page)).toHaveCount(0);
  await addForm(page).getByRole('textbox', { name: 'Add an item' }).fill('coffee');
  await expect(brand(page)).toHaveValue("Peet's");
  await expect(addForm(page)).toContainText('its brand last time');
  // Something never had: no brand.
  await addForm(page).getByRole('textbox', { name: 'Add an item' }).fill('kombucha');
  await expect(brand(page)).toHaveValue('');
  // Archived: Horizon isn't offered, and typing it says it comes back.
  await brand(page).fill('Horizon');
  await expect(offers(page).getByRole('option')).toHaveText(['Add “Horizon”']);
  await expect(addForm(page)).toContainText('Horizon is archived. Adding brings it back.');
});

test('[MEAL-29-i] up, down and Enter pick an offer; a tap picks one; Escape closes them', async ({
  page,
}) => {
  await open(page, '/dev/groceries');
  await addForm(page).getByRole('textbox', { name: 'Add an item' }).fill('paper towels');
  await brand(page).fill('KIRK LAND');
  await expect(offers(page).getByRole('option')).toHaveText(['Kirkland', 'Kirkland Signature']);
  await brand(page).press('ArrowDown');
  await brand(page).press('ArrowDown');
  await expect(offers(page).getByRole('option', { name: 'Kirkland Signature' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await brand(page).press('Enter');
  await expect(brand(page)).toHaveValue('Kirkland Signature');
  await expect(offers(page)).toHaveCount(0);
  // Enter picked, it didn't add: the field still holds what was typed.
  await expect(addForm(page).getByRole('textbox', { name: 'Add an item' })).toHaveValue(
    'paper towels',
  );
  await brand(page).fill('chob');
  await offers(page).getByRole('option', { name: 'Chobani' }).click();
  await expect(brand(page)).toHaveValue('Chobani');
  await brand(page).fill('fair');
  await expect(offers(page)).toBeVisible();
  await brand(page).press('Escape');
  await expect(offers(page)).toHaveCount(0);
  await expect(brand(page)).toHaveAttribute('aria-expanded', 'false');
});

test('[MEAL-29-i] rows say their brand; an item’s ⋯ holds Brand…, which opens in place', async ({
  page,
}) => {
  await open(page, '/dev/groceries');
  const milk = page.locator('.fw-groc__row').filter({ hasText: 'Milk' }).first();
  await expect(milk.locator('.fw-groc__l1')).toHaveText('Milk · Kirkland×2');
  await open(page, '/dev/groceries?menu=Milk');
  await expect(page.getByRole('link', { name: /Brand…/ })).toContainText('Kirkland');
  await open(page, '/dev/groceries?menu=Onions');
  await expect(page.getByRole('link', { name: /Brand…/ })).toContainText('No brand');
  await open(page, '/dev/groceries?brandOf=Milk');
  const form = page.getByRole('form', { name: 'Brand of Milk' });
  await expect(form.getByRole('combobox', { name: 'Brand' })).toHaveValue('Kirkland');
  await expect(form.getByRole('button', { name: 'Set the brand' })).toBeVisible();
  await fits(page);
  await contrastOk(page);
});

test('[MEAL-29-i] Select: Brand… for all the items selected at once', async ({ page }) => {
  await open(page, '/dev/groceries?select=1');
  for (const name of ['Apples', 'Bananas'])
    await page.getByRole('checkbox', { name: `Select ${name}` }).check();
  await page
    .getByRole('region', { name: 'Selected' })
    .getByRole('button', { name: 'Brand…' })
    .click();
  const form = page.getByRole('form', { name: 'Brand of 2 items' });
  await expect(form.getByRole('combobox', { name: 'Brand' })).toHaveValue('');
  await expect(form.getByRole('button', { name: 'Set the brand' })).toBeVisible();
  await fits(page);
});

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-29-j] Brands: A to Z with their use, ⋯ Rename, Merge into… and Archive, Archived with Restore, in ${theme}`, async ({
    page,
  }) => {
    await open(page, `/dev/groceries?open=places&theme=${theme}`);
    const list = page.getByRole('list', { name: 'Brands', exact: true });
    await expect(list.locator('strong')).toHaveText([
      'Chobani',
      "Dave's Killer Bread",
      'Fairlife',
      'Jif',
      'Kirkland',
      'Kirkland Signature',
      'Mission',
      "Peet's",
    ]);
    await expect(list.getByRole('listitem').filter({ hasText: 'Fairlife' })).toContainText(
      'None on the list',
    );
    await expect(list.getByRole('listitem').filter({ hasText: 'Jif' })).toContainText(
      '1 on the list',
    );
    await page.getByLabel('More for Kirkland Signature').click();
    const row = list.getByRole('listitem').filter({ hasText: 'Kirkland Signature' });
    await expect(row.getByRole('link', { name: 'Rename' })).toBeVisible();
    await expect(row.getByRole('link', { name: 'Merge into…' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Archive Kirkland Signature' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'New brand' })).toBeVisible();
    const archived = page.getByRole('list', { name: 'Archived brands' });
    await expect(archived).toContainText('Horizon');
    await expect(archived.getByRole('button', { name: 'Restore' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
    // Folded, it counts the brands too.
    await open(page, `/dev/groceries?theme=${theme}`);
    await expect(page.locator('#places')).toContainText('9 categories · 6 stores · 8 brands');
  });
}

test('[MEAL-29-j] Merge into… picks the closest name and says what it does', async ({ page }) => {
  await open(page, '/dev/groceries?merge=Kirkland%20Signature');
  const form = page.getByRole('form', { name: 'Merge Kirkland Signature into' });
  await expect(form.getByRole('radio', { name: 'Kirkland', exact: true })).toBeChecked();
  await expect(form.getByRole('radio')).toHaveCount(7);
  await expect(form).toContainText('Every item with Kirkland Signature, on the list or had before');
  await expect(form.getByRole('button', { name: 'Merge' })).toBeVisible();
  await expect(form.getByRole('link', { name: 'Keep both' })).toBeVisible();
  await open(page, '/dev/groceries?renameBrand=Fairlife');
  await expect(
    page.getByRole('form', { name: 'Rename Fairlife' }).getByRole('textbox'),
  ).toHaveValue('Fairlife');
});

const homeCard = (page: Page) =>
  page
    .getByRole('list', { name: 'More quick actions' })
    .getByRole('listitem')
    .filter({ hasText: 'Groceries' });

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-29-k] Home’s card: the Brand field as an item is typed, last time’s brand, in ${theme}`, async ({
    page,
  }) => {
    await open(page, `/dev/home?theme=${theme}`);
    await expect(homeCard(page).getByRole('combobox', { name: 'Brand' })).toHaveCount(0);
    await homeCard(page).getByRole('textbox', { name: 'Add an item' }).fill('coffee');
    await expect(homeCard(page).getByRole('combobox', { name: 'Brand' })).toHaveValue("Peet's");
    await expect(homeCard(page)).toContainText('its brand last time');
    await homeCard(page).getByRole('combobox', { name: 'Brand' }).fill('fair');
    await expect(homeCard(page).getByRole('option')).toHaveText(['Fairlife', 'Add “fair”']);
    await fits(page);
    await contrastOk(page);
  });
}

test('[MEAL-29-k] Home’s lines name the brand: on the list already, and after Add', async ({
  page,
}) => {
  await open(page, '/dev/home?typed=1%20milk');
  await expect(homeCard(page).getByRole('status')).toContainText(
    'Milk · Kirkland ×2 are on the list already. Adding makes ×3.',
  );
  await open(page, '/dev/home?groceries=added-brand');
  await expect(homeCard(page).getByRole('status')).toContainText(
    'Added Milk · Kirkland ×3 to Dairy & Eggs.',
  );
});
