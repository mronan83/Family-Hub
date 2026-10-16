import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [MEAL-13][US-710][D-98] The lunch week as a list of days (WP-74) on /dev/meals, with a made-up
// family and menu, no database. Today there is Wednesday 14 October; Thursday is a day off. Leo's
// week: Monday Bring, Tuesday Buy (a menu without "Choice of"), Wednesday Buy with nothing picked,
// Friday Bring. With ?lunches=1, Leo picked Wednesday on the board and Maya's change of Tuesday to
// Buy waits for a parent. The same against the database runs nightly in e2e/tests/lunches.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Opens a page and waits for React to take it over (D-110): before then nothing saves. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

const section = (page: Page) => page.getByRole('region', { name: 'School lunch' });
const week = (page: Page, name: string) => page.getByRole('list', { name: `${name}’s lunch week` });
const day = (page: Page, name: string, date: string) =>
  week(page, name).locator(`.fw-lunchday[data-date="${date}"]`);
const WED = '2026-10-14';

for (const width of [390, 768, 1280]) {
  for (const theme of ['day', 'evening'] as const) {
    test(`[MEAL-13][NFR-11] the lunch week at ${width} px, ${theme}: closed, then today opened; outlined, nothing sideways, 44 px targets, AA contrast`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, `/dev/meals?theme=${theme}`);
      const leo = week(page, 'Leo');
      await expect(leo.getByRole('listitem')).toHaveCount(5);
      // Every day starts closed.
      await expect(leo.locator('details[open]')).toHaveCount(0);
      const today = day(page, 'Leo', WED);
      const outlined = () =>
        today.evaluate((el) => {
          const s = getComputedStyle(el);
          return `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`;
        });
      await expect(today).toHaveAttribute('data-today', 'true');
      await expect(today).toContainText('Today');
      const closed = await outlined();
      expect(closed, 'today outlined, closed').toMatch(/^2px solid /);
      const check = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const small = await section(page).evaluate((s) =>
          [...s.querySelectorAll('button, a.fw-btn, summary, select')]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              return r.height > 0 && r.height < 44;
            })
            .map((b) => b.textContent),
        );
        expect(small).toEqual([]);
        await contrastOk(page);
      };
      await check();
      await today.locator('summary').click();
      await expect(
        today.getByRole('group', { name: 'Leo, Wednesday: buy or bring' }),
      ).toBeVisible();
      expect(await outlined(), 'today outlined, open').toBe(closed);
      await check();
    });
  }
}

test('[MEAL-13][US-710] one child’s Monday to Friday: Buy or Bring, a check when complete, a day off greyed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/dev/meals');
  const kids = section(page).getByRole('group', { name: 'Whose lunches' });
  // Leo still has today to pick: a dot on him, none on Maya.
  await expect(kids.getByRole('button', { name: 'Leo, has days to pick' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(kids.getByRole('button', { name: 'Maya', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const leo = week(page, 'Leo');
  await expect(leo.locator('.fw-lunchday__name')).toHaveText([
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
  ]);
  await expect(leo.locator('.fw-lunchday__date')).toHaveText([
    'Oct 12',
    'Oct 13',
    'Oct 14',
    'Oct 15',
    'Oct 16',
  ]);
  await expect(leo.locator('.fw-lunchday__end')).toHaveText([
    'Bring',
    'Buy',
    'Buy',
    'No school',
    'Bring',
  ]);
  for (const [date, done] of [
    ['2026-10-12', 'Complete'],
    // A Buy day whose menu has no "Choice of" section asks for no pick.
    ['2026-10-13', 'Complete'],
    [WED, 'Not picked yet'],
    ['2026-10-16', 'Complete'],
  ] as const)
    await expect(day(page, 'Leo', date).getByRole('img', { name: done })).toBeVisible();
  // The day off: greyed, "No school", nothing to open.
  const off = day(page, 'Leo', '2026-10-15');
  await expect(off).toHaveClass(/fw-lunchday--off/);
  await expect(off.locator('summary, details')).toHaveCount(0);

  // Wednesday opened: Buy at the top, the day's menu a section each.
  const wed = day(page, 'Leo', WED);
  await wed.locator('summary').click();
  const mode = wed.getByRole('group', { name: 'Leo, Wednesday: buy or bring' });
  await expect(mode.getByRole('button', { name: 'Buy' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mode.getByRole('button', { name: 'Bring' })).toHaveAttribute(
    'value',
    `f2000000-0000-4000-8000-000000000002:${WED}:bring`,
  );
  await expect(wed.locator('legend')).toHaveText([
    'Entree · pick one',
    'Fruits & Vegetables · any',
    'Milk · pick one',
  ]);
  // [MEAL-11][WP-78] An entree, a milk, then fruits: each stays picked, highlighted.
  const box = (s: string, name: string) =>
    wed.getByRole('group', { name: new RegExp(`^${s}`) }).getByLabel(name, { exact: true });
  await box('Entree', 'Turkey sandwich with Pretzels').check();
  await box('Milk', 'Chocolate milk').check();
  await box('Fruits', 'Orange').check();
  await box('Fruits', 'Green Beans').check();
  for (const [s, name] of [
    ['Entree', 'Turkey sandwich with Pretzels'],
    ['Milk', 'Chocolate milk'],
    ['Fruits', 'Orange'],
    ['Fruits', 'Green Beans'],
  ] as const) {
    await expect(box(s, name), `${name} still picked`).toBeChecked();
    await expect(wed.locator('.fw-lunchday__opt').filter({ hasText: name })).toHaveCSS(
      'font-weight',
      '700',
    );
  }
  await expect(wed.getByRole('button', { name: 'Save Leo’s picks' })).toBeEnabled();

  // Maya chosen: her week shows, and this device opens on her next time.
  await kids.getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(week(page, 'Maya')).toBeVisible();
  await expect(week(page, 'Leo')).toBeHidden();
  await open(page, '/dev/meals');
  await expect(kids.getByRole('button', { name: 'Maya', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(week(page, 'Maya')).toBeVisible();
});

test('[MEAL-13][MEAL-09] picks made, a change on the board, and a child’s change waiting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '/dev/meals?lunches=1');
  // Leo's Wednesday, picked on the board: complete, with his picks checked.
  const wed = day(page, 'Leo', WED);
  await expect(wed.getByRole('img', { name: 'Complete' })).toBeVisible();
  await wed.locator('summary').click();
  await expect(wed).toContainText('Changed on the board');
  for (const name of ['Turkey sandwich with Pretzels', '1% milk', 'Orange'])
    await expect(wed.getByLabel(name, { exact: true })).toBeChecked();
  await expect(wed.getByLabel('Cheese Pizza', { exact: true })).not.toBeChecked();
  // Maya's Tuesday: her change to Buy waits for a parent, shown closed and open.
  await section(page)
    .getByRole('group', { name: 'Whose lunches' })
    .getByRole('button', { name: /^Maya/ })
    .click();
  const tue = day(page, 'Maya', '2026-10-13');
  await expect(tue.locator('.fw-lunchday__end')).toHaveText('WaitingBring');
  await tue.locator('summary').click();
  await expect(tue.getByRole('link', { name: 'Buy? waiting' })).toHaveAttribute(
    'href',
    '/admin/today',
  );
  await contrastOk(page);
});

test('[MEAL-13][D-110] nothing on the list saves before the page has hydrated', async ({
  page,
}) => {
  // No scripts: the page stays as the server drew it, never hydrated.
  await page.route(/\.js(\?|$)/, (route) => route.abort());
  await page.goto('/dev/meals');
  await expect(page.locator('html')).not.toHaveAttribute('data-hydrated', 'true');
  const wed = day(page, 'Leo', WED);
  await wed.locator('summary').click();
  await expect(wed.getByRole('button', { name: 'Bring' })).toBeDisabled();
  await expect(wed.getByRole('button', { name: 'Save Leo’s picks' })).toBeDisabled();
});
