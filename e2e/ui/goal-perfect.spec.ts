import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-19][RWD-20] Perfect weeks, and a family goal every child meets (WP-82, the approved mockup and
// its addendum), with the made-up family and no database: on /dev/goals the two goals on Goals
// (?list=perfect), their forms (?form=family, ?form=perfect) and the family goal's weeks
// (?form=family-weeks); on /dev/board the family's card going, missed and won and Maya's perfect weeks
// (?perfect=), the clock held on Thursday, Oct 15, 2026. At the admin app's 390 and 1280 px and the
// board's sizes, in Day and Evening.

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
const inPlay = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Goals in play' })
    .getByRole('listitem')
    .filter({
      has: page.getByText(title, { exact: true }),
    });

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-20-j][NFR-11] the forms, Goals and a family goal’s weeks fit a ${device} in ${theme}`, async ({
        page,
      }) => {
        for (const path of ['list=perfect', 'form=family', 'form=perfect', 'form=family-weeks']) {
          await test.step(path, async () => {
            await page.goto(`/dev/goals?${path}&theme=${theme}`);
            if (path === 'form=family-weeks')
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

  test('[RWD-20-j][RWD-20-h] the form: every child meets it on a family goal, without steps', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=family');
    await hydrated(page);
    const box = page.getByRole('checkbox', { name: /Every child meets it/ });
    await expect(box).toBeChecked();
    await expect(
      page.getByText('Pay in steps isn’t offered when every child meets it.'),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Pay in steps' })).toHaveCount(0);
    // Unticked, the steps are offered again; for one child, the option goes.
    await box.uncheck();
    await expect(page.getByRole('group', { name: 'Pay in steps' })).toBeVisible();
    await page.getByRole('radio', { name: 'Maya' }).check();
    await expect(page.getByRole('checkbox', { name: /Every child meets it/ })).toHaveCount(0);
  });

  test('[RWD-20-j][RWD-19-h] the form: weeks won of Maya’s goal, in a row, from this goal’s start', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=perfect');
    await hydrated(page);
    await expect(page.getByRole('combobox', { name: 'Counts' })).toHaveValue('PERIODS_WON');
    await expect(page.getByRole('combobox', { name: 'Which goal' })).toHaveValue('g8');
    await expect(page.getByRole('radio', { name: 'In a row' })).toBeChecked();
    await expect(
      page.getByText(/Only weeks that start on or after this goal’s start date count/),
    ).toBeVisible();
    // It counts no items of its own and has no time.
    await expect(page.getByRole('group', { name: 'What counts' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Counts only when done' })).toHaveCount(0);
    // Leo has no repeating goal to count: the rule becomes things done, and the choice isn't offered.
    await page.getByRole('radio', { name: 'Leo' }).check();
    await expect(page.getByRole('combobox', { name: 'Counts' })).toHaveValue('COUNT');
    await expect(page.getByRole('option', { name: 'Weeks won of a repeating goal' })).toHaveCount(
      0,
    );
  });

  test('[RWD-20-j][RWD-20-i][RWD-19-i] Goals: each child’s week and who missed it; perfect weeks in a row', async ({
    page,
  }) => {
    await page.goto('/dev/goals?list=perfect');
    const family = inPlay(page, 'Everyone’s homework home');
    await expect(family).toContainText('The whole family · every child meets it · each week');
    await expect(family.locator('.fw-goal-line[data-kind="missed"]')).toHaveText(
      'Leo missed Tuesday. Starts again Monday, Oct 19.',
    );
    const kids = family.getByRole('list', { name: 'Each child this week' }).locator(':scope > li');
    await expect(kids).toHaveCount(2);
    await expect(kids.nth(0)).toContainText('Maya3 of 4 days');
    await expect(kids.nth(1)).toContainText('LeoMissed Tuesday');
    const perfect = inPlay(page, '3 perfect homework weeks in a row');
    await expect(perfect).toContainText('Maya · counts Homework home every school day');
    await expect(perfect).toContainText('1 of 3 weeks in a row · best so far 1');
    await expect(perfect).toContainText('This week makes 2 in a row if it’s won');
  });

  test('[RWD-20-j][RWD-20-i] a family goal’s weeks: each child, who had nothing due, and what each was paid', async ({
    page,
  }) => {
    await page.goto('/dev/goals?form=family-weeks');
    const summary = page.locator('summary').filter({ hasText: 'Weeks' });
    await expect(summary).toContainText('60 points paid');
    await summary.click();
    const rows = page.locator('ul[aria-labelledby="goal-weeks-heading"] > li');
    await expect(rows.nth(0)).toContainText('Missed · Maya 3 of 4 days · Leo missed Tuesday');
    await expect(rows.nth(1)).toContainText('Won · Maya 5 of 5 days · Leo 5 of 5 days');
    await expect(rows.nth(1)).toContainText('+20 each');
    await expect(rows.nth(2)).toContainText('Nothing due for anyone');
    await expect(rows.nth(4)).toContainText('Won · Maya 4 of 4 days · Leo had nothing due');
    await expect(rows.nth(4)).toContainText('+20');
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
const card = (page: Page, id: string) =>
  page.getByRole('region', { name: 'Goals' }).locator(`[data-goal="${id}"]`);
const smallText = (page: Page, id: string) =>
  card(page, id).evaluate((el) =>
    [...el.querySelectorAll('*')]
      .filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()),
      )
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 28)
      .map((e) => `${e.textContent!.trim()}: ${getComputedStyle(e).fontSize}`),
  );

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test.describe(`the board at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-20-j][NFR-03] the family goal going, missed and won, and perfect weeks, in ${theme}: 28 px text, AA contrast`, async ({
        page,
      }) => {
        for (const kind of ['going', 'missed', 'won'] as const) {
          await test.step(kind, async () => {
            await board(page, `?perfect=${kind}&theme=${theme}`);
            for (const id of ['g-everyone', 'g-perfect']) {
              await expect(card(page, id)).toBeVisible();
              expect(await smallText(page, id)).toEqual([]);
            }
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test.describe('the board’s cards', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('[RWD-20-j][RWD-20-i][US-415] the family goal: each child’s days; missed by Leo; won by both', async ({
    page,
  }) => {
    await board(page, '?perfect=going');
    const kids = card(page, 'g-everyone').getByRole('list', { name: 'Each child' });
    await expect(kids.locator(':scope > li')).toHaveCount(2);
    await expect(kids.locator(':scope > li').nth(1)).toContainText('Nothing due this week');
    await expect(card(page, 'g-everyone')).toContainText(
      'Every child, every day it’s due this week · 20 points each',
    );
    await board(page, '?perfect=missed');
    await expect(card(page, 'g-everyone').locator('.fw-goal-line[data-kind="missed"]')).toHaveText(
      'Leo missed Tuesday. Starts again Monday, Oct 19.',
    );
    await board(page, '?perfect=won');
    await expect(card(page, 'g-everyone').locator('.fw-goal-line[data-kind="won"]')).toHaveText(
      'Everyone made it! 20 points each.',
    );
  });

  test('[RWD-20-j][RWD-19-i][US-414] perfect weeks: 1 of 3 in a row, the weeks, what this week makes', async ({
    page,
  }) => {
    await board(page, '?perfect=going');
    const perfect = card(page, 'g-perfect');
    await expect(perfect.getByRole('progressbar')).toHaveAccessibleName(/^Weeks in a row/);
    await expect(perfect).toContainText('This week makes 2 in a row.');
    await expect(perfect.locator('[data-outcome]')).toHaveCount(4);
  });
});
