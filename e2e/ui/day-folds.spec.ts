import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf } from '../support/fold';

// [NFR-18][D-120] Today, My tasks and Insights folded (WP-97), on their /dev pages: made-up family,
// no database. What waits for a parent, Overdue and a part with anything to do open; a part with
// everything done or skipped folded to its count and names, a tick on its header; the part a parent
// just changed open with its count until the next load (D-145); My tasks' Coming up and Insights'
// detail sections folded to their findings; each opened by a tap after React has taken the page
// over (D-110). In Chrome, as an iPhone and as Safari on a Mac (e2e/ui.config.ts). On the preview,
// e2e/tests/admin-day.spec.ts marks the last open item of a part done (CHR-12-d).

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

const head = (page: Page, title: string) => foldOf(page, title).locator(':scope > summary');
async function folded(page: Page, titles: string[]) {
  for (const t of titles) await expect(foldOf(page, t)).not.toHaveAttribute('open');
}
async function opened(page: Page, titles: string[]) {
  for (const t of titles) await expect(foldOf(page, t)).toHaveAttribute('open', '');
}

/** Opens every fold on the page by a tap, so every row and button is measured too. */
async function openAll(page: Page) {
  // The fold folds; a row's "Mark done…" picker is not a fold and stays as it is.
  const closed = page.locator('main details.fw-fold:not([open]) > summary:visible');
  for (let i = 0; (await closed.count()) > 0; i++) {
    await closed
      .first()
      .evaluate((s, n) => s.parentElement!.setAttribute('data-tapped', n), `${i}`);
    await closed.first().click();
    await expect(page.locator(`details[data-tapped="${i}"]`)).toHaveAttribute('open', '');
  }
}

/** Buttons, fields and fold headers shorter than 44 px. */
const small = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('main button, main input, main select, main summary')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return r.height > 0 && r.height < 44 && type !== 'checkbox' && type !== 'radio';
      })
      .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
  );

const PAGES = [
  ['Today', '/dev/admin?x=1', 'CHR-12-c'],
  ['My tasks', '/dev/admin?view=my', 'CHR-14-b'],
  ['Insights', '/dev/insights?x=1', 'RWD-12-b'],
] as const;

for (const [width, height, name] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[CHR-12-c][CHR-14-b][RWD-12-b][NFR-11] Today, My tasks and Insights fit ${name} in ${theme}, folded and opened`, async ({
        page,
      }) => {
        for (const [what, url] of PAGES) {
          await test.step(what, async () => {
            await open(page, `${url}&theme=${theme}`);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            await contrastOk(page);
            await openAll(page);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            expect(await small(page)).toEqual([]);
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test('[CHR-12-c] Today: the title above the cards; a done part folded to its count and names, opened for Uncheck', async ({
  page,
}) => {
  await open(page, '/dev/admin');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  // What waits for a parent is open, marked in amber.
  await expect(
    page.getByRole('region', { name: 'Waiting for you' }).and(page.locator('.fw-card--attn')),
  ).toBeVisible();
  await opened(page, ['Overdue', 'After school', 'Evening', 'Anytime']);
  await expect(head(page, 'Overdue')).toContainText('1 open');
  // Open parts show their count on the header.
  await expect(head(page, 'After school')).toContainText('0 of 3 done');
  await expect(head(page, 'Evening')).toContainText('2 of 3 done');
  await folded(page, ['Morning']);
  const morning = head(page, 'Morning');
  await expect(morning).toContainText('3 of 3 done · Make bed and Brush teeth');
  await expect(morning.getByRole('img', { name: 'All done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uncheck Make bed (Maya)' })).toBeHidden();
  await morning.click();
  await expect(foldOf(page, 'Morning')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Uncheck Make bed (Maya)' })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Select Make bed (Leo)', exact: true }),
  ).toBeVisible();
});

test('[CHR-12-c][D-145] Today just after a part’s last item is marked done: that part open, with its count', async ({
  page,
}) => {
  await open(page, '/dev/admin?changed=1');
  await opened(page, ['Morning']);
  await expect(head(page, 'Morning').locator('.fw-fold__count')).toHaveText('3 of 3 done');
  await expect(head(page, 'Morning').getByRole('img', { name: 'All done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uncheck Make bed (Leo)' })).toBeVisible();
});

test('[CHR-14-b] My tasks: the title above the cards; Overdue and Today open, Coming up folded to how many and the next', async ({
  page,
}) => {
  await open(page, '/dev/admin?view=my');
  await expect(page.getByRole('heading', { name: 'My tasks', level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Overdue' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Today' })).toBeVisible();
  await folded(page, ['Coming up']);
  await expect(head(page, 'Coming up')).toContainText(
    '3 in the next 7 days · next: Leo’s dentist, Tomorrow 3:30 pm',
  );
  await head(page, 'Coming up').click();
  await expect(page.getByRole('list', { name: 'Coming up' }).getByRole('listitem')).toHaveCount(3);
});

test('[RWD-12-b] Insights: Streaks and Done open; the details folded to their findings; History to its button', async ({
  page,
}) => {
  await open(page, '/dev/insights');
  await expect(page.getByRole('region', { name: 'Streaks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Done' })).toBeVisible();
  await folded(page, ['Day by day', 'Missed most', 'By tag', 'Checking', 'History']);
  for (const [title, line] of [
    ['Day by day', 'Best: Sundays, 100% · lowest: Tuesdays, 40%'],
    ['Missed most', 'Brush teeth, missed 2 times'],
    ['By tag', 'Kitchen 91% · Morning 85%'],
    ['Checking', '11 checked by a parent · 1 sent back'],
    ['History', 'Rebuild from history'],
  ] as const) {
    await expect(head(page, title)).toContainText(line);
  }
  await head(page, 'Day by day').click();
  await expect(page.getByRole('table', { name: 'Day by day' })).toBeVisible();
  await head(page, 'History').click();
  await expect(page.getByRole('button', { name: 'Rebuild from history' })).toBeVisible();

  // Back from a rebuild, History comes back open.
  await open(page, '/dev/insights?history=rebuilt');
  await opened(page, ['History']);
  await folded(page, ['Day by day', 'Missed most', 'By tag', 'Checking']);
});
