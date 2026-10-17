import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf, unfold } from '../support/fold';

// [MEAL-01][MEAL-02][MEAL-03][MEAL-08] Meals for a parent (WP-25) on /dev/meals: a made-up family, no
// database. The week (each day's four meals, entries in order, for everyone or one person), the
// Change menu, "Add to the plan" (the library's meals for the chosen meal first, or something
// written in), copying last week, the library, and the layout on a phone and a laptop in Day and
// Evening. The same pages run signed in against the database in e2e/tests/meals.spec.ts.
// [MEAL-14][D-98] The days, Add to the plan, Copy last week and the usual lunch week fold (WP-75):
// all closed at first, opened on a tap, today outlined; a day's Add opens Add to the plan with the
// day filled in. Taps wait for React to take the page over (D-110).

// Entries of /dev/meals's week, by their ids there.
const TACOS = 'f2e10000-0000-4000-8000-000000000003';
const CHICKEN_SOUP = 'f2e10000-0000-4000-8000-000000000009';
const FISH_FINGERS = 'f2e10000-0000-4000-8000-000000000010';
const WED = '2026-10-14';

/** Opens a page and waits for React to take it over (D-110). */
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}
const week = (page: Page) => page.getByRole('list', { name: 'Week of Sun, Oct 11' });
const day = (page: Page, date: string) => page.locator(`.fw-meal-day[data-date="${date}"]`);

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
        await open(page, `/dev/meals?theme=${theme}&open=${WED}`);
        await page
          .getByRole('group', { name: 'Wed, Oct 14 snack' })
          .locator('summary')
          .first()
          .click();
        await fits(page, viewport.width);
        await contrastOk(page);
        // [MEAL-15] An entry opened for editing, in place (WP-76).
        await page.goto(`/dev/meals?theme=${theme}&edit=${FISH_FINGERS}`);
        const edit = page.getByRole('form', { name: 'Edit Fish fingers' });
        await expect(edit).toBeVisible();
        // On a laptop its day stacks its meals, so the form isn't squeezed into one meal's column.
        expect((await edit.boundingBox())!.width).toBeGreaterThan(
          Math.min(400, viewport.width * 0.7),
        );
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
  await page.goto(`/dev/meals?open=${WED}`);
  await expect(page.getByRole('heading', { name: 'Week of Sun, Oct 11' })).toBeVisible();
  const days = week(page).locator(':scope > li');
  await expect(days).toHaveCount(7);
  await expect(days.locator(':scope > details > summary')).toHaveText([
    'SundayOct 111 of 4 set',
    'MondayOct 122 of 4 set',
    'TuesdayOct 132 of 4 set',
    'WednesdayOct 14Today3 of 4 set',
    'ThursdayOct 151 of 4 set',
    'FridayOct 161 of 4 set',
    'SaturdayOct 17',
  ]);
  // [MEAL-14] Every meal of Saturday set: a check instead of the count.
  await expect(day(page, '2026-10-17').getByRole('img', { name: 'All set' })).toBeVisible();
  for (const d of ['2026-10-12', '2026-10-13'])
    await day(page, d).locator(':scope > details > summary').click();
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
  // [MEAL-10] A meal for two of the family names both.
  await expect(
    page.getByRole('group', { name: 'Wed, Oct 14 dinner' }).getByRole('listitem').last(),
  ).toContainText('Fish fingersMayaLeo');
  // Each meal of each day can be added to.
  await expect(page.locator('a.fw-meal-slot__add')).toHaveCount(28);
  await day(page, '2026-10-15').locator(':scope > details > summary').click();
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

test('[MEAL-08][MEAL-15] Change: earlier and later as the entry’s place allows, then Edit and Remove', async ({
  page,
}) => {
  await open(page, `/dev/meals?open=${WED}`);
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
  // [MEAL-15] Each entry's Change offers Edit, which opens it in place, and Remove (WP-76).
  const dinner = page.getByRole('group', { name: 'Wed, Oct 14 dinner' });
  await dinner.getByText('Change', { exact: true }).first().click();
  await expect(
    dinner.locator('details[open]').getByRole('link').or(dinner.locator('details[open] button')),
  ).toHaveText(['Later', 'Edit', 'Remove']);
  await expect(
    dinner.getByRole('link', { name: 'Edit Chicken soup, Wed, Oct 14 dinner' }),
  ).toHaveAttribute(
    'href',
    `/admin/meals?week=2026-10-11&edit=${CHICKEN_SOUP}#entry-${CHICKEN_SOUP}`,
  );
  // A meal alone in its slot has the two: Edit and Remove.
  await day(page, '2026-10-11').locator(':scope > details > summary').click();
  const sunday = page.getByRole('group', { name: 'Sun, Oct 11 dinner' });
  await sunday.getByText('Change', { exact: true }).click();
  await expect(
    sunday.locator('details[open]').getByRole('link').or(sunday.locator('details[open] button')),
  ).toHaveText(['Edit', 'Remove']);
  await expect(page.getByRole('form', { name: /^Edit / })).toHaveCount(0);
});

test('[MEAL-15][US-701] Edit opens the entry’s form filled with what was saved: written in, for two', async ({
  page,
}) => {
  await page.goto(`/dev/meals?edit=${FISH_FINGERS}`);
  const form = page
    .getByRole('group', { name: 'Wed, Oct 14 dinner' })
    .getByRole('form', { name: 'Edit Fish fingers' });
  await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue('2026-10-14');
  await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue('dinner');
  await expect(form.getByRole('radio', { name: 'Something else' })).toBeChecked();
  await expect(form.getByRole('textbox', { name: 'Something else' })).toHaveValue('Fish fingers');
  const who = form.getByRole('group', { name: 'For' });
  await expect(who.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expect(who.getByRole('checkbox', { name: 'Maya' })).toBeChecked();
  await expect(who.getByRole('checkbox', { name: 'Leo' })).toBeChecked();
  await expect(who).toContainText('For Maya and Leo.');
  await expect(form.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('');
  await expect(form.locator('input[name=id]')).toHaveValue(FISH_FINGERS);
  // Save works once the page is hydrated; Cancel goes back to the slot.
  await expect(form.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await expect(form.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-11&open=2026-10-14#2026-10-14-dinner',
  );
  // [MEAL-14] The entry's day opened by itself; the page's own "Add to the plan" is still there,
  // folded and empty.
  await expect(day(page, WED).locator(':scope > details')).toHaveAttribute('open', '');
  await expect(page.locator('#add details')).not.toHaveAttribute('open');
  await expect(page.locator('#add input[name=member][value=everyone]')).toBeChecked();
});

test('[MEAL-15][US-701] Edit opens the entry’s form filled with what was saved: a library meal for everyone, with a note', async ({
  page,
}) => {
  await page.goto(`/dev/meals?edit=${TACOS}`);
  const form = page.getByRole('form', { name: 'Edit Tacos' });
  await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue('2026-10-12');
  await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue('dinner');
  await expect(form.getByRole('radio', { name: 'From the library' })).toBeChecked();
  await expect(form.getByRole('combobox', { name: 'From the library' })).toHaveValue(
    'f2d00000-0000-4000-8000-000000000001',
  );
  await expect(form.getByRole('checkbox', { name: 'Everyone' })).toBeChecked();
  await expect(form.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue(
    'Make extra for lunch',
  );
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
  await expect(form.getByRole('group', { name: 'For' }).getByRole('checkbox')).toHaveCount(4);
  await expect(form.getByRole('checkbox', { name: 'Everyone' })).toBeChecked();
});

test('[MEAL-10][US-708] Add to the plan: Everyone, or a tick per person; every one ticked is Everyone', async ({
  page,
}) => {
  await page.goto('/dev/meals?add=1');
  const who = page
    .getByRole('form', { name: 'Add to the plan' })
    .getByRole('group', { name: 'For' });
  const everyone = who.getByRole('checkbox', { name: 'Everyone' });
  const names = await who.locator('label').allInnerTexts();
  expect(names[0]).toBe('Everyone');
  const [first, second] = names.slice(1);
  await expect(who).toContainText('For everyone.');
  await who.getByRole('checkbox', { name: first! }).check();
  await expect(everyone).not.toBeChecked();
  await who.getByRole('checkbox', { name: second! }).check();
  await expect(who).toContainText(`For ${first} and ${second}.`);
  // Ticking Everyone clears the people.
  await everyone.check();
  await expect(who.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(everyone).toBeChecked();
  // Ticking every person is Everyone.
  // (The last tick turns the people back into Everyone, so it is a click, not a check.)
  for (const name of names.slice(1)) await who.getByRole('checkbox', { name }).click();
  await expect(everyone).toBeChecked();
  await expect(who.getByRole('checkbox', { checked: true })).toHaveCount(1);
  // Unticking the last person ticked is Everyone again.
  await who.getByRole('checkbox', { name: first! }).check();
  await who.getByRole('checkbox', { name: first! }).click();
  await expect(everyone).toBeChecked();
});

test('[MEAL-03][US-702] copy last week: keep or replace what this week already has', async ({
  page,
}) => {
  await open(page, '/dev/meals');
  await page.getByRole('region', { name: 'Copy last week' }).locator('summary').click();
  const copy = page.getByRole('form', { name: 'Copy last week' });
  await expect(copy.getByRole('radio', { name: 'Keep it' })).toBeChecked();
  await expect(copy.getByRole('radio', { name: 'Replace it with last week’s' })).not.toBeChecked();
  await expect(copy.getByRole('button', { name: 'Copy last week here' })).toBeVisible();
});

for (const width of [390, 1280]) {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-14][NFR-11] the days fold at ${width} px, ${theme}: all closed, then today opened; outlined either way, nothing sideways, 44 px targets, AA contrast`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, `/dev/meals?theme=${theme}`);
      await expect(week(page).locator(':scope > li > details')).toHaveCount(7);
      await expect(week(page).locator(':scope > li > details[open]')).toHaveCount(0);
      // Closed, a day shows its weekday, date and X of Y set; nothing of its meals.
      await expect(day(page, '2026-10-12').locator(':scope > details > summary')).toHaveText(
        'MondayOct 122 of 4 set',
      );
      await expect(page.getByRole('group', { name: 'Mon, Oct 12 dinner' })).toBeHidden();
      const today = day(page, WED);
      await expect(today).toHaveAttribute('data-today', 'true');
      const outlined = () =>
        today.evaluate((el) => {
          const s = getComputedStyle(el);
          return `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`;
        });
      const closed = await outlined();
      expect(closed, 'today outlined, closed').toMatch(/^2px solid /);
      await fits(page, width);
      await contrastOk(page);
      await today.locator(':scope > details > summary').click();
      const dinner = page.getByRole('group', { name: 'Wed, Oct 14 dinner' });
      await expect(dinner).toContainText('Chicken soup');
      await expect(dinner.getByRole('link', { name: 'Add to Wed, Oct 14 dinner' })).toBeVisible();
      await expect(dinner.getByText('Change', { exact: true }).first()).toBeVisible();
      expect(await outlined(), 'today outlined, open').toBe(closed);
      await fits(page, width);
      await contrastOk(page);
    });

    test(`[MEAL-14][MEAL-04] Add to the plan, Copy last week and the usual week at ${width} px, ${theme}: closed at first, opened on a tap`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, `/dev/meals?theme=${theme}`);
      const add = page.getByRole('region', { name: 'Add to the plan' });
      const copy = page.getByRole('region', { name: 'Copy last week' });
      const usual = page.getByRole('region', { name: 'School lunch' }).locator('details.fw-fold');
      // In order: the days, Add to the plan, Copy last week, then School lunch.
      const order = await page
        .locator('main > section')
        .evaluateAll((s) => s.map((x) => x.querySelector('h1, h2')?.textContent ?? ''));
      expect(order).toEqual(['Meals', 'Add to the plan', 'Copy last week', 'School lunch']);
      // Closed: Add to the plan its header and Add a meal, Copy last week its header, the usual
      // week a line per child.
      await expect(add.locator('details')).not.toHaveAttribute('open');
      await expect(add.locator('summary')).toHaveText('Add to the planAdd a meal');
      await expect(add.getByRole('form', { name: 'Add to the plan' })).toBeHidden();
      await expect(copy.locator('details')).not.toHaveAttribute('open');
      await expect(copy.getByRole('form', { name: 'Copy last week' })).toBeHidden();
      await expect(usual).not.toHaveAttribute('open');
      await expect(usual.locator('.fw-fold__sum > span')).toHaveText([
        'Leo: Mon Bring · Tue Bring · Wed Buy · Thu Bring · Fri Bring',
        'Maya: Mon Bring · Tue Bring · Wed Bring · Thu Bring · Fri Buy',
      ]);
      await expect(page.getByRole('form', { name: 'Leo’s usual lunches' })).toBeHidden();
      await fits(page, width);
      await contrastOk(page);
      // Each opens on a tap.
      await add.locator('summary').click();
      await expect(add.getByRole('form', { name: 'Add to the plan' })).toBeVisible();
      await expect(add.getByText('Add a meal')).toBeHidden();
      await copy.locator('summary').click();
      await expect(copy.getByRole('button', { name: 'Copy last week here' })).toBeVisible();
      await usual.locator('summary').click();
      await expect(page.getByRole('form', { name: 'Leo’s usual lunches' })).toBeVisible();
      await expect(usual.locator('.fw-fold__sum')).toBeHidden();
      await fits(page, width);
      await contrastOk(page);
    });
  }
}

test('[MEAL-14][US-711] Add on a day opens Add to the plan with that day and meal filled in', async ({
  page,
}) => {
  await open(page, '/dev/meals');
  await day(page, '2026-10-15').locator(':scope > details > summary').click();
  const link = page.getByRole('link', { name: 'Add to Thu, Oct 15 lunch' });
  await expect(link).toHaveAttribute(
    'href',
    '/admin/meals?week=2026-10-11&day=2026-10-15&slot=lunch#add',
  );
  // /dev/meals stands in for /admin/meals with the same day and meal (?add=1 is Wednesday's snack).
  await open(page, '/dev/meals?add=1');
  const add = page.getByRole('region', { name: 'Add to the plan' });
  await expect(add.locator('details')).toHaveAttribute('open', '');
  const form = add.getByRole('form', { name: 'Add to the plan' });
  await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue(WED);
  await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue('snack');
  // The days stay folded.
  await expect(week(page).locator(':scope > li > details[open]')).toHaveCount(0);
});

test('[MEAL-14] a day opened by the page: the one just added to or changed', async ({ page }) => {
  await open(page, `/dev/meals?open=2026-10-13`);
  await expect(week(page).locator(':scope > li > details[open]')).toHaveCount(1);
  await expect(day(page, '2026-10-13').locator(':scope > details')).toHaveAttribute('open', '');
  await expect(page.getByRole('group', { name: 'Tue, Oct 13 lunch' })).toContainText(
    'Leftover tacos',
  );
  // A day that isn't this week's opens nothing.
  await open(page, `/dev/meals?open=2026-11-13`);
  await expect(week(page).locator(':scope > li > details[open]')).toHaveCount(0);
});

test('[MEAL-02] the library: each meal, what it’s good for and its recipe; archived ones aside', async ({
  page,
}) => {
  await open(page, '/dev/meals?page=library');
  const meals = page.getByRole('list', { name: 'Meals', exact: true });
  await expect(meals.getByRole('listitem')).toHaveCount(7);
  await expect(meals.getByRole('listitem').filter({ hasText: 'Chicken soup' })).toContainText(
    'Lunch or dinner',
  );
  await expect(meals.getByRole('link', { name: 'Recipe for Tacos' })).toHaveAttribute(
    'href',
    'https://example.com/tacos',
  );
  await unfold(foldOf(page, 'Archived'));
  await expect(page.getByRole('list', { name: 'Archived meals' })).toContainText('Old casserole');
  await unfold(foldOf(page, 'Add a meal'));
  const add = page.getByRole('form', { name: 'Add a meal' });
  await expect(add.getByRole('group', { name: 'Good for' }).getByRole('checkbox')).toHaveCount(4);
  await meals.getByText('Edit Tacos').click();
  await expect(
    page.getByRole('form', { name: 'Edit Tacos' }).getByRole('checkbox', { name: 'Dinner' }),
  ).toBeChecked();
});

// [NFR-18][D-120] The meal library folded (WP-93), as the fold audit draws it: Add a meal to its
// button, Our meals open, Archived to its count; each opened by a tap after React has taken the page
// over (D-110).
for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`The meal library folded on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[NFR-18-h][US-111][MEAL-02][D-120] Add a meal and Archived folded, Our meals open, each opened by a tap, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/meals?page=library&theme=${theme}`);
        const add = foldOf(page, 'Add a meal');
        const archived = foldOf(page, 'Archived');
        await test.step('folded at first: Add a meal’s button, Our meals, Archived’s count', async () => {
          await expect(add).not.toHaveAttribute('open');
          await expect(archived).not.toHaveAttribute('open');
          await expect(add.locator(':scope > summary .fw-fold__closed')).toHaveText('Add a meal');
          await expect(archived.locator(':scope > summary .fw-fold__sum')).toHaveText('1 archived');
          await expect(page.getByRole('list', { name: 'Meals', exact: true })).toBeVisible();
          await expect(page.getByRole('form', { name: 'Add a meal' })).toBeHidden();
          await fits(page, viewport.width);
          await contrastOk(page);
        });
        await test.step('each opened by a tap', async () => {
          await add.locator(':scope > summary').click();
          await expect(page.getByRole('form', { name: 'Add a meal' })).toBeVisible();
          await expect(add.locator(':scope > summary .fw-fold__closed')).toBeHidden();
          await archived.locator(':scope > summary').click();
          await expect(page.getByRole('button', { name: 'Restore Old casserole' })).toBeVisible();
          await fits(page, viewport.width);
          await contrastOk(page);
        });
      });
    }
  });
}

test('[NFR-18-i][D-120] Archived comes back open after an archive; with no meal yet, Add a meal is open', async ({
  page,
}) => {
  await open(page, '/dev/meals?page=library&open=archived');
  await expect(foldOf(page, 'Archived')).toHaveAttribute('open', '');
  await expect(foldOf(page, 'Add a meal')).not.toHaveAttribute('open');
  await open(page, '/dev/meals?page=library&state=empty');
  await expect(foldOf(page, 'Add a meal')).toHaveAttribute('open', '');
});
