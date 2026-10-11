import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MENU-01..05][MEAL-05] School menus for a parent (WP-27) on /dev/menus: a made-up family, school
// and district, no database. Each menu with where it comes from, whose lunch it is, how its fetches
// are going (one that can't fetch keeps its menus and says why), its days (one the parent's own);
// adding one by picking the district's school; a file looked at before loading; the layout on a
// phone and a laptop in Day and Evening. The same page runs signed in in e2e/tests/menus.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
async function fits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main button, main a.fw-btn, main summary, main select, main input:not([type=hidden])',
      ),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return r.height > 0 && r.height < 44 && type !== 'radio' && type !== 'checkbox';
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent),
  );
  expect(small).toEqual([]);
}

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[MENU-01][NFR-11] School menus fit a ${device} in ${theme}: no sideways scroll, 44 px targets, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/menus?add=1&file=1&theme=${theme}`);
        await page.locator('summary[aria-label="Change Thu, Oct 15"]').first().click();
        await fits(page, viewport.width);
        await contrastOk(page);
      });
    }
  });
}

test('[MENU-01][MENU-02][US-801] each menu says where it comes from and whose lunch it is', async ({
  page,
}) => {
  await page.goto('/dev/menus');
  const menus = page
    .getByRole('list', { name: 'School menus' })
    .getByRole('listitem')
    .filter({ has: page.locator('strong') });
  const maple = page.getByRole('list', { name: 'School menus' }).locator('> li').nth(0);
  await expect(maple).toContainText('From Nutrislice · Maple Elementary · Lunch');
  await expect(maple).toContainText('Lunch for Maya and Leo');
  await expect(maple).toContainText('Fetched');
  await expect(
    page.getByRole('list', { name: 'School menus' }).locator('> li').nth(1),
  ).toContainText('From a file');
});

test('[MENU-03][US-802] a day the parent changed is theirs; the feed’s days can be changed too', async ({
  page,
}) => {
  await page.goto('/dev/menus');
  const days = page.getByRole('list', { name: 'Lunch at Maple Elementary' });
  await expect(days.getByRole('listitem')).toHaveCount(10);
  const trip = days.getByRole('listitem').filter({ hasText: 'Thu, Oct 15' });
  await expect(trip).toContainText('Field trip: bring a packed lunch');
  await expect(trip).toContainText('Yours');
  await expect(days.getByRole('listitem').filter({ hasText: 'Fri, Oct 16' })).toContainText(
    'No lunch: No School - Teacher Day',
  );
  await trip.locator('summary').click();
  const form = trip.getByRole('form', { name: 'Change Thu, Oct 15' });
  await expect(form.getByLabel('What’s for lunch')).toHaveValue('Field trip: bring a packed lunch');
  await expect(trip.getByRole('button', { name: 'Use Nutrislice’s menu again' })).toBeVisible();
  // A feed's own day has no "use the feed again": it is the feed's.
  const monday = days.getByRole('listitem').filter({ hasText: 'Mon, Oct 12' });
  await monday.locator('summary').click();
  await expect(monday.getByRole('button', { name: /Nutrislice/ })).toHaveCount(0);
  await expect(monday.getByLabel('What’s for lunch')).toHaveValue(
    'Main Line: Chicken Nuggets\nMain Line: Carrot Sticks\nMain Line: Apple',
  );
});

test('[MENU-04][US-803] a feed that can’t fetch says why and keeps its menus', async ({ page }) => {
  await page.goto('/dev/menus');
  const cedar = page.getByRole('list', { name: 'School menus' }).locator('> li').nth(2);
  await expect(cedar).toContainText('Can’t fetch');
  await expect(cedar).toContainText('Nutrislice answered 503. FamilyWise tries again tomorrow.');
  await expect(cedar).toContainText('the menus below are kept until it works again');
  await expect(
    page.getByRole('list', { name: 'Lunch at Cedar High' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(cedar.getByRole('button', { name: 'Fetch Cedar High now' })).toBeVisible();
});

test('[MENU-02][US-801] adding a Nutrislice menu: find the district’s schools, then pick the school and its menu', async ({
  page,
}) => {
  await page.goto('/dev/menus?add=1');
  const form = page.getByRole('form', { name: 'Add a school menu' });
  await expect(form.getByRole('radio', { name: /Nutrislice/ })).toBeChecked();
  await expect(form.getByRole('button', { name: 'Add the menu' })).toBeDisabled();
  const pick = form.getByRole('combobox', { name: 'School and menu' });
  await expect(pick.locator('option:not([disabled])')).toHaveText([
    'Cedar High · Lunch',
    'Maple Elementary · Breakfast',
    'Maple Elementary · Lunch',
    'Oak Middle · Lunch',
  ]);
  await pick.selectOption('maple-elementary/lunch');
  await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Maple Elementary',
  );
  await expect(form.getByRole('button', { name: 'Add the menu' })).toBeEnabled();
  // A file or typed in needs no district.
  await form.getByRole('radio', { name: /A file/ }).check();
  await expect(form.getByLabel('Your district on Nutrislice')).toHaveCount(0);
});

test('[MENU-03][US-802] a file is looked at before it loads: how many days, from when to when, the first few', async ({
  page,
}) => {
  await page.goto('/dev/menus?file=1');
  const held = page.getByRole('region', { name: 'The file holds' });
  await expect(held).toContainText('20 days, Mon, Oct 12 to Fri, Nov 6.');
  await expect(held.getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Load 20 days' })).toBeVisible();
});
