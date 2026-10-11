import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, test, type Page } from '@playwright/test';

// [MEAL-06][US-705] Meals on the board (WP-28, D-80) on /dev/board, at the board's 1920×1080: today's
// meals above Today's list on the home screen (breakfast, snacks, lunch with each child's school lunch,
// dinner), none on a day with nothing planned or when the layout hides them; the Meals screen in the
// rail, the week a column a day, today marked, read-only; and on a person's own screen, theirs. The
// made-up week is fixtureMeals: today Leo buys (the school's menu says what) and Maya brings leftovers.
// The same on a real board, a change reaching it through Realtime, runs in e2e/tests/board-meals.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const meals = (page: Page) => page.getByRole('region', { name: 'Today’s meals', exact: true });
const week = (page: Page) => page.getByRole('table');

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Buttons under 56 px, text under 28 px and the page's width, for BRD-03 and NFR-11. */
const fit = (page: Page) =>
  page.evaluate(() => {
    const small = [...document.querySelectorAll('.fw-board button')]
      .filter((b) => b.getBoundingClientRect().height < 56)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    const tiny = [...document.querySelectorAll('.fw-today *')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
      .map((el) => el.textContent?.trim());
    return { wide: document.documentElement.scrollWidth, small, tiny };
  });

/** Each child's lunch in a place, in order, as it is read out. */
async function lunchIs(scope: Locator, names: string[]) {
  await expect(scope.locator('li')).toHaveCount(names.length);
  for (const [i, name] of names.entries())
    await expect(scope.locator('li').nth(i)).toHaveAccessibleName(name);
}

/** Words that run out of their box in the week's narrow days. */
const spills = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.fw-mweek .fw-meals__name')]
      .filter((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return (
          range.getBoundingClientRect().right > el.closest('td')!.getBoundingClientRect().right
        );
      })
      .map((el) => el.textContent),
  );

test('[MEAL-06][US-705] the home screen: today’s four meals, and each child buying or bringing lunch', async ({
  page,
}) => {
  await page.goto('/dev/board');
  await expect(meals(page)).toBeVisible();
  await expect(meals(page).locator('dt')).toHaveText(['Breakfast', 'Snack', 'Lunch', 'Dinner']);
  await expect(meals(page).locator('[data-slot="breakfast"] dd')).toHaveText('Porridge');
  await expect(meals(page).locator('[data-slot="snack"] li')).toHaveText([
    'Apple slices',
    'Crackers',
  ]);
  await expect(meals(page).getByRole('listitem', { name: 'Crackers, for Maya' })).toBeVisible();
  // Maya brings hers: the leftovers planned for her lunch go with her, not on a line of their own.
  await lunchIs(meals(page).locator('[data-slot="lunch"]'), [
    'Leo buys lunch: Cheese Pizza, Green Beans, Milk',
    'Maya brings lunch: Leftover spaghetti',
  ]);
  await expect(meals(page).locator('[data-slot="lunch"] li').first()).toContainText('Buys');
  await expect(meals(page).locator('[data-slot="lunch"] li').last()).toContainText('Brings');
  await expect(meals(page).locator('[data-slot="dinner"] dd')).toHaveText('Spaghetti');
  // [US-705] A picture with each meal: the library meal's icon, else the meal of the day's.
  await expect(meals(page).locator('.fw-meals__entry svg.fw-meals__icon')).toHaveCount(4);
  // Above Today's list, which keeps its heading and its rows.
  const [m, l] = await Promise.all([
    meals(page).boundingBox(),
    page.getByRole('heading', { name: 'Today’s list', level: 2 }).boundingBox(),
  ]);
  expect(l!.y).toBeGreaterThan(m!.y + m!.height - 1);
  await expect(page.locator('.fw-dash__list li[data-row]').first()).toBeVisible();
});

test('[MEAL-06] nothing planned, or a layout that hides them: no meals, and Today’s list has the column', async ({
  page,
}) => {
  await page.goto('/dev/board?meals=none');
  await expect(page.getByRole('heading', { name: 'Today’s list', level: 2 })).toBeVisible();
  await expect(meals(page)).toHaveCount(0);
  // [BRD-05] Turned off on Boards (the cards listed show; Today's meals isn't among them).
  await page.goto('/dev/board?cards=goals,waiting,coming');
  await expect(page.getByRole('heading', { name: 'Today’s list', level: 2 })).toBeVisible();
  await expect(meals(page)).toHaveCount(0);
  await expect(page.locator('.fw-dash__cards > section h2')).toHaveText([
    'Goals',
    'Waiting for a parent',
    'Coming up',
  ]);
});

test('[MEAL-06][US-705] the Meals screen: the week a day a column, today marked, school lunch, read-only', async ({
  page,
}) => {
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: 'Meals', exact: true }).click();
  await expect(people(page).getByRole('button', { name: 'Meals', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('heading', { name: /^Meals this week/, level: 2 })).toBeVisible();
  await expect(week(page).getByRole('columnheader')).toHaveCount(7);
  const today = week(page).locator('th[aria-current="date"]');
  await expect(today).toHaveCount(1);
  await expect(today).toContainText('Today');
  await expect(week(page).getByRole('rowheader')).toHaveText([
    'Breakfast',
    'Snack',
    'Lunch',
    'Dinner',
    'School lunch',
  ]);
  // A dinner every day, and today's column the one that stands out.
  const dinners = week(page).locator('tr[data-slot="dinner"] td');
  await expect(dinners).toHaveCount(7);
  await expect(dinners.locator('.fw-meals__entry')).toHaveCount(7);
  await expect(week(page).locator('tr[data-slot="dinner"] td[aria-current="date"]')).toHaveText(
    'Spaghetti',
  );
  // School lunch: today's buying and bringing; the weekend says so.
  const school = week(page).locator('tr[data-slot="school"]');
  await lunchIs(school.locator('td[aria-current="date"]'), [
    'Leo buys lunch: Cheese Pizza, Green Beans, Milk',
    'Maya brings lunch: Leftover spaghetti',
  ]);
  await expect(school).toContainText('Weekend');
  // [US-705] Read-only: nothing in the week to tap.
  await expect(week(page).getByRole('button')).toHaveCount(0);
  await expect(week(page).getByRole('link')).toHaveCount(0);
  expect(await spills(page)).toEqual([]);
});

test('[MEAL-06] on Maya’s own screen: what’s for everyone and what’s hers, not Leo’s lunch', async ({
  page,
}) => {
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: /^Maya/ }).click();
  const card = page.getByRole('region', { name: 'Today’s meals', exact: true });
  await expect(card.locator('dt')).toHaveText(['Breakfast', 'Snack', 'Lunch', 'Dinner']);
  await expect(card.locator('[data-slot="snack"] li')).toHaveText(['Apple slices', 'Crackers']);
  await lunchIs(card.locator('[data-slot="lunch"]'), ['Maya brings lunch: Leftover spaghetti']);
  // Leo has his lunch, and not Maya's crackers.
  await people(page).getByRole('button', { name: /^Leo/ }).click();
  await expect(card.locator('[data-slot="snack"] li')).toHaveText(['Apple slices']);
  await lunchIs(card.locator('[data-slot="lunch"]'), [
    'Leo buys lunch: Cheese Pizza, Green Beans, Milk',
  ]);
});

for (const theme of ['day', 'evening'] as const) {
  test(`[BRD-03][NFR-11] meals in ${theme}: 56 px targets, 28 px text, AA contrast, no sideways scroll`, async ({
    page,
  }) => {
    await page.goto(`/dev/board?theme=${theme}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(meals(page)).toBeVisible();
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
    await people(page).getByRole('button', { name: 'Meals', exact: true }).click();
    await expect(week(page)).toBeVisible();
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
  });
}
