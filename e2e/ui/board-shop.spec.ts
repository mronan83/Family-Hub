import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [PTS-02][PTS-03][PTS-04][RWD-07][RWD-08] The board's shop, requests and goals (WP-20) on /dev/board:
// the made-up family, with a stand-in for the server that keeps each ask, call-off and celebration on
// window.__fwShop and then changes the snapshot as Realtime would. The same flow runs on a real board
// and database at 3840×2160 in e2e/tests/board-shop.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

const LEO = 'f1000000-0000-4000-8000-000000000002';

interface ShopLog {
  asks: { id: string; member: string; item: string }[];
  cancels: string[];
  marks: string[];
}
const shopLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __fwShop?: ShopLog }).__fwShop ?? {
        asks: [],
        cancels: [],
        marks: [],
      },
  );
const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });

async function open(page: Page, name: string, query = '') {
  await page.goto(`/dev/board${query}`);
  await people(page).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Buttons under 56 px and text under 28 px inside `selector` (the board's floors, 06 §3). */
const fit = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const small = [...root.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().height < 56)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    const tiny = [...root.querySelectorAll('*')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
      .map((el) => el.textContent?.trim());
    return { small, tiny, wide: document.documentElement.scrollWidth };
  }, selector);

test('[PTS-03][PTS-04][US-1104] the shop says what can be asked for, and why not', async ({
  page,
}) => {
  await open(page, 'Maya');
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Maya’s shop' });
  await expect(shop.locator('[data-available]')).toHaveAttribute('data-available', '42');
  await expect(shop).toContainText('to spend');
  const item = (title: string) => shop.getByRole('listitem').filter({ hasText: title });
  await expect(item('Movie night')).toContainText('58 more points to go');
  await expect(item('Ice cream trip')).toContainText('3 left');
  await expect(
    item('Ice cream trip').getByRole('button', { name: 'Ask for this: Ice cream trip' }),
  ).toBeVisible();
  await expect(item('Pick the dinner')).toContainText('Asked for this week. Try next week!');
  await expect(item('A new kite')).toContainText('All gone for now');
  // Only what can be asked for is outlined, and has a button.
  await expect(shop.locator('[data-can]')).toHaveCount(2);
  await expect(shop.getByRole('button', { name: /^Ask for this/ })).toHaveCount(2);
  await shop.getByRole('button', { name: 'Close' }).click();
  await expect(shop).toHaveCount(0);
  expect((await shopLog(page)).asks).toEqual([]);
});

test('[PTS-04][US-1104] asking: once more to be sure, then pending at once; called off, the points are free', async ({
  page,
}) => {
  await open(page, 'Leo');
  // 17 isn't enough for anything yet; two chores (+10) make 27.
  await page.getByRole('button', { name: 'Check off Make bed' }).click();
  await page.getByRole('button', { name: 'Check off Set the table' }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Leo’s shop' });
  const late = shop.getByRole('listitem').filter({ hasText: 'Stay up 30 minutes late' });
  await late.getByRole('button', { name: 'Ask for this: Stay up 30 minutes late' }).click();
  // A stray tap spends nothing: it asks once more, and "Not now" puts it back.
  const sure = late.getByRole('group', { name: 'Ask for Stay up 30 minutes late?' });
  await expect(sure).toContainText('Ask for Stay up 30 minutes late for 25 points?');
  await sure.getByRole('button', { name: 'Not now' }).click();
  await expect(sure).toHaveCount(0);
  expect((await shopLog(page)).asks).toEqual([]);
  await late.getByRole('button', { name: 'Ask for this: Stay up 30 minutes late' }).click();
  await sure.getByRole('button', { name: 'Yes, ask' }).click();
  await expect(shop).toHaveCount(0);

  // The request shows at once, and the board says what happens next.
  const asked = page.getByRole('region', { name: 'Asked for' });
  await expect(asked.getByRole('listitem')).toHaveCount(1);
  await expect(asked).toContainText('Stay up 30 minutes late');
  await expect(asked).toContainText('Waiting for a grown-up');
  await expect(page.locator('.fw-today__notice')).toContainText(
    'Asked for Stay up 30 minutes late. A grown-up will say yes or not this time.',
  );
  await expect(page.locator('.fw-today__spend')).toHaveText(
    '2 to spend · 25 waiting for a grown-up',
  );
  await expect
    .poll(async () => (await shopLog(page)).asks.map((a) => [a.member, a.item]))
    .toEqual([[LEO, 'r-late']]);

  // Called off before a parent decides: the points are free again, and nothing more is sent.
  await asked.getByRole('button', { name: 'Call off Stay up 30 minutes late' }).click();
  await expect(asked).toContainText('Called off');
  await expect(asked.getByRole('button', { name: /Call off/ })).toHaveCount(0);
  await expect(page.locator('.fw-today__spend')).toHaveCount(0);
  const log = await shopLog(page);
  expect(log.cancels).toEqual([log.asks[0]!.id]);
});

test('[PTS-04][US-1104] what the shop refuses is taken back, and the board says why', async ({
  page,
}) => {
  await open(page, 'Maya');
  // Another board got the last one first.
  await page.evaluate(() => {
    (window as unknown as { __fwRefuse?: string }).__fwRefuse = 'out_of_stock';
  });
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Maya’s shop' });
  const ice = shop.getByRole('listitem').filter({ hasText: 'Ice cream trip' });
  await ice.getByRole('button', { name: /^Ask for this/ }).click();
  await ice.getByRole('button', { name: 'Yes, ask' }).click();
  await expect(page.locator('.fw-today__notice')).toContainText('That one is all gone.');
  const asked = page.getByRole('region', { name: 'Asked for' });
  await expect(asked.locator('[data-status="requested"]')).toHaveCount(0);
  await expect(page.locator('.fw-today__spend')).toHaveCount(0);
});

test('[PTS-04] once asked, what is left to spend is what the shop offers', async ({ page }) => {
  await open(page, 'Maya');
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Maya’s shop' });
  const ice = shop.getByRole('listitem').filter({ hasText: 'Ice cream trip' });
  await ice.getByRole('button', { name: /^Ask for this/ }).click();
  await ice.getByRole('button', { name: 'Yes, ask' }).click();
  const asked = page.getByRole('region', { name: 'Asked for' });
  await expect(asked.locator('[data-status="requested"]')).toHaveCount(1);
  // 2 left to spend: nothing else can be asked for, and the shop says how far off each is.
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(shop.locator('[data-available]')).toHaveAttribute('data-available', '2');
  await expect(shop.getByRole('button', { name: /^Ask for this/ })).toHaveCount(0);
  await expect(
    shop.getByRole('listitem').filter({ hasText: 'Stay up 30 minutes late' }),
  ).toContainText('23 more points to go');
});

test('[PTS-04][DEV-08] offline, asking waits for the internet; nothing is sent', async ({
  page,
  context,
}) => {
  await open(page, 'Maya');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = page.getByRole('dialog', { name: 'Maya’s shop' });
  await expect(shop.getByRole('listitem').filter({ hasText: 'Ice cream trip' })).toContainText(
    'Asking needs the internet',
  );
  await expect(shop.getByRole('button', { name: /^Ask for this/ })).toHaveCount(0);
  await context.setOffline(false);
  await expect(shop.getByRole('button', { name: /^Ask for this/ })).toHaveCount(2);
  expect((await shopLog(page)).asks).toEqual([]);
});

test('[PTS-04][US-1105] a child sees a yes, a "not this time", and what they got', async ({
  page,
}) => {
  await open(page, 'Maya');
  const asked = page.getByRole('region', { name: 'Asked for' });
  const row = (title: string) => asked.getByRole('listitem').filter({ hasText: title });
  await expect(row('Pick the dinner')).toContainText('You got it!');
  await expect(row('Ice cream trip')).toContainText('Not this time');
  // Settled requests can't be called off.
  await expect(asked.getByRole('button')).toHaveCount(0);
  // Leo has asked for nothing: no card.
  await people(page).getByRole('button', { name: 'Leo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Asked for' })).toHaveCount(0);
});

test('[PTS-06][PTS-04] with enough saved, "Ask for it" on the wish card asks for the wish', async ({
  page,
}) => {
  await open(page, 'Leo');
  const card = page.getByRole('region', { name: 'Saving for' });
  await card.getByRole('button', { name: 'Choose a wish' }).click();
  await page
    .getByRole('dialog', { name: 'What is Leo saving for?' })
    .getByRole('button', { name: /Stay up 30 minutes late/ })
    .click();
  await expect(card.getByRole('button', { name: 'Ask for it' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check off Make bed' }).click();
  await page.getByRole('button', { name: 'Check off Set the table' }).click();
  await card.getByRole('button', { name: 'Ask for it' }).click();
  // The shop opens on the question about the wish, with "Yes, ask" ready.
  const sure = page
    .getByRole('dialog', { name: 'Leo’s shop' })
    .getByRole('group', { name: 'Ask for Stay up 30 minutes late?' });
  await expect(sure.getByRole('button', { name: 'Yes, ask' })).toBeFocused();
  await sure.getByRole('button', { name: 'Yes, ask' }).click();
  await expect(card).toContainText('Asked: Waiting for a grown-up');
  await expect(card.getByRole('button', { name: 'Ask for it' })).toHaveCount(0);
});

test('[RWD-07][US-403] goals: a meter per rule, the run now, when it ends; a nudge naming the goal', async ({
  page,
}) => {
  await open(page, 'Leo');
  await expect(page.locator('.fw-today__me-head .fw-today__nudge')).toHaveText(
    'One more thing to do for Bike ride!',
  );
  const goals = page.getByRole('region', { name: 'Goals' });
  const bike = goals.getByRole('listitem').filter({ hasText: 'Bike ride' });
  await expect(bike.getByRole('progressbar', { name: 'Things done' })).toHaveAttribute(
    'aria-valuetext',
    '9 of 10, 90%',
  );
  await expect(bike).toContainText(
    /Ends (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/,
  );
  // The family's goal follows the child's own, marked as the family's.
  const pizza = goals.getByRole('listitem').filter({ hasText: 'Pizza night' });
  await expect(pizza).toContainText('Family');
  await expect(goals.getByRole('listitem')).toHaveText([/Bike ride/, /Pizza night/]);

  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  const maya = page.getByRole('region', { name: 'Goals' });
  await expect(maya.getByRole('listitem').filter({ hasText: 'Art kit' })).toContainText(
    'Reached! A grown-up will sort out the reward.',
  );
  const zoo = maya.getByRole('listitem').filter({ hasText: 'Zoo trip' });
  await expect(zoo).toContainText('All of these:');
  await expect(zoo.getByRole('progressbar')).toHaveCount(2);
  await expect(zoo).toContainText('2 in a row now, best 3');
  // Two rules to go: no nudge for the zoo, but the family is nearly at Pizza night.
  await expect(page.locator('.fw-today__me-head .fw-today__nudge')).toHaveText(
    'Almost there with Pizza night!',
  );
  // A grown-up has no goals card.
  await people(page).getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Goals' })).toHaveCount(0);
});

test("[RWD-07] everyone's day on Chores: each child's own nudge in their column; the family's goals below", async ({
  page,
}) => {
  await page.goto('/dev/board');
  await page
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Chores', exact: true })
    .click();
  const column = (name: string) =>
    page
      .getByRole('region', { name: 'Everyone today' })
      .locator('section', { has: page.getByRole('heading', { name, level: 2 }) });
  await expect(column('Leo').locator('.fw-today__nudge')).toHaveText(
    'One more thing to do for Bike ride!',
  );
  await expect(column('Maya').locator('.fw-today__nudge')).toHaveCount(0);
  const family = page.getByRole('region', { name: 'Family goals' });
  await expect(family.getByRole('progressbar', { name: 'Things done' })).toHaveAttribute(
    'aria-valuetext',
    '18 of 20, 90%',
  );
});

test('[RWD-08][US-404] a goal reached is celebrated once, on whichever view is showing', async ({
  page,
}) => {
  await page.goto('/dev/board?celebrate=1');
  const party = page.getByRole('dialog', { name: 'Leo reached Bike ride!' });
  await expect(party).toBeVisible();
  await expect(party.getByRole('button', { name: 'Yay!' })).toBeFocused();
  // Marked at once, so no other board celebrates it; the snapshot then says so, and it stays up.
  await expect.poll(async () => (await shopLog(page)).marks).toEqual(['g-bike:1']);
  await page.waitForTimeout(500);
  await expect(party).toBeVisible();
  await party.getByRole('button', { name: 'Yay!' }).click();
  await expect(party).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await shopLog(page)).marks).toEqual(['g-bike:1']);
  // Leo's card now says it was reached.
  await people(page).getByRole('button', { name: 'Leo', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Goals' })
      .getByRole('listitem')
      .filter({ hasText: 'Bike ride' }),
  ).toContainText('Reached!');
});

test('[RWD-08] with reduced motion the celebration is still: no sparks, no pop', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/board?celebrate=1');
  await expect(page.getByRole('dialog', { name: 'Leo reached Bike ride!' })).toBeVisible();
  const motion = await page.evaluate(() => ({
    burst: getComputedStyle(document.querySelector('.fw-celebrate__burst')!).display,
    card: getComputedStyle(document.querySelector('.fw-celebrate__card')!).animationName,
  }));
  expect(motion).toEqual({ burst: 'none', card: 'none' });
});

for (const theme of ['day', 'evening'] as const) {
  test(`[NFR-11][BRD-03] the shop, asking and the celebration in ${theme}: 56 px targets, 28 px text, AA contrast`, async ({
    page,
  }) => {
    await open(page, 'Maya', `?theme=${theme}`);
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.getByRole('button', { name: 'Ask for this: Ice cream trip' }).click();
    expect(await fit(page, '[role="dialog"]')).toEqual({ small: [], tiny: [], wide: 1920 });
    await contrastOk(page);
    await page.getByRole('button', { name: 'Yes, ask' }).click();
    expect(await fit(page, '.fw-today__side')).toEqual({ small: [], tiny: [], wide: 1920 });
    await contrastOk(page);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/dev/board?theme=${theme}&celebrate=1`);
    await expect(page.getByRole('dialog')).toBeVisible();
    // The dev board sets its theme once it is running (ThemeLock); nothing is tapped here first, so
    // wait for it, or the contrast check can read a button halfway between Day and Evening.
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // With reduced motion every style change is a 1 ms transition (the brand's reduced-motion rule),
    // which Chromium can take a few hundred ms to finish while the page loads: the colours trail it.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.getAnimations().filter((a) => a instanceof CSSTransition).length,
        ),
      )
      .toBe(0);
    expect(await fit(page, '.fw-celebrate')).toEqual({ small: [], tiny: [], wide: 1920 });
    await contrastOk(page);
  });
}
