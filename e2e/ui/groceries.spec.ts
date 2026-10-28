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

  test.describe('with no service worker', () => {
    // A page the service worker controls sends its fetches through it, and WebKit then doesn't route
    // them to the test: the choice's page couldn't be held here.
    test.use({ serviceWorkers: 'block' });

    test('[MEAL-18-d] an item’s ⋯ fits inside the screen and closes once a choice is made', async ({
      page,
    }) => {
      await open(page, '/dev/groceries');
      const more = page.locator('#item-' + (await idOf(page, 'Onions')) + ' .fw-groc__more');
      const menu = more.locator('.fw-groc__menu');
      await page.getByLabel('More for Onions').click();
      await expect(menu).toBeVisible();
      // Every row and its words sit inside the menu, and the menu inside the screen.
      const outside = await menu.evaluate((m) => {
        const box = m.getBoundingClientRect();
        const out = [...m.querySelectorAll('.fw-groc__mi, .fw-groc__mi > *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > box.right + 0.5 || r.left < box.left - 0.5;
          })
          .map((el) => el.textContent?.trim());
        if (box.left < 0 || box.right > document.documentElement.clientWidth) out.push('the menu');
        return out;
      });
      expect(outside).toEqual([]);
      // A choice closes it at once. Its page (the signed-in /admin/groceries) is held, so this
      // page stays to be looked at.
      const held: unknown[] = [];
      await page.route('**/admin/groceries**', (route) => void held.push(route));
      await menu.getByRole('link', { name: 'Edit' }).click();
      await expect(more).not.toHaveAttribute('open');
      // So do Escape and a tap anywhere else.
      await page.getByLabel('More for Onions').click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(more).not.toHaveAttribute('open');
      await page.getByLabel('More for Onions').click();
      await expect(menu).toBeVisible();
      await page.getByRole('heading', { name: 'Groceries', level: 1 }).click();
      await expect(more).not.toHaveAttribute('open');
    });
  });

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
    // On a phone both fields fit inside the form.
    await page.setViewportSize({ width: 390, height: 844 });
    const spill = await edit.evaluate((f) => {
      const box = f.getBoundingClientRect();
      return [...f.querySelectorAll('input:not([type=hidden])')]
        .filter((i) => i.getBoundingClientRect().right > box.right + 0.5)
        .map((i) => i.getAttribute('name'));
    });
    expect(spill).toEqual([]);
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
      'Milk · Kirkland',
      'Salmon fillets',
      'Paper towels · Kirkland Signature',
    ]);
  });

  test('[MEAL-18-d] Got recently: what was got this week, with Untick', async ({ page }) => {
    await open(page, '/dev/groceries');
    const got = page.locator('#got');
    await expect(got).toContainText('Coffee, Sat 4:42 pm, and 3 more this week');
    await expect(got.locator('.fw-groc__count')).toHaveText('4');
    await got.locator('summary').click();
    const rows = got.getByRole('list', { name: 'Got recently' }).getByRole('listitem');
    await expect(rows.locator('strong')).toHaveText([
      "Coffee · Peet's",
      'Pasta',
      'Strawberries',
      'Foil',
    ]);
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

// [MEAL-28][US-721] The preferred store (WP-112, D-142): New items go to, the Preferred pill, the add
// field's preferred chip, and the new-store hint in full on an iPhone at 390 px.
test.describe('the preferred store', () => {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-28-e] New items go to, its help line and Preferred on the chosen store, in ${theme}`, async ({
      page,
    }) => {
      await open(page, `/dev/groceries?preferred=Costco&open=places&theme=${theme}`);
      const places = page.locator('#places');
      const choose = places.getByRole('combobox', { name: 'New items go to' });
      await expect(choose).toHaveValue(
        (await choose.locator('option', { hasText: 'Costco' }).getAttribute('value')) ?? '',
      );
      await expect(choose.locator('option')).toHaveText([
        'Any store',
        'Costco',
        'Kroger',
        'Aldi',
        'Walmart',
        'Meijer',
        "Sam's Club",
      ]);
      await expect(places).toContainText(
        'A new item gets this store. One you’ve had before keeps the store it had last time.',
      );
      const stores = places.getByRole('list', { name: 'Stores' }).getByRole('listitem');
      await expect(stores.filter({ hasText: 'Preferred' })).toHaveCount(1);
      await expect(stores.filter({ hasText: 'Preferred' }).locator('strong')).toHaveText('Costco');
      expect((await choose.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await fits(page);
      await contrastOk(page);
    });
  }

  test('[MEAL-28-e] with no preferred store, New items go to says Any store and nothing is Preferred', async ({
    page,
  }) => {
    await open(page, '/dev/groceries?open=places');
    await expect(page.getByRole('combobox', { name: 'New items go to' })).toHaveValue('');
    await expect(page.locator('#places')).not.toContainText('Preferred');
  });

  test('[MEAL-28-e] the add field picks the preferred store’s chip for a new item and says so', async ({
    page,
  }) => {
    await open(page, '/dev/groceries?preferred=Costco');
    const add = page.getByRole('form', { name: 'Add to the list' });
    await add.getByRole('textbox', { name: 'Add an item' }).fill('olive oil');
    const store = add.getByRole('group', { name: 'Store' });
    await expect(store.getByRole('radio', { name: 'Costco' })).toBeChecked();
    await expect(store.locator(':scope > label.fw-groc__chip')).toHaveText([
      'Any store',
      'Costco',
      'Kroger',
      'Aldi',
    ]);
    await expect(add).toContainText('Costco is your preferred store.');
    // Something had before keeps last time's store, whatever is preferred.
    await add.getByRole('textbox', { name: 'Add an item' }).fill('tortillas');
    await expect(store.getByRole('radio', { name: 'Kroger' })).toBeChecked();
    await expect(add).toContainText('where it was bought last time');
    await expect(add).not.toContainText('preferred store');
    // One tap picks another store, and the line goes.
    await add.getByRole('textbox', { name: 'Add an item' }).fill('olive oil');
    await store.getByText('Any store').click();
    await expect(store.getByRole('radio', { name: 'Any store' })).toBeChecked();
    await expect(add).not.toContainText('preferred store');
    await fits(page);
  });

  test('[MEAL-28-e] the new-store hint shows in full on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/dev/groceries?open=places');
    const field = page.getByRole('form', { name: 'New store' }).getByRole('textbox');
    await expect(field).toHaveAttribute('placeholder', 'New store, like Trader Joe’s');
    // The hint itself typed in: it fits the field, with nothing cut off or scrolled.
    await field.fill('New store, like Trader Joe’s');
    const over = await field.evaluate((t) => ({
      down: t.scrollHeight - t.clientHeight,
      across: t.scrollWidth - t.clientWidth,
    }));
    expect(over, 'the hint overflows its field').toEqual({ down: 0, across: 0 });
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
