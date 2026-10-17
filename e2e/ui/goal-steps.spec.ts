import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-17][RWD-18] A goal done by a time, and goals that pay in steps (WP-81, the approved mockups),
// with the made-up family and no database: on /dev/goals the form's time, steps and weights, Goals
// with Maya's goals in steps (?list=steps), and a goal's weeks with the step each paid; on
// /dev/board Maya's card going, won at a step and weighted (?steps=), the clock held on Thursday,
// Oct 15, 2026. At the admin app's 390 and 1280 px and the board's sizes, in Day and Evening.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
/** No sideways scroll, and every control at least 44 px tall (NFR-11). */
async function fits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main button, main a.fw-btn, main select, main input:not([type=hidden]):not(.fw-visually-hidden)',
      ),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return r.height > 0 && r.height < 44 && type !== 'radio' && type !== 'checkbox';
      })
      .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
  );
  expect(small).toEqual([]);
}
const hydrated = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-18-l][NFR-11] the time, the steps and the weights fit a ${device} in ${theme}`, async ({
        page,
      }) => {
        for (const path of ['list=steps', 'form=steps', 'form=weighted', 'form=count-steps']) {
          await test.step(path, async () => {
            await page.goto(`/dev/goals?${path}&theme=${theme}`);
            if (path === 'form=steps')
              await page.locator('summary').filter({ hasText: 'Weeks' }).click();
            await fits(page, viewport.width);
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test.describe('the admin app', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('[RWD-18-l][RWD-17-g] the form: by a time, and steps by days missed that set the misses allowed', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=steps');
    await hydrated(page);
    await expect(page.getByRole('radio', { name: 'By', exact: true })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Time' })).toHaveValue('18:00');
    await expect(page.getByText(/A tick after the time still completes the chore/)).toBeVisible();
    const steps = page.getByRole('group', { name: 'Pay in steps' });
    await expect(
      steps.getByRole('checkbox', { name: 'Pay less for a week with misses' }),
    ).toBeChecked();
    await expect(steps.getByLabel('1 missed')).toHaveValue('10');
    await expect(steps.getByLabel('2 missed')).toHaveValue('5');
    await expect(steps.getByLabel('3 missed')).toHaveValue('');
    await expect(page.getByText('Set by the steps: the lowest is 2 missed')).toBeVisible();
    // A third step lowers the misses allowed to 3.
    await steps.getByLabel('3 missed').fill('2');
    await expect(page.getByText('Set by the steps: the lowest is 3 missed')).toBeVisible();
    // By each chore's due time, then any time: the time field goes.
    await page.getByRole('radio', { name: 'By each chore’s due time' }).check();
    await expect(page.getByRole('textbox', { name: 'Time' })).toHaveCount(0);
    await expect(
      page.getByText(/A chore without a due time counts any time that day/),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Any time that day' }).check();
    await expect(page.getByText(/still completes the chore/)).toHaveCount(0);
    // Unticked, the steps go and the misses allowed are chosen again.
    await steps.getByRole('checkbox').uncheck();
    await expect(steps.getByLabel('1 missed')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Misses allowed each week' })).toBeVisible();
  });

  test('[RWD-18-l] the form: two rules weighted 60% and 40%, steps by %, reached at 100%', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=weighted');
    await hydrated(page);
    const weights = page.getByRole('spinbutton', { name: /^Weight of rule/ });
    await expect(weights).toHaveCount(2);
    await expect(weights.nth(0)).toHaveValue('60');
    await expect(weights.nth(1)).toHaveValue('40');
    await expect(page.getByTestId('weights-total')).toContainText('Weights total 100%');
    await expect(page.getByRole('group', { name: 'It’s reached when' })).toHaveCount(0);
    await weights.nth(1).fill('30');
    await expect(page.getByTestId('weights-total')).toContainText('Weights total 90%');
    const steps = page.getByRole('group', { name: 'Pay in steps' });
    await expect(steps.getByText('100%', { exact: true })).toBeVisible();
    await expect(steps.getByLabel('At %').first()).toHaveValue('75');
    // Without steps, the weights go and all or any is back.
    await steps.getByRole('checkbox').uncheck();
    await expect(weights).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'It’s reached when' })).toBeVisible();
  });

  test('[RWD-18-l] the form: steps by number on a one-off goal, which needs an end date', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=count-steps');
    await hydrated(page);
    const steps = page.getByRole('group', { name: 'Pay in steps' });
    await expect(steps.getByText('20 (the target)')).toBeVisible();
    await expect(steps.getByLabel('At').first()).toHaveValue('15');
    await expect(steps.getByLabel('Pays').first()).toHaveValue('10');
    await expect(steps).toContainText('A goal in steps needs an end date.');
  });

  test('[RWD-18-l][RWD-18-k] Goals: a week’s steps and a late day; a one-off goal’s steps; each week’s step paid', async ({
    page,
  }) => {
    await page.goto('/dev/goals?list=steps');
    const homework = page
      .getByRole('list', { name: 'Goals in play' })
      .getByRole('listitem')
      .filter({ hasText: 'Homework before 6 pm' });
    await expect(homework.getByTestId('goal-steps')).toHaveText(
      'Steps: All 5: 20 · 4: 10 · 3: 5 · On course for 10 points.',
    );
    await expect(homework).toContainText('Wednesday was after 6:00 pm.');
    await expect(homework).toContainText('Pays 20, 10 or 5 points');
    const books = page
      .getByRole('list', { name: 'Goals in play' })
      .getByRole('listitem')
      .filter({ hasText: 'Read 20 books' });
    await expect(books.getByTestId('goal-steps')).toHaveText(
      'Steps: 20: 20 · 15: 10 · 10: 5 · 10 points so far.',
    );
    await page.goto('/dev/goals?form=steps');
    await page.locator('summary').filter({ hasText: 'Weeks' }).click();
    const rows = page.locator('ul[aria-labelledby="goal-weeks-heading"] > li');
    await expect(rows.nth(1)).toContainText('Won at 1 missed: 10 points');
    await expect(rows.nth(1)).toContainText('+10');
    await expect(rows.nth(3)).toContainText('Won, all of it: 20 points');
    await expect(page.locator('summary').filter({ hasText: 'Weeks' })).toContainText(
      '35 points paid',
    );
  });
});

// The board -----------------------------------------------------------------------------------

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
/** Thursday, Oct 15, 2026, 11 am in the family's zone (D-110: no real clock). */
const THURSDAY = new Date('2026-10-15T15:00:00Z');
async function board(page: Page, query: string) {
  await page.clock.setFixedTime(THURSDAY);
  await page.goto(`/dev/board${query}`);
  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
}
const card = (page: Page) =>
  page.getByRole('region', { name: 'Goals' }).locator('[data-goal="g-steps"]');
const smallText = (page: Page) =>
  card(page).evaluate((el) =>
    [...el.querySelectorAll('*')]
      .filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()),
      )
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 28)
      .map((e) => `${e.textContent!.trim()}: ${getComputedStyle(e).fontSize}`),
  );
const chips = (page: Page) => card(page).getByRole('list', { name: 'Steps' }).getByRole('listitem');

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test.describe(`the board at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-18-l][NFR-03] Maya’s goal in steps going, won at a step and weighted, in ${theme}: 28 px text, AA contrast`, async ({
        page,
      }) => {
        for (const kind of ['going', 'won', 'weighted'] as const) {
          await test.step(kind, async () => {
            await board(page, `?steps=${kind}&theme=${theme}`);
            await expect(card(page)).toBeVisible();
            expect(await smallText(page)).toEqual([]);
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test.describe('the board’s card', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('[RWD-18-l][RWD-18-k][US-412] going: the steps, the one in reach, and a day ticked after 6 pm', async ({
    page,
  }) => {
    await board(page, '?steps=going');
    await expect(chips(page)).toHaveText(['All 5: 20', '4: 10', '3: 5']);
    await expect(chips(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(card(page)).toContainText('Wednesday was after 6:00 pm. On course for 10 points.');
    const days = card(page).getByRole('list', { name: 'This week’s days' }).getByRole('listitem');
    await expect(days.nth(2)).toHaveAttribute('data-mark', 'late');
    await expect(days.nth(2)).toHaveAttribute('aria-label', 'Wed: missed, ticked after the time');
  });

  test('[RWD-18-l][RWD-18-k][US-413] won at a step: "Won this week! 10 points." and its chip', async ({
    page,
  }) => {
    await board(page, '?steps=won');
    await expect(card(page).locator('.fw-goal-line[data-kind="won"]')).toHaveText(
      'Won this week! 10 points.',
    );
    await expect(chips(page)).toHaveText(['All 4: 20', '3: 10', '2: 5']);
    await expect(chips(page).nth(1)).toHaveAttribute('aria-current', 'step');
  });

  test('[RWD-18-l] weighted: a meter for each rule with its weight, the week’s %, and the step reached', async ({
    page,
  }) => {
    await board(page, '?steps=weighted');
    await expect(card(page).getByRole('progressbar')).toHaveCount(2);
    await expect(card(page).getByRole('progressbar').first()).toHaveAccessibleName(/· 60%$/);
    await expect(card(page)).toContainText('77% this week');
    await expect(chips(page)).toHaveText(['100%: 20', '75%: 10', '50%: 5']);
    await expect(chips(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(card(page)).toContainText('10 points so far.');
  });
});
