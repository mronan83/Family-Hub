import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf } from '../support/fold';

// [NFR-18][D-120] Rewards, Members and a member's page folded (WP-95), on their /dev pages: made-up
// family, no database. What waits for a parent and each page's list open; the shop's Archived, Bonus
// points (Add a bonus and Archived bonuses inside), Lately, Members' Archived, a member's Points and
// Archive folded to their headers; each opened by a tap after React has taken the page over (D-110);
// the fold a save comes back to open. In Chrome, as an iPhone and as Safari on a Mac (e2e/ui.config.ts).
// On the preview, e2e/tests/points.spec.ts changes Maya's points (PTS-01-b) and
// e2e/tests/goals.spec.ts reads "needs a look" on Goals' folded History (RWD-09-a).

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

/** Opens every fold on the page by a tap, outer before inner, so every field is measured too. */
async function openAll(page: Page) {
  const closed = page.locator('main details:not([open]) > summary:visible');
  // Each tap opens one, waited on before the next; an inner fold shows once its outer one is open.
  for (let i = 0; (await closed.count()) > 0; i++) {
    await closed
      .first()
      .evaluate((s, n) => s.parentElement!.setAttribute('data-tapped', n), `${i}`);
    await closed.first().click();
    await expect(page.locator(`details[data-tapped="${i}"]`)).toHaveAttribute('open', '');
  }
  await expect(page.locator('main details:not([open])')).toHaveCount(0);
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
  ['Rewards', '/dev/rewards?x=1', 'PTS-03-b'],
  ['Members', '/dev/members?x=1', 'ACC-04-b'],
  ['a member’s page', '/dev/members?page=member', 'ACC-04-b'],
] as const;

for (const [width, height, name] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[PTS-03-b][ACC-04-b][NFR-11] Rewards, Members and a member’s page fit ${name} in ${theme}, folded and opened`, async ({
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

test.describe('folded', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[PTS-03-b][PTS-04][PTS-05] Rewards: Asked for, To give and the shop open; Archived, Bonus points and Lately folded to their headers', async ({
    page,
  }) => {
    await open(page, '/dev/rewards');
    // What waits for a parent, and the shop, are not folds.
    for (const list of ['Asked for', 'To give', 'The shop'])
      await expect(page.getByRole('list', { name: list, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add a reward' })).toBeVisible();
    await folded(page, ['Archived', 'Bonus points', 'Lately']);
    await expect(head(page, 'Archived')).toContainText('1 archived');
    await expect(head(page, 'Bonus points')).toContainText('1 on, 1 off · 7 days in a row +20');
    await expect(head(page, 'Lately')).toContainText(
      'Last: Stay up late given to Leo, today · 2 settled',
    );
    await expect(page.getByRole('button', { name: 'Pay bonuses now' })).toBeHidden();

    // Bonus points opens to its rules, Pay bonuses now, and two folds of its own.
    await head(page, 'Bonus points').click();
    await expect(foldOf(page, 'Bonus points')).toHaveAttribute('open', '');
    await expect(
      page.getByRole('list', { name: 'Bonus points' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Pay bonuses now' })).toBeVisible();
    await folded(page, ['Add a bonus', 'Archived bonuses']);
    // Add a bonus folds to its button; Archived bonuses to its count.
    await expect(head(page, 'Add a bonus').locator('.fw-fold__closed')).toHaveText('Add a bonus');
    await expect(head(page, 'Archived bonuses')).toContainText('1 archived');
    await head(page, 'Add a bonus').click();
    await expect(page.getByRole('form', { name: 'Add a bonus' })).toBeVisible();

    await head(page, 'Lately').click();
    await expect(page.getByRole('list', { name: 'Lately' }).getByRole('listitem')).toHaveCount(2);
    await head(page, 'Archived').click();
    await expect(page.getByRole('list', { name: 'Archived rewards' })).toContainText('Old prize');
  });

  test('[ACC-04-b][PTS-01] Members: the list open, Archived folded to who; a member’s page: the form open, Points folded to the balance and the last change, Archive set apart', async ({
    page,
  }) => {
    await open(page, '/dev/members');
    await expect(page.getByRole('list', { name: 'Members', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Members', exact: true })
        .getByRole('listitem')
        .filter({ hasText: 'Maya' }),
    ).toContainText('Child · Earns rewards · 142 points');
    await folded(page, ['Archived']);
    await expect(head(page, 'Archived')).toContainText('1 archived: Grandpa Joe');
    await head(page, 'Archived').click();
    await expect(page.getByRole('button', { name: 'Restore Grandpa Joe' })).toBeVisible();

    await open(page, '/dev/members?page=member');
    await expect(page.getByRole('form', { name: 'Edit member' })).toBeVisible();
    await folded(page, ['Points', 'Archive']);
    await expect(head(page, 'Points')).toContainText(
      '142 points · last: +5 Make bed, today 7:10 am',
    );
    await expect(head(page, 'Archive')).toContainText(
      'Off the board; chores and goals stop showing; history kept',
    );
    // Archive is the last thing on the page.
    await expect(page.locator('main > :last-child')).toHaveAttribute('id', 'archive');
    await head(page, 'Points').click();
    await expect(
      page.getByRole('list', { name: 'Maya’s points' }).getByRole('listitem'),
    ).toHaveCount(5);
    // Change points folds to its button inside Points.
    await expect(foldOf(page, 'Change points')).not.toHaveAttribute('open');
    await expect(head(page, 'Change points').locator('.fw-fold__closed')).toHaveText(
      'Change points',
    );
    await head(page, 'Change points').click();
    await expect(page.getByRole('form', { name: 'Change Maya’s points' })).toBeVisible();
    await head(page, 'Archive').click();
    await expect(page.getByRole('button', { name: 'Archive Maya' })).toBeVisible();
  });
});

test.describe('open again', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[PTS-03-b][ACC-04-b][D-120] the fold a save comes back to is open, the others folded', async ({
    page,
  }) => {
    await test.step('a reward archived: the shop’s Archived', async () => {
      await open(page, '/dev/rewards?archived=1');
      await expect(foldOf(page, 'Archived')).toHaveAttribute('open', '');
      await folded(page, ['Bonus points', 'Lately']);
    });
    await test.step('a bonus turned off: Bonus points', async () => {
      await open(page, '/dev/rewards?bonus=off');
      await expect(foldOf(page, 'Bonus points')).toHaveAttribute('open', '');
      await folded(page, ['Add a bonus', 'Archived bonuses', 'Archived', 'Lately']);
    });
    await test.step('a bonus archived: Bonus points and Archived bonuses', async () => {
      await open(page, '/dev/rewards?bonus=archive');
      await expect(foldOf(page, 'Bonus points')).toHaveAttribute('open', '');
      await expect(foldOf(page, 'Archived bonuses')).toHaveAttribute('open', '');
    });
    await test.step('a bonus refused: Bonus points', async () => {
      await open(page, '/dev/rewards?error=bonus_gone');
      await expect(foldOf(page, 'Bonus points')).toHaveAttribute('open', '');
    });
    await test.step('points changed: Points and Change points', async () => {
      await open(page, '/dev/members?page=member&adjusted=5');
      await expect(foldOf(page, 'Points')).toHaveAttribute('open', '');
      await expect(foldOf(page, 'Change points')).toHaveAttribute('open', '');
      await expect(page.getByRole('region', { name: 'Points' })).toContainText('Added 5 points.');
      await folded(page, ['Archive']);
    });
    await test.step('a member archived: Members’ Archived', async () => {
      await open(page, '/dev/members?archived=1');
      await expect(foldOf(page, 'Archived')).toHaveAttribute('open', '');
    });
  });
});
