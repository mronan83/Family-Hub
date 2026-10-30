import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { floors } from '../support/floors';

// [MEAL-22][MEAL-30][US-717][US-723] Asking, ticking off and taking off on the board's Groceries
// (WP-107, D-149) on /dev/board at the board's 1920×1080: Ask for something (who, the tiles, the brand
// row, Something else on the board's keyboard), the Asked for card with Call off, 5 waiting, each
// thing's sheet (Got it, Take it off the list, a child's limit), the Undo bar and Got today. The dev
// board answers as POST /api/groceries would (fixtureGroceriesPost); the database's own rules are
// pgTAP's (610_board_grocery_asks), and the real board's e2e's (board-grocery-asks.spec.ts).
test.use({ viewport: { width: 1920, height: 1080 } });

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const screen = (page: Page) => page.getByRole('region', { name: /^Groceries/ });
const dialog = (page: Page) => page.getByRole('dialog');
const asked = (page: Page) => screen(page).getByRole('region', { name: 'Asked for' });
const gotToday = (page: Page) => screen(page).getByRole('region', { name: 'Got today' });
const bar = (page: Page) => screen(page).locator('.fw-bgroc__bar');

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
const fit = (page: Page) => page.evaluate(floors, { buttons: '.fw-board', text: '.fw-today' });

async function openGroceries(page: Page, query: string) {
  await page.goto(`/dev/board?${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await people(page)
    .getByRole('button', { name: /^Groceries/ })
    .click();
  await expect(screen(page)).toBeVisible();
}

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-22-h] Ask for something, the Asked for card and Got today, 28 px and 56 px, in ${theme}`, async ({
    page,
  }) => {
    await openGroceries(page, `groceries=1&theme=${theme}`);
    // The rail says how many wait for a grown-up.
    await expect(people(page).getByRole('button', { name: /^Groceries/ })).toContainText('2');
    await expect(asked(page).getByRole('listitem')).toHaveText([
      /Popcorn\s*Waiting for a grown-up\s*Call off/,
      /Ice cream\s*Waiting for a grown-up\s*Call off/,
      /Greek yogurt · Chobani\s*On the list/,
      /Chocolate cereal\s*Not this time/,
    ]);
    await expect(gotToday(page).getByRole('listitem')).toHaveText([
      /Coffee · Peet's\s*Sam ·.*Untick/,
    ]);
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);

    await screen(page).getByRole('button', { name: 'Ask for something' }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Ask for something' })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Maya' }).click();
    const tiles = dialog(page).getByRole('group', { name: 'Things to ask for' });
    await expect(tiles.getByRole('button')).toHaveCount(12);
    await expect(tiles.getByRole('button', { name: /^Milk/ })).toContainText('On the list');
    await expect(tiles.getByRole('button', { name: /Something else/ })).toBeVisible();
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
  });
}

test('[MEAL-22-h] a tile with brands shows its brand row; asking says it waits; Call off takes it back', async ({
  page,
}) => {
  await openGroceries(page, 'groceries=1');
  await screen(page).getByRole('button', { name: 'Ask for something' }).click();
  await dialog(page).getByRole('button', { name: 'Leo' }).click();
  await dialog(page)
    .getByRole('button', { name: /^Sourdough/ })
    .click();
  const brands = dialog(page).getByRole('group', { name: 'Brand of Sourdough' });
  await expect(brands.getByRole('button')).toHaveText([
    /Dave's Killer Bread · last time/,
    'No brand',
  ]);
  await expect(brands.getByRole('button', { name: /Dave's Killer Bread/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog(page)
    .getByRole('button', { name: "Ask for Sourdough · Dave's Killer Bread" })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  // Sourdough was on the list: Leo is added to it, and nothing waits.
  await expect(bar(page)).toHaveText('Already on the list! We added that you asked.');

  await screen(page).getByRole('button', { name: 'Ask for something' }).click();
  await dialog(page).getByRole('button', { name: 'Leo' }).click();
  await dialog(page)
    .getByRole('button', { name: /^Coffee/ })
    .click();
  await dialog(page)
    .getByRole('button', { name: /^No brand/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Ask for Coffee', exact: true }).click();
  await expect(bar(page)).toHaveText('Asked for Coffee, Leo. A grown-up will say OK.');
  const coffee = asked(page).getByRole('listitem').filter({ hasText: 'Coffee' });
  await expect(coffee).toContainText('Waiting for a grown-up');
  await coffee.getByRole('button', { name: /^Call off Coffee/ }).click();
  await expect(asked(page).getByRole('listitem').filter({ hasText: 'Coffee' })).toHaveCount(0);
});

test('[MEAL-22-h] Something else on the board’s keyboard, with matches; an adult’s ask goes on the list', async ({
  page,
}) => {
  await openGroceries(page, 'groceries=1');
  await screen(page).getByRole('button', { name: 'Ask for something' }).click();
  await dialog(page).getByRole('button', { name: 'Alex' }).click();
  await dialog(page)
    .getByRole('button', { name: /Something else/ })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'What would you like, Alex?' }),
  ).toBeVisible();
  const keys = dialog(page).getByRole('group', { name: 'Keyboard' });
  for (const k of ['Y', 'O', 'G']) await keys.getByRole('button', { name: k, exact: true }).click();
  await expect(dialog(page).locator('.fw-bgroc__field')).toHaveText('Yog');
  await expect(dialog(page).getByRole('group', { name: 'Matches' }).getByRole('button')).toHaveText(
    ['Yogurt tubes', 'Greek yogurt · on the list'],
  );
  await keys.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page).locator('.fw-bgroc__field')).toHaveText('Yo');
  for (const k of ['G', 'U', 'R', 'T'])
    await keys.getByRole('button', { name: k, exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Ask for it' }).click();
  await expect(bar(page)).toHaveText('Added Yogurt to the list.');
  await expect(screen(page).locator('.fw-bgroc__nm', { hasText: /^Yogurt$/ })).toHaveCount(1);
  expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
});

test('[MEAL-22-h] with 5 waiting, a child’s tiles grey out and say why', async ({ page }) => {
  await openGroceries(page, 'groceries=full');
  await screen(page).getByRole('button', { name: 'Ask for something' }).click();
  await dialog(page).getByRole('button', { name: 'Maya' }).click();
  await expect(dialog(page)).toContainText(
    'You have 5 asks waiting. Call one off, or wait for a grown-up.',
  );
  await expect(dialog(page).getByRole('button', { name: /Something else/ })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: /^Coffee/ })).toBeDisabled();
  // What is on the list already only adds her to it, so it stays.
  await expect(dialog(page).getByRole('button', { name: /^Milk/ })).toBeEnabled();
  await contrastOk(page);
});

for (const theme of ['day', 'evening'] as const) {
  test(`[MEAL-30-d] a thing’s sheet: who, Got it, Take it off with Undo, Got today with Untick, in ${theme}`, async ({
    page,
  }) => {
    await openGroceries(page, `groceries=1&theme=${theme}`);
    await screen(page)
      .getByRole('button', { name: /^Paper towels · Kirkland Signature: got it/ })
      .click();
    await expect(dialog(page).getByRole('heading', { name: /Paper towels/ })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Got it' })).toBeDisabled();
    // Leo didn't ask for it: he may tick it, not take it off.
    await dialog(page).getByRole('button', { name: 'Leo' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Got it' })).toBeEnabled();
    await expect(dialog(page).getByRole('button', { name: 'Take it off the list' })).toBeDisabled();
    await expect(dialog(page)).toContainText('Only a grown-up can take this off.');
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
    await contrastOk(page);
    await dialog(page).getByRole('button', { name: 'Sam' }).click();
    await dialog(page).getByRole('button', { name: 'Take it off the list' }).click();
    await expect(bar(page)).toContainText('Took Paper towels off the list.');
    await contrastOk(page);
    await expect(screen(page).getByRole('button', { name: /^Paper towels/ })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Undo' }).click();
    await expect(screen(page).getByRole('button', { name: /^Paper towels/ })).toHaveCount(1);

    // Sam's face is still picked: the next thing is two taps.
    await screen(page)
      .getByRole('button', { name: /^Dish soap: got it/ })
      .click();
    await expect(dialog(page).getByRole('button', { name: 'Sam' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog(page).getByRole('button', { name: 'Got it' }).click();
    await expect(bar(page)).toHaveText('Got Dish soap.');
    await expect(gotToday(page).getByRole('listitem').first()).toContainText('Dish soap');
    await gotToday(page).getByRole('button', { name: 'Untick Dish soap' }).click();
    await expect(screen(page).getByRole('button', { name: /^Dish soap: got it/ })).toHaveCount(1);
  });
}

test('[MEAL-30-d] a child takes off what only they asked for', async ({ page }) => {
  await openGroceries(page, 'groceries=1');
  await screen(page)
    .getByRole('button', { name: /^Apples ×6: got it/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Leo' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Take it off the list' })).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Take it off the list' }).click();
  await expect(bar(page)).toContainText('Took Apples off the list.');
});

test.describe('a long list, by touch', () => {
  test.use({ hasTouch: true });

  test('[MEAL-22-h][MEAL-30-d] 35 things: each name and brand in two lines at most, on the list and the cards; the last reached by touch', async ({
    page,
  }) => {
    await openGroceries(page, 'groceries=long');
    await expect(screen(page)).toContainText('35 to get');
    const over = await screen(page)
      // The list's names, and (WP-107 follow-up) those on the Asked for and Got today cards.
      .locator('.fw-bgroc__nm, .fw-bgroc__ask-nm, .fw-bgroc__got-nm')
      .evaluateAll((els) =>
        els
          .filter((e) => {
            const line = parseFloat(getComputedStyle(e).lineHeight);
            return Math.round(e.getBoundingClientRect().height / line) > 2;
          })
          .map((e) => e.textContent),
      );
    expect(over).toEqual([]);
    // The screen scrolls inside itself; the list's last thing is below the fold until it does.
    const scroller = page.locator('.fw-today__screen');
    expect(
      await scroller.evaluate((s) => ({
        overflow: getComputedStyle(s).overflowY,
        more: s.scrollHeight > s.clientHeight,
      })),
    ).toEqual({ overflow: 'auto', more: true });
    const last = screen(page).getByRole('button', { name: /^Trash bags: got it/ });
    await last.tap();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: /Trash bags/ }),
    ).toBeVisible();
    expect(await fit(page)).toEqual({ wide: 1920, small: [], tiny: [] });
  });
});
