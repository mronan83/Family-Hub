import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-18][MEAL-23][MEAL-24] Groceries in the admin app (WP-104, D-138) on /dev/groceries: the made-up
// demo family's list, no database. The page on a phone and a laptop in Day and Evening (it runs as an
// iPhone in WebKit too); the add field and its suggestion; an item's ⋯; Select and Move to; the
// store chips; Got recently; Categories and stores. The same page runs signed in against the
// database in e2e/tests/groceries.spec.ts. Taps wait for React to take the page over (D-110).

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
        'main button, main a.fw-btn, main a.fw-groc__chip, main a.fw-groc__secadd, main summary, main input:not([type=hidden]):not(.fw-visually-hidden), main label.fw-groc__chip',
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

const list = (page: Page) => page.getByRole('region', { name: 'On the list' });
const section = (page: Page, name: string) => list(page).getByRole('region', { name, exact: true });

test.describe('the admin app’s Groceries', () => {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-18-d][US-714] the list by category, A to Z, with amount, store and why; fits in ${theme}`, async ({
      page,
    }) => {
      await open(page, `/dev/groceries?theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
      await expect(page.getByText('19 to get')).toBeVisible();
      // The add field is open at the top (D-138 (10)).
      await expect(page.getByRole('textbox', { name: 'Add an item' })).toBeVisible();
      await expect(list(page).getByRole('heading', { level: 3 })).toHaveText([
        'Produce',
        'Dairy & Eggs',
        'Bakery',
        'Meat & Seafood',
        'Pantry',
        'Household',
      ]);
      const produce = section(page, 'Produce');
      await expect(produce.locator('.fw-groc__l1 strong')).toHaveText([
        'Apples',
        'Avocados',
        'Baby spinach',
        'Bananas',
        'Lettuce',
        'Onions',
      ]);
      const onions = produce.getByRole('listitem').filter({ hasText: 'Onions' });
      await expect(onions).toContainText('×3');
      await expect(onions).toContainText('Tacos, Tue');
      await expect(onions).toContainText('Chili, Wed');
      const avocados = produce.getByRole('listitem').filter({ hasText: 'Avocados' });
      await expect(avocados.locator('.fw-groc__store')).toHaveText('Aldi');
      await expect(produce.getByRole('listitem').filter({ hasText: 'Apples' })).toContainText(
        'Leo asked',
      );
      await expect(page.getByRole('button', { name: 'Got Onions' })).toBeVisible();
      await fits(page);
      await contrastOk(page);
    });
  }

  test('[MEAL-18-d] an item’s ⋯ says why it is on the list and holds the rest', async ({
    page,
  }) => {
    await open(page, '/dev/groceries');
    await page.getByLabel('More for Onions').click();
    const menu = page.locator('#item-' + (await idOf(page, 'Onions')) + ' .fw-groc__menu');
    await expect(menu).toContainText('Why it’s on the list');
    await expect(menu).toContainText('Tacos, Tue: 1');
    await expect(menu).toContainText('Chili, Wed: 2');
    await expect(menu).toContainText('Merged from 2 meals');
    await expect(menu.getByRole('link', { name: 'Edit' })).toBeVisible();
    await expect(menu.getByRole('link', { name: /Move to…/ })).toContainText('Produce');
    await expect(menu.getByRole('link', { name: /Store…/ })).toContainText('Any store');
    await expect(menu.getByRole('link', { name: 'Select several' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Remove Onions' })).toBeVisible();
    await contrastOk(page);
    // Edit, Move to and Store open in place, under the row.
    await open(page, '/dev/groceries?edit=Onions');
    const edit = page.getByRole('form', { name: 'Edit Onions' });
    await expect(edit.getByLabel('Amount')).toHaveValue('×3');
    await expect(edit.getByLabel('Name')).toHaveValue('Onions');
    await open(page, '/dev/groceries?move=Onions');
    await expect(
      page.getByRole('form', { name: 'Move Onions to' }).getByRole('radio', { name: 'Produce' }),
    ).toBeChecked();
    await open(page, '/dev/groceries?storeOf=Avocados');
    await expect(
      page.getByRole('form', { name: 'Store for Avocados' }).getByRole('radio', { name: 'Aldi' }),
    ).toBeChecked();
  });

  test('[MEAL-24-d][US-719] adding suggests the category and store before Add; one tap changes it', async ({
    page,
  }) => {
    await open(page, '/dev/groceries');
    const add = page.getByRole('form', { name: 'Add to the list' });
    await add.getByRole('textbox', { name: 'Add an item' }).fill('2 bananas');
    // Had before: last time's category and store.
    await expect(
      add.getByRole('group', { name: 'Goes in' }).getByRole('radio', { name: 'Produce' }),
    ).toBeChecked();
    await expect(
      add.getByRole('group', { name: 'Store' }).getByRole('radio', { name: 'Aldi' }),
    ).toBeChecked();
    await expect(add.getByText('where it went last time')).toBeVisible();
    // One tap changes it.
    await add.getByText('Other…').first().click();
    await add.getByRole('group', { name: 'Goes in' }).getByText('Snacks').click();
    await expect(
      add.getByRole('group', { name: 'Goes in' }).getByRole('radio', { name: 'Snacks' }),
    ).toBeChecked();
    // The tap holds while the name is finished.
    await add.getByRole('textbox', { name: 'Add an item' }).fill('2 bananas, ripe');
    await expect(
      add.getByRole('group', { name: 'Goes in' }).getByRole('radio', { name: 'Snacks' }),
    ).toBeChecked();
    // Nothing known: Other, any store.
    await open(page, '/dev/groceries?typed=flux%20capacitor');
    await expect(
      add.getByRole('group', { name: 'Goes in' }).getByRole('radio', { name: 'Other' }),
    ).toBeChecked();
    await expect(
      add.getByRole('group', { name: 'Store' }).getByRole('radio', { name: 'Any store' }),
    ).toBeChecked();
    // [MEAL-20-c] An open item it may be offers Make it one.
    await open(page, '/dev/groceries?typed=greek%20yog');
    await expect(
      page.getByRole('status').filter({ hasText: 'Also on the list: Greek yogurt' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make it one' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
  });

  test('[MEAL-23-d][US-718] Select: tick several, then Move to…, Store… or Remove for all at once', async ({
    page,
  }) => {
    await open(page, '/dev/groceries');
    await expect(list(page).getByRole('link', { name: 'Select' })).toHaveAttribute(
      'href',
      '/admin/groceries?select=1',
    );
    await open(page, '/dev/groceries?select=1');
    for (const name of ['Apples', 'Avocados', 'Bananas'])
      await page.getByRole('checkbox', { name: `Select ${name}` }).check();
    const bar = page.getByRole('region', { name: 'Selected' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Move to…' }).click();
    const move = page.getByRole('form', { name: 'Move 3 items to' });
    await expect(move.getByRole('radio')).toHaveCount(9);
    await expect(move.getByLabel('New category…')).toBeVisible();
    await expect(move.getByRole('button', { name: 'Move 3 items' })).toBeVisible();
    await bar.getByRole('button', { name: 'Store…' }).click();
    await expect(
      page.getByRole('form', { name: 'Store for 3 items' }).getByRole('radio'),
    ).toHaveCount(7);
    await bar.getByRole('button', { name: 'Remove' }).click();
    // Remove asks first.
    await expect(page.getByRole('form', { name: 'Remove 3 items' })).toContainText(
      'Take 3 items off the list?',
    );
    await page.getByRole('button', { name: 'Keep them' }).click();
    await expect(page.getByRole('form', { name: 'Remove 3 items' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select Apples' }).uncheck();
    await expect(bar).toContainText('2 selected');
    await expect(list(page).getByRole('link', { name: 'Done' })).toHaveAttribute(
      'href',
      '/admin/groceries',
    );
    await fits(page);
    await contrastOk(page);
  });

  test('[MEAL-23-d] the store chips filter the list, still by category', async ({ page }) => {
    await open(page, '/dev/groceries');
    const chips = page.getByRole('navigation', { name: 'Stores' });
    await expect(chips.getByRole('link')).toHaveText([
      'All 19',
      'Costco 3',
      'Kroger 3',
      'Aldi 3',
      'Walmart 1',
      'Any store 9',
    ]);
    await open(page, '/dev/groceries?store=Costco');
    await expect(chips.getByRole('link', { name: 'Costco 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(list(page).getByRole('heading', { level: 3 })).toHaveText([
      'Dairy & Eggs',
      'Meat & Seafood',
      'Household',
    ]);
    await expect(list(page).locator('.fw-groc__l1 strong')).toHaveText([
      'Milk',
      'Salmon fillets',
      'Paper towels',
    ]);
  });

  test('[MEAL-18-d] Got recently: what was got this week, with Untick', async ({ page }) => {
    await open(page, '/dev/groceries');
    const got = page.locator('#got');
    await expect(got).toContainText('Coffee, Sat 4:42 pm, and 3 more this week');
    await expect(got.locator('.fw-groc__count')).toHaveText('4');
    await got.locator('summary').click();
    const rows = got.getByRole('list', { name: 'Got recently' }).getByRole('listitem');
    await expect(rows.locator('strong')).toHaveText(['Coffee', 'Pasta', 'Strawberries', 'Foil']);
    await expect(rows.first()).toContainText('Got Sat 4:42 pm by Sam');
    await expect(got.getByRole('button', { name: 'Untick Foil' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
  });

  test('[MEAL-23-d] Categories and stores: in order, each to rename, move or remove; removing one with items asks', async ({
    page,
  }) => {
    await open(page, '/dev/groceries?open=places');
    const places = page.locator('#places');
    const cats = places.getByRole('list', { name: 'Categories' }).getByRole('listitem');
    await expect(cats.locator('strong')).toHaveText([
      'Produce',
      'Dairy & Eggs',
      'Bakery',
      'Meat & Seafood',
      'Pantry',
      'Frozen',
      'Snacks',
      'Household',
      'Other',
    ]);
    await expect(cats.filter({ hasText: 'Produce' })).toContainText('6 on the list');
    await expect(cats.filter({ hasText: 'Frozen' })).toContainText('Empty');
    await expect(places.getByRole('button', { name: 'Move Produce up' })).toBeDisabled();
    await expect(places.getByRole('button', { name: 'Move Dairy & Eggs up' })).toBeEnabled();
    // Other stays last and stays.
    await expect(places.getByLabel('More for Other')).toHaveCount(0);
    await expect(places.getByRole('form', { name: 'New category' })).toBeVisible();
    await expect(places.getByRole('form', { name: 'New store' })).toBeVisible();
    await expect(places.getByRole('list', { name: 'Stores' }).getByRole('listitem')).toHaveCount(6);
    await fits(page);
    await contrastOk(page);
    const produce = await page.evaluate(() =>
      document
        .querySelector('#places [aria-label="More for Produce"]')
        ?.closest('li')
        ?.querySelector('a[href*="ask="]')
        ?.getAttribute('href'),
    );
    await open(page, produce!.replace('/admin/groceries', '/dev/groceries'));
    await expect(page.getByRole('form', { name: 'Remove Produce' })).toContainText(
      'Remove Produce? Its 6 items go to Other.',
    );
  });

  test('[MEAL-18-d] an empty list says so', async ({ page }) => {
    await open(page, '/dev/groceries?state=empty');
    await expect(list(page)).toContainText('Nothing on the list right now.');
    await expect(page.getByText('Nothing to get')).toBeVisible();
    await fits(page);
  });
});

/** An item's id on /dev/groceries, from its tick button's row. */
async function idOf(page: Page, name: string): Promise<string> {
  const id = await page
    .getByRole('button', { name: `Got ${name}` })
    .evaluate((b) => b.closest('li')!.id.replace('item-', ''));
  return id;
}
