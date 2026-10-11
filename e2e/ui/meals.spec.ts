import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-01][MEAL-02][MEAL-03][MEAL-08] Meals for a parent (WP-25) on /dev/meals: a made-up family, no
// database. The week (each day's four meals, entries in order, for everyone or one person), the
// Change menu, "Add to the plan" (the library's meals for the chosen meal first, or something
// written in), copying last week, the library, and the layout on a phone and a laptop in Day and
// Evening. The same pages run signed in against the database in e2e/tests/meals.spec.ts.

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
        'main button, main a.fw-btn, main .fw-meal-slot__add, main summary, main select, main input:not([type=hidden]):not(.fw-visually-hidden)',
      ),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return (
          r.height > 0 &&
          r.height < 44 &&
          (b as HTMLInputElement).type !== 'radio' &&
          (b as HTMLInputElement).type !== 'checkbox'
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
      test(`[MEAL-01][NFR-11] the week and the library fit a ${device} in ${theme}: no sideways scroll, 44 px targets, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/meals?theme=${theme}`);
        await page
          .getByRole('group', { name: 'Wed, Oct 14 snack' })
          .locator('summary')
          .first()
          .click();
        await fits(page, viewport.width);
        await contrastOk(page);
        await page.goto(`/dev/meals?page=library&theme=${theme}`);
        await fits(page, viewport.width);
        await contrastOk(page);
      });
    }
  });
}

test('[MEAL-01][MEAL-08][US-701] the week: seven days of four meals, each in order, for everyone or one person', async ({
  page,
}) => {
  await page.goto('/dev/meals');
  await expect(page.getByRole('heading', { name: 'Week of Sun, Oct 11' })).toBeVisible();
  const week = page.getByRole('list', { name: 'Week of Sun, Oct 11' });
  await expect(
    week.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) }),
  ).toHaveCount(7);
  await expect(week.getByRole('heading', { level: 3 })).toHaveText([
    'Sun, Oct 11',
    'Mon, Oct 12',
    'Tue, Oct 13',
    'Wed, Oct 14Today',
    'Thu, Oct 15',
    'Fri, Oct 16',
    'Sat, Oct 17',
  ]);
  const snack = page.getByRole('group', { name: 'Wed, Oct 14 snack' });
  await expect(snack.getByRole('listitem')).toHaveCount(2);
  await expect(snack.getByRole('listitem').first()).toContainText('Apple slicesMaya');
  await expect(snack.getByRole('listitem').nth(1)).toContainText('Crackers');
  await expect(page.getByRole('group', { name: 'Mon, Oct 12 dinner' })).toContainText(
    'TacosMake extra for lunch',
  );
  await expect(page.getByRole('group', { name: 'Tue, Oct 13 lunch' })).toContainText(
    'Leftover tacosLeo',
  );
  // Each meal of each day can be added to.
  await expect(page.getByRole('link', { name: /^Add to / })).toHaveCount(28);
  await expect(page.getByRole('link', { name: 'Add to Thu, Oct 15 breakfast' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-11&day=2026-10-15&slot=breakfast#add',
  );
  await expect(page.getByRole('link', { name: 'Last week' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-04',
  );
  await expect(page.getByRole('link', { name: 'Next week' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-18',
  );
});

test('[MEAL-08] Change: earlier, later or remove, as the entry’s place allows', async ({
  page,
}) => {
  await page.goto('/dev/meals');
  const snack = page.getByRole('group', { name: 'Wed, Oct 14 snack' });
  await snack.getByText('Change', { exact: true }).first().click();
  await expect(snack.getByRole('button', { name: 'Move Apple slices later' })).toBeVisible();
  await expect(snack.getByRole('button', { name: 'Move Apple slices earlier' })).toHaveCount(0);
  await expect(
    snack.getByRole('button', { name: 'Remove Apple slices from Wed, Oct 14 snack' }),
  ).toBeVisible();
  await snack.getByText('Change', { exact: true }).nth(1).click();
  await expect(snack.getByRole('button', { name: 'Move Crackers earlier' })).toBeVisible();
  await expect(snack.getByRole('button', { name: 'Move Crackers later' })).toHaveCount(0);
  // A meal alone in its slot is only removed.
  const dinner = page.getByRole('group', { name: 'Sun, Oct 11 dinner' });
  await dinner.getByText('Change', { exact: true }).click();
  await expect(dinner.getByRole('button')).toHaveText(['Remove']);
});

test('[MEAL-01][MEAL-02] Add to the plan: the library’s meals for the meal chosen first, or something written in', async ({
  page,
}) => {
  await page.goto('/dev/meals?add=1');
  const form = page.getByRole('form', { name: 'Add to the plan' });
  await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue('2026-10-14');
  await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue('snack');
  const library = form.getByRole('combobox', { name: 'From the library' });
  await expect(library.locator('option').first()).toHaveText('Apple slices');
  await form.getByRole('combobox', { name: 'Meal' }).selectOption('dinner');
  await expect(library.locator('option')).toHaveText([
    'Chicken soup',
    'Fish pie',
    'Spaghetti',
    'Tacos',
    'Apple slices',
    'Pancakes',
    'Porridge',
  ]);
  await form.getByRole('radio', { name: 'Something else' }).check();
  await expect(form.getByRole('textbox', { name: 'Something else' })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'From the library' })).toHaveCount(0);
  await expect(form.getByRole('group', { name: 'For' }).getByRole('radio')).toHaveCount(4);
  await expect(form.getByRole('radio', { name: 'Everyone' })).toBeChecked();
});

test('[MEAL-03][US-702] copy last week: keep or replace what this week already has', async ({
  page,
}) => {
  await page.goto('/dev/meals');
  const copy = page.getByRole('form', { name: 'Copy last week' });
  await expect(copy.getByRole('radio', { name: 'Keep it' })).toBeChecked();
  await expect(copy.getByRole('radio', { name: 'Replace it with last week’s' })).not.toBeChecked();
  await expect(copy.getByRole('button', { name: 'Copy last week here' })).toBeVisible();
});

test('[MEAL-02] the library: each meal, what it’s good for and its recipe; archived ones aside', async ({
  page,
}) => {
  await page.goto('/dev/meals?page=library');
  const meals = page.getByRole('list', { name: 'Meals', exact: true });
  await expect(meals.getByRole('listitem')).toHaveCount(7);
  await expect(meals.getByRole('listitem').filter({ hasText: 'Chicken soup' })).toContainText(
    'Lunch or dinner',
  );
  await expect(meals.getByRole('link', { name: 'Recipe for Tacos' })).toHaveAttribute(
    'href',
    'https://example.com/tacos',
  );
  await expect(page.getByRole('list', { name: 'Archived meals' })).toContainText('Old casserole');
  const add = page.getByRole('form', { name: 'Add a meal' });
  await expect(add.getByRole('group', { name: 'Good for' }).getByRole('checkbox')).toHaveCount(4);
  await meals.getByText('Edit Tacos').click();
  await expect(
    page.getByRole('form', { name: 'Edit Tacos' }).getByRole('checkbox', { name: 'Dinner' }),
  ).toBeChecked();
});

test('[MEAL-04][US-703] school lunch: each child’s school days, buy or bring, a changed day marked; no lunch on a day off or the weekend', async ({
  page,
}) => {
  await page.goto('/dev/meals');
  const lunch = page.getByRole('region', { name: 'School lunch' });
  const leo = lunch.getByRole('row', { name: /^Leo/ });
  await expect(leo.getByRole('cell')).toHaveText([
    'Weekend',
    'Bring',
    'BuyChanged',
    'Buy',
    'No school',
    'Bring',
    'Weekend',
  ]);
  await expect(
    leo.getByRole('button', { name: 'Leo, Tue, Oct 13: buy (changed). Change to bring' }),
  ).toHaveAttribute('value', 'f2000000-0000-4000-8000-000000000002:2026-10-13:bring');
  await expect(lunch.getByRole('row', { name: /^Maya/ }).getByRole('button')).toHaveCount(4);
  const usual = lunch.getByRole('form', { name: 'Maya’s usual lunches' });
  await expect(usual.getByRole('combobox', { name: 'Friday' })).toHaveValue('buy');
  await expect(usual.getByRole('combobox', { name: 'Monday' })).toHaveValue('bring');
});
