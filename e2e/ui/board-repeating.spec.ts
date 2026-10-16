import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-15][RWD-16] A repeating goal on the board (WP-80, the approved mockup) on /dev/board with the
// made-up family: Maya's "Homework home" each week, going, missed or won (?repeating=), today the
// week's fourth day and its fifth a day off school; Leo's reading, missed this week. At the board's
// sizes in Day and Evening: each day's mark, "3 of 4 days", "Missed, starts again", "Won this week!",
// the last weeks, text 28 px or more and AA contrast.

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });

async function open(page: Page, name: string, query: string) {
  await page.goto(`/dev/board${query}`);
  await people(page).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}
const homework = (page: Page) =>
  page.getByRole('region', { name: 'Goals' }).locator('[data-goal="g-homework"]');

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
/** Every bit of text in the goal under 28 px, by what it says (the board's floor, NFR-03). */
const smallText = (page: Page) =>
  homework(page).evaluate((card) =>
    [...card.querySelectorAll('*')]
      .filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()),
      )
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
      .map((el) => `${el.textContent!.trim()}: ${getComputedStyle(el).fontSize}`),
  );

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test.describe(`at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-15-l][NFR-03] Maya’s goal going, missed and won, in ${theme}: 28 px text, AA contrast`, async ({
        page,
      }) => {
        for (const kind of ['going', 'missed', 'won'] as const) {
          await test.step(kind, async () => {
            await open(page, 'Maya', `?repeating=${kind}&theme=${theme}`);
            await expect(homework(page)).toHaveAttribute(
              'data-period',
              kind === 'going' ? 'open' : kind,
            );
            expect(await smallText(page)).toEqual([]);
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test.describe('the card', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('[RWD-15-l][RWD-16] going: a mark for each day, a day off a dash, "3 of 4 days" and what it pays', async ({
    page,
  }) => {
    await open(page, 'Maya', '?repeating=going');
    const card = homework(page);
    const days = card.getByRole('list', { name: 'This week’s days' }).getByRole('listitem');
    // Four days due and the day off; the weekend, with nothing due, isn't shown.
    await expect(days).toHaveCount(5);
    await expect(days.nth(0)).toHaveAttribute('data-mark', 'done');
    await expect(days.nth(3)).toHaveAttribute('data-mark', 'today');
    await expect(days.nth(4)).toHaveAttribute('data-mark', 'none');
    await expect(days.nth(4)).toHaveAttribute('aria-label', /: no school$/);
    await expect(card.getByRole('progressbar', { name: 'Days · 10 points' })).toHaveAttribute(
      'aria-valuetext',
      '3 of 4, 75%',
    );
    await expect(card).toContainText('Today makes it!');
    await expect(card).toContainText('Won 3 of the last 4 weeks');
    await expect(
      card.getByRole('list', { name: 'The last 5 weeks' }).getByRole('listitem'),
    ).toHaveCount(5);
  });

  test('[RWD-15-l][RWD-16-c] missed: "Missed, starts again" the next week’s first day, no part count', async ({
    page,
  }) => {
    await open(page, 'Maya', '?repeating=missed');
    const card = homework(page);
    await expect(card.locator('.fw-goal-line[data-kind="missed"]')).toHaveText(
      /^Missed, starts again \w+day, \w{3} \d{1,2}$/,
    );
    await expect(card.getByRole('progressbar')).toHaveCount(0);
    await expect(
      card.getByRole('list', { name: 'This week’s days' }).getByRole('listitem').nth(1),
    ).toHaveAttribute('data-mark', 'missed');
    // Leo's goal, one miss allowed, is lost too; it is his, so not on Maya's screen.
    await expect(page.locator('[data-goal="g-reading"]')).toHaveCount(0);
    await open(page, 'Leo', '?repeating=missed');
    await expect(page.locator('[data-goal="g-reading"] .fw-goal-line')).toContainText(
      'Missed, starts again',
    );
  });

  test('[RWD-15-l] won: "Won this week! 10 points." and when the next week starts', async ({
    page,
  }) => {
    await open(page, 'Maya', '?repeating=won');
    const card = homework(page);
    await expect(card.locator('.fw-goal-line[data-kind="won"]')).toHaveText(
      'Won this week! 10 points.',
    );
    await expect(card).toContainText(/Next week starts \w+day, \w{3} \d{1,2}\./);
    await expect(card).toContainText('Won 4 of the last 4 weeks');
  });
});
