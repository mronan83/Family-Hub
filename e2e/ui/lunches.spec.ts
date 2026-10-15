import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { floors } from '../support/floors';

// [MEAL-09][MEAL-11][US-707][D-95] Next week's lunches picked on the board (WP-49), with made-up
// families and menus, no database: Lunches on /dev/board (fixtureLunches: Leo's week has a buy day
// with picks, a change waiting for a parent, a buy day with nothing picked, a day Sam kept and a
// bring day) and the children's changes waiting on Today on /dev/admin?lunches=1; the picks and a
// change waiting on Meals are in lunch-week.spec.ts (WP-74). The same against the database, from a paired
// board to the admin app, runs in e2e/tests/lunches.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const week = (page: Page) => page.getByRole('list', { name: /’s week$/ });
/** A day of the week by its weekday: Mon … Fri. */
const day = (page: Page, n: number) => week(page).getByRole('listitem').nth(n);

test.describe('the board', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  /** Opens Leo's lunches from his item, on the week after this one (every day of it still open). */
  async function openLeo(page: Page) {
    await page.goto('/dev/board?lunches=1');
    await page.getByRole('button', { name: 'Open Pick next week’s lunches for Leo' }).click();
    await expect(page.getByRole('heading', { name: /^Leo’s lunches/, level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(week(page).getByRole('listitem')).toHaveCount(5);
  }

  test('[MEAL-09][US-707] an item opens a child’s coming week: Buy or Bring a day, with how each change stands', async ({
    page,
  }) => {
    await openLeo(page);
    await expect(week(page).locator('h3')).toHaveText([/^Mon/, /^Tue/, /^Wed/, /^Thu/, /^Fri/]);
    // Monday: Buy, with his picks in place of the options.
    await expect(day(page, 0).getByRole('button', { name: /Buy$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(day(page, 0)).toContainText('Chicken wrap · Apple slices, Grapes · 1% milk');
    // Tuesday: his change to Buy waits for a parent, shown as he asked.
    await expect(day(page, 1)).toContainText('Waiting for a parent');
    await expect(day(page, 1).getByRole('button', { name: /Buy$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Wednesday: Buy with nothing picked; Thursday: Sam kept Buy; Friday: Bring.
    await expect(day(page, 2).getByRole('button', { name: 'Pick your lunch' })).toBeVisible();
    await expect(day(page, 3)).toContainText('Sam kept Buy');
    await expect(day(page, 4).getByRole('button', { name: /Bring$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // A change waits: Friday to Buy, then on to the day's choices.
    await day(page, 4).getByRole('button', { name: /Buy$/ }).click();
    await expect(page.getByRole('dialog', { name: /^Leo’s lunch on Fri/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(day(page, 4)).toContainText('Waiting for a parent');
    await expect(page.getByText('Sent. A parent will look at it.')).toBeVisible();
    // Back to Bring, as the day is: nothing waits.
    await day(page, 4)
      .getByRole('button', { name: /Bring$/ })
      .click();
    await expect(day(page, 4)).not.toContainText('Waiting for a parent');
  });

  test('[MEAL-11][US-707] a buy day’s choices: one where it says “Choice of”, any number elsewhere', async ({
    page,
  }) => {
    await openLeo(page);
    await day(page, 2).getByRole('button', { name: 'Pick your lunch' }).click();
    const dialog = page.getByRole('dialog', { name: /^Leo’s lunch on Wed/ });
    await expect(dialog.locator('h3')).toHaveText([
      'EntreePick one',
      'Fruits & VegetablesPick any',
      'MilkPick one',
    ]);
    await expect(dialog.getByText('Still to pick: Entree and Milk')).toBeVisible();
    const option = (name: string) => dialog.getByRole('button', { name, exact: true });
    await option('Cheese pizza').click();
    await option('Chicken wrap with Tortilla chips').click();
    await expect(option('Cheese pizza')).toHaveAttribute('aria-pressed', 'false');
    await expect(option('Chicken wrap with Tortilla chips')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // [WP-78] Then a milk, then fruits: the entree and the milk stay picked.
    await option('Chocolate milk').click();
    await expect(option('Chicken wrap with Tortilla chips')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await option('Apple slices').click();
    await option('Grapes').click();
    for (const name of [
      'Chicken wrap with Tortilla chips',
      'Chocolate milk',
      'Apple slices',
      'Grapes',
    ])
      await expect(option(name), `WP-78 ${name} still picked`).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    await expect(dialog.getByText(/Still to pick/)).toHaveCount(0);
    expect(
      await page.evaluate(floors, { buttons: '[role="dialog"]', text: '[role="dialog"]' }),
    ).toEqual({ wide: 1920, small: [], tiny: [] });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(day(page, 2)).toContainText(
      'Chicken wrap · Apple slices, Grapes · Chocolate milk',
    );
    await expect(day(page, 2)).toContainText('Waiting for a parent');
  });

  test('[MEAL-09][US-707] Done checks the item off for the child, and goes back', async ({
    page,
  }) => {
    await openLeo(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: /’s lunches/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Open Pick next week’s lunches for Leo' }),
    ).toHaveCount(0);
  });

  test('[MEAL-09] an earlier day, and today after the cut-off, are locked', async ({ page }) => {
    await page.goto('/dev/board?lunches=1');
    await people(page).getByRole('button', { name: /^Leo/ }).click();
    await page.getByRole('button', { name: 'Pick lunches' }).click();
    await expect(page.getByRole('heading', { name: /^Leo’s lunches/, level: 2 })).toBeVisible();
    // This week (on a weekend, the week after it): any day up to today is locked.
    const locked = week(page).locator('[data-state="locked"]');
    for (const d of await locked.all())
      await expect(d.getByRole('button', { name: /Buy$|Bring$/ }).first()).toBeDisabled();
    // Lunches from Meals too, with the other children a tap away.
    await people(page).getByRole('button', { name: 'Meals', exact: true }).click();
    await page.getByRole('button', { name: 'Lunches' }).click();
    await page
      .getByRole('list', { name: 'Whose lunches' })
      .getByRole('button', { name: 'Maya', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: /^Maya’s lunches/, level: 2 })).toBeVisible();
  });

  for (const theme of ['day', 'evening'] as const) {
    test(`[BRD-03] Lunches keep the board’s floors and AA contrast, ${theme}`, async ({ page }) => {
      await page.goto(`/dev/board?lunches=1&theme=${theme}`);
      await page.getByRole('button', { name: 'Open Pick next week’s lunches for Leo' }).click();
      await page.getByRole('button', { name: 'Next week' }).click();
      await expect(week(page).getByRole('listitem')).toHaveCount(5);
      expect(await page.evaluate(floors, { buttons: '.fw-board', text: '.fw-today' })).toEqual({
        wide: 1920,
        small: [],
        tiny: [],
      });
      await contrastOk(page);
    });
  }
});

test.describe('Today in the admin app', () => {
  test('[MEAL-09][US-707] the children’s lunch changes wait, a group a child, with Approve and Keep', async ({
    page,
  }) => {
    await page.goto('/dev/admin?lunches=1');
    const leo = page.getByRole('region', { name: 'Leo’s lunch changes' });
    const maya = page.getByRole('region', { name: 'Maya’s lunch changes' });
    await expect(page.locator('.fw-lunchq__child')).toHaveCount(2);
    await expect(leo).toContainText('1 change · on the board');
    await expect(leo.getByRole('button', { name: /^Approve (both|all)/ })).toHaveCount(0);
    await expect(leo.getByRole('button', { name: /^Keep Buy for Leo/ })).toBeVisible();
    await expect(maya).toContainText('2 changes');
    await expect(maya.getByRole('button', { name: 'Approve both' })).toBeVisible();
    await expect(maya.locator('.fw-lunchq__day').first()).toContainText('usually Bring');
    await expect(maya.locator('.fw-lunchq__day').first()).toContainText(
      'Picked: Cheese pizza · Apple slices, Baby carrots · 1% milk',
    );
    await expect(maya.locator('.fw-lunchq__day').nth(1)).toContainText(
      'Maya’s picks for the day are dropped if this is approved.',
    );
    // The check-offs stay below, under their own heading.
    await expect(page.getByRole('heading', { name: 'Check-offs', level: 3 })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Waiting for you' }).getByRole('listitem'),
    ).toHaveCount(2);
  });

  for (const [width, theme] of [
    [390, 'day'],
    [1280, 'evening'],
  ] as const) {
    test(`[MEAL-09][NFR-11] lunch changes at ${width} px, ${theme}: nothing sideways, 44 px buttons, AA contrast`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/admin?lunches=1&theme=${theme}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('.fw-lunchq button')]
          .filter((b) => b.getBoundingClientRect().height < 44)
          .map((b) => b.textContent),
      );
      expect(small).toEqual([]);
      await contrastOk(page);
    });
  }
});
