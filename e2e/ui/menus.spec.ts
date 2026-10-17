import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf, unfold } from '../support/fold';

// [MENU-01..05][MEAL-05] School menus for a parent (WP-27) on /dev/menus: a made-up family, school
// and district, no database. Each menu with where it comes from, whose lunch it is, how its fetches
// are going (one that can't fetch keeps its menus and says why), its days (one the parent's own);
// adding one by picking the district's school; a file looked at before loading; the layout on a
// phone and a laptop in Day and Evening. Each menu folded to its facts, opened by a tap after React
// has taken the page over (WP-93, D-110), Mon, Oct 12, 2026 at 9:15 am. The same page runs signed in
// in e2e/tests/menus.spec.ts.

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
async function fits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main button, main a.fw-btn, main summary, main select, main input:not([type=hidden]):not(.fw-visually-hidden)',
      ),
    ]
      // What's on screen: a control inside a closed fold isn't drawn, whatever its box says.
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return (
          b.checkVisibility() &&
          r.height > 0 &&
          r.height < 44 &&
          type !== 'radio' &&
          type !== 'checkbox'
        );
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
        await open(page, `/dev/menus?add=1&file=1&open=1&theme=${theme}`);
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
  await open(page, '/dev/menus');
  await unfold(foldOf(page, 'Maple Elementary'));
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
    // [MENU-06] A section a line, its options joined with "or" (WP-64).
    'Main Line: Chicken Nuggets or Carrot Sticks or Apple',
  );
});

test('[MENU-04][US-803] a feed that can’t fetch says why and keeps its menus', async ({ page }) => {
  await open(page, '/dev/menus');
  const cedar = page.getByRole('list', { name: 'School menus' }).locator('> li').nth(2);
  await expect(cedar).toContainText('Can’t fetch');
  await unfold(foldOf(page, 'Cedar High'));
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

// [NFR-18][D-120] School menus folded (WP-93), as the fold audit draws them.
const folds = (page: Page) => page.locator('main details:is(.fw-fold, .fw-card.fw-fold > details)');
const header = (page: Page, name: string) => foldOf(page, name).locator(':scope > summary');

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`School menus folded on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[NFR-18-g][US-111][MENU-04][D-120] every fold closed, then each opened by a tap, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/menus${theme === 'evening' ? '?theme=evening' : ''}`);

        await test.step('folded at first: each menu’s facts, the warning, Add a school menu’s button', async () => {
          // Three menus (Oak Middle's file with Load a file into), each with Add a day to, and Add a
          // school menu.
          await expect(folds(page)).toHaveCount(8);
          for (const d of await folds(page).all()) await expect(d).not.toHaveAttribute('open');
          await expect(header(page, 'Maple Elementary')).toHaveText(
            'Maple ElementaryFrom Nutrislice · Maya and Leo · Fetched 6:29 am · 9 days in the next four weeks',
          );
          await expect(header(page, 'Oak Middle')).toHaveText(
            'Oak MiddleFrom a file · nobody yet · 5 days in the next four weeks',
          );
          await expect(header(page, 'Cedar High')).toContainText(
            'From Nutrislice · nobody yet · last fetched Sun, Oct 11 at 6:29 am · 2 days in the next four weeks',
          );
          // Cedar High can't fetch, so its folded header says so; the others don't.
          await expect(header(page, 'Cedar High').locator('.fw-fold__flag')).toBeVisible();
          await expect(header(page, 'Cedar High').locator('.fw-fold__flag')).toHaveText(
            'Can’t fetch',
          );
          await expect(page.locator('.fw-fold__flag')).toHaveCount(1);
          await expect(header(page, 'Add a school menu').locator('.fw-fold__closed')).toHaveText(
            'Add a menu',
          );
          await expect(page.getByRole('list', { name: 'Lunch at Maple Elementary' })).toBeHidden();
          await fits(page, viewport.width);
          await contrastOk(page);
        });

        await test.step('Maple Elementary opened: its weeks, Add a day to, then Fetch now, Rename and Remove apart', async () => {
          const maple = foldOf(page, 'Maple Elementary');
          await header(page, 'Maple Elementary').click();
          await expect(maple).toHaveAttribute('open', '');
          const days = page.getByRole('list', { name: 'Lunch at Maple Elementary' });
          await expect(days).toBeVisible();
          expect(await maple.locator('h3').allTextContents()).toEqual([
            'Add a day to Maple Elementary',
            'Menu',
          ]);
          const addDay = foldOf(page, 'Add a day to Maple Elementary');
          expect((await days.boundingBox())!.y).toBeLessThan((await addDay.boundingBox())!.y);
          await expect(addDay).not.toHaveAttribute('open');
          const apart = maple.locator('.fw-fold__apart');
          await expect(
            apart.getByRole('button', { name: 'Fetch Maple Elementary now' }),
          ).toBeVisible();
          await expect(apart.getByRole('form', { name: 'Rename Maple Elementary' })).toBeVisible();
          // Removing still asks first.
          await expect(apart.getByRole('button', { name: 'Remove Maple Elementary' })).toBeHidden();
          await apart.locator('summary', { hasText: 'Remove Maple Elementary' }).click();
          await expect(
            apart.getByRole('button', { name: 'Remove Maple Elementary' }),
          ).toBeVisible();
          await header(page, 'Add a day to Maple Elementary').click();
          await expect(
            page.getByRole('form', { name: 'Add a day to Maple Elementary' }),
          ).toBeVisible();
          // Cedar High's warning stays on its header while Maple Elementary is open.
          await expect(header(page, 'Cedar High').locator('.fw-fold__flag')).toBeVisible();
        });

        await test.step('Oak Middle’s Load a file into, and Add a school menu, opened; the page still fits', async () => {
          await header(page, 'Oak Middle').click();
          await header(page, 'Load a file into Oak Middle').click();
          await expect(
            page.getByRole('form', { name: 'Load a file into Oak Middle' }),
          ).toBeVisible();
          await header(page, 'Add a school menu').click();
          await expect(page.getByRole('form', { name: 'Add a school menu' })).toBeVisible();
          await fits(page, viewport.width);
          await contrastOk(page);
        });
      });
    }
  });
}

test('[NFR-18-i][D-120] a menu just saved in comes back open, the others folded; with none, Add a school menu is open', async ({
  page,
}) => {
  await open(page, '/dev/menus?open=3');
  await expect(foldOf(page, 'Cedar High')).toHaveAttribute('open', '');
  await expect(page.getByRole('list', { name: 'Lunch at Cedar High' })).toBeVisible();
  for (const name of ['Maple Elementary', 'Oak Middle', 'Add a school menu']) {
    await expect(foldOf(page, name)).not.toHaveAttribute('open');
  }
  await open(page, '/dev/menus?state=empty');
  await expect(foldOf(page, 'Add a school menu')).toHaveAttribute('open', '');
});
