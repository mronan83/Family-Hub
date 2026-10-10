import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [BRD-01][BRD-03][BRD-07][CHR-04][NFR-03][RWD-08] The board's Today (WP-11) on /dev/board: a made-up
// family and a stand-in for the server that counts every batch it is sent (window.__fwPosts), at the
// board's 1920×1080. The same flow runs on a real board and database in e2e/tests/board.spec.ts.
test.use({ viewport: { width: 1920, height: 1080 } });

const LEO = 'f1000000-0000-4000-8000-000000000002';

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });
const posts = (page: Page) =>
  page.evaluate(() =>
    (
      (window as unknown as { __fwPosts?: { event_type: string; done_by?: string[] }[][] })
        .__fwPosts ?? []
    ).flat(),
  );
const balance = async (page: Page, scope = page.locator('body')) =>
  Number(await scope.locator('[data-balance]').first().getAttribute('data-balance'));

async function asMaya(page: Page) {
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
}

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

test("[BRD-07][CHR-11][CHR-12] everyone's day: a column each, by part of day, overdue first", async ({
  page,
}) => {
  await page.goto('/dev/board');
  const everyone = page.getByRole('region', { name: 'Everyone today' });
  for (const name of ['Leo', 'Maya', 'Alex', 'Sam']) {
    await expect(everyone.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  const maya = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Maya', level: 2 }),
  });
  await expect(maya.getByRole('heading', { level: 3 })).toHaveText([
    'Overdue',
    'Morning',
    'After school',
    'Evening',
  ]);
  const sam = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Sam', level: 2 }),
  });
  await expect(sam).toContainText('Nothing today');
  // A shared item done by someone else is covered, and its points are not shown as theirs.
  const plants = everyone.locator('li', { hasText: 'Water the plants' });
  await expect(plants).toContainText('Covered · by Maya');
  await expect(plants.locator('.fw-points')).toHaveCount(0);
});

test('[CHR-04] a tap checks it off at once: Done! within 100 ms, recorded once', async ({
  page,
}) => {
  await asMaya(page);
  const ms = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Check off Make bed"]')!;
    const tile = button.closest('li')!;
    const t0 = performance.now();
    button.click();
    return new Promise<number>((resolve) => {
      const check = () =>
        tile.textContent?.includes('Done!')
          ? resolve(performance.now() - t0)
          : requestAnimationFrame(check);
      check();
    });
  });
  expect(ms).toBeLessThan(100);
  await expect.poll(() => posts(page)).toHaveLength(1);
  expect((await posts(page))[0]).toMatchObject({ event_type: 'complete' });
});

test('[CHR-04][NFR-03] a rapid double tap is one check-off, and the balance moves once', async ({
  page,
}) => {
  await asMaya(page);
  const before = await balance(page);
  const box = (await page.getByRole('button', { name: 'Check off Make bed' }).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('li', { hasText: 'Make bed' })).toContainText('Done!');
  await page.waitForTimeout(300);
  expect(await posts(page)).toHaveLength(1);
  expect(await balance(page)).toBe(before + 5);
});

test.describe('by touch', () => {
  test.use({ hasTouch: true });
  test('[BRD-03][CHR-04] a touch checks it off the same way', async ({ page }) => {
    await asMaya(page);
    await page.getByRole('button', { name: 'Check off Feed the dog' }).tap();
    await expect(page.locator('li[data-item="dog"]')).toContainText('Done!');
    await expect.poll(() => posts(page)).toHaveLength(1);
  });
});

test('[BRD-03] and by keyboard: Enter or Space', async ({ page }) => {
  await asMaya(page);
  await page.getByRole('button', { name: 'Check off Make bed' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('li', { hasText: 'Make bed' })).toContainText('Done!');
  await page.getByRole('button', { name: 'Check off Return library books' }).focus();
  await page.keyboard.press(' ');
  await expect(page.locator('li', { hasText: 'Return library books' })).toContainText('Done!');
  await expect.poll(() => posts(page)).toHaveLength(2);
});

test('[US-305][NFR-03] undo needs a second tap, then puts it back with an undo event', async ({
  page,
}) => {
  await asMaya(page);
  const before = await balance(page);
  await page.getByRole('button', { name: 'Check off Make bed' }).click();
  await page.getByRole('button', { name: 'Undo Make bed' }).click();
  await expect(page.getByRole('button', { name: 'Tap again to undo Make bed' })).toBeVisible();
  expect(await posts(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Tap again to undo Make bed' }).click();
  await expect(page.getByRole('button', { name: 'Check off Make bed' })).toBeVisible();
  await expect
    .poll(async () => (await posts(page)).map((e) => e.event_type))
    .toEqual(['complete', 'undo']);
  await expect.poll(() => balance(page)).toBe(before);
});

test('[CHR-05] a check-off that needs a parent waits, without points yet', async ({ page }) => {
  await asMaya(page);
  const before = await balance(page);
  await page.getByRole('button', { name: 'Check off Homework' }).click();
  await expect(page.locator('li', { hasText: 'Homework' })).toContainText('Waiting for a parent');
  await page.waitForTimeout(700);
  expect(await balance(page)).toBe(before);
});

test("[BRD-07][US-1006] who did it: the item's people first, anyone, several allowed", async ({
  page,
}) => {
  await page.goto('/dev/board');
  const everyone = page.getByRole('region', { name: 'Everyone today' });
  const alexColumn = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Alex', level: 2 }),
  });
  await alexColumn.getByRole('button', { name: 'Check off Feed the dog' }).click();
  const picker = page.getByRole('dialog', { name: 'Who did Feed the dog?' });
  await expect(picker.getByRole('button')).toHaveText([
    'Maya',
    'Alex',
    'Leo',
    'Sam',
    'Done',
    'Cancel',
  ]);
  await expect(picker.getByRole('button', { name: 'Alex' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'Leo' }).click();
  await contrastOk(page);
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0);
  await expect(alexColumn.locator('li', { hasText: 'Feed the dog' })).toContainText(
    'Done! · by Leo and Alex',
  );
  // Maya was covered by them.
  const mayaColumn = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Maya', level: 2 }),
  });
  await expect(mayaColumn.locator('li', { hasText: 'Feed the dog' })).toContainText(
    'Covered · by Leo and Alex',
  );
  await expect.poll(async () => (await posts(page))[0]?.done_by?.length).toBe(2);
});

test('[BRD-07] cancelling the picker records nothing', async ({ page }) => {
  await page.goto('/dev/board');
  await page.getByRole('button', { name: 'Check off Feed the dog' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await posts(page)).toHaveLength(0);
});

test("[RWD-08][US-1006] a child's check-off celebrates; an adult's does not", async ({ page }) => {
  await page.goto('/dev/board');
  const everyone = page.getByRole('region', { name: 'Everyone today' });
  const leoColumn = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Leo', level: 2 }),
  });
  await leoColumn.getByRole('button', { name: 'Check off Make bed' }).click();
  await expect(leoColumn.locator('li[data-celebrate]')).toHaveCount(1);
  const alexColumn = everyone.locator('section', {
    has: page.getByRole('heading', { name: 'Alex', level: 2 }),
  });
  await alexColumn.getByRole('button', { name: 'Check off Call the plumber' }).click();
  await expect(alexColumn.locator('li', { hasText: 'Call the plumber' })).toContainText('Done!');
  await expect(alexColumn.locator('li[data-celebrate]')).toHaveCount(0);
});

test('[RWD-08] with reduced motion the balance changes at once, no count-up', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asMaya(page);
  const before = await balance(page);
  await page.getByRole('button', { name: 'Check off Make bed' }).click();
  await expect(page.locator('.fw-today__me-head .fw-points__value')).toHaveText(
    String(before + 5),
    {
      timeout: 100,
    },
  );
});

test('[PTS-02][D-50] the points list says what each was for, never why points were taken away', async ({
  page,
}) => {
  await asMaya(page);
  const list = page.getByRole('list', { name: 'Points' });
  await expect(list).toContainText('A parent changed your points');
  await expect(list).not.toContainText('Left the bike out');
  await expect(list).toContainText('Helped carry the shopping');
  await expect(list).toContainText('Feed the dog, undone');
});

const wishes = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __fwWishes?: { member: string; item: string | null }[] })
        .__fwWishes ?? [],
  );

async function asLeo(page: Page) {
  await page.goto('/dev/board');
  await people(page).getByRole('button', { name: 'Leo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leo', level: 2 })).toBeVisible();
}

test('[PTS-06][US-1108] a child sees what they are saving for: their balance against its cost', async ({
  page,
}) => {
  await asMaya(page);
  const card = page.getByRole('region', { name: 'Saving for' });
  await expect(card).toContainText('Movie night');
  const meter = card.getByRole('progressbar');
  await expect(meter).toHaveAttribute('aria-valuenow', '42');
  await expect(meter).toHaveAttribute('aria-valuetext', '42 of 100, 42%');
  await expect(card).toContainText('58 more points to go.');
  await expect(card.getByRole('button', { name: 'Change' })).toBeVisible();
  // A grown-up who doesn't earn rewards has no wish.
  await people(page).getByRole('button', { name: 'Alex', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alex', level: 2 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saving for' })).toHaveCount(0);
});

test('[PTS-06][US-1108] choosing a wish: picked at once, sent once; with enough, ask for it', async ({
  page,
}) => {
  await asLeo(page);
  const card = page.getByRole('region', { name: 'Saving for' });
  await expect(card).toContainText('Pick a reward from the shop to save up for.');
  await card.getByRole('button', { name: 'Choose a wish' }).click();
  const picker = page.getByRole('dialog', { name: 'What is Leo saving for?' });
  const options = picker.getByRole('list', { name: 'Rewards' }).getByRole('button');
  await expect(options).toHaveCount(4);
  await expect(options.first()).toBeFocused();
  // Nothing pinned yet: none pressed, and no "No wish".
  await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'No wish' })).toHaveCount(0);
  await picker.getByRole('button', { name: /Stay up 30 minutes late/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(card).toContainText('Stay up 30 minutes late');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '17 of 25, 68%');
  await expect(card).toContainText('8 more points to go.');
  await expect.poll(() => wishes(page)).toEqual([{ member: LEO, item: 'r-late' }]);

  // Two chores later (5 points each) there is enough: the board says to ask for it.
  await page.getByRole('button', { name: 'Check off Make bed' }).click();
  await page.getByRole('button', { name: 'Check off Set the table' }).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '25 of 25, 100%');
  await expect(card).toContainText('You have enough! Ask a grown-up for it.');

  // Change: the pinned one is pressed; "No wish" takes it off.
  await card.getByRole('button', { name: 'Change' }).click();
  await expect(picker.getByRole('button', { name: /Stay up 30 minutes late/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'No wish' }).click();
  await expect(card).toContainText('Pick a reward from the shop to save up for.');
  await expect
    .poll(() => wishes(page))
    .toEqual([
      { member: LEO, item: 'r-late' },
      { member: LEO, item: null },
    ]);
});

test('[PTS-06] cancelling the wish picker changes nothing', async ({ page }) => {
  await asMaya(page);
  const card = page.getByRole('region', { name: 'Saving for' });
  await card.getByRole('button', { name: 'Change' }).click();
  const picker = page.getByRole('dialog', { name: 'What is Maya saving for?' });
  await expect(picker.getByRole('button', { name: /Movie night/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(card).toContainText('Movie night');
  expect(await wishes(page)).toEqual([]);
});

test('[PTS-06][DEV-08] offline, choosing a wish waits for the internet', async ({
  page,
  context,
}) => {
  await asMaya(page);
  await context.setOffline(true);
  const card = page.getByRole('region', { name: 'Saving for' });
  await expect(card.getByRole('button', { name: 'Change' })).toBeDisabled();
  await expect(card).toContainText('Choosing a wish needs the internet.');
  // What she is saving for still shows.
  await expect(card).toContainText('Movie night');
  await context.setOffline(false);
  await expect(card.getByRole('button', { name: 'Change' })).toBeEnabled();
});

for (const theme of ['day', 'evening'] as const) {
  test(`[PTS-06][NFR-11] the wish picker in ${theme}: 56 px choices, 28 px text, AA contrast`, async ({
    page,
  }) => {
    await page.goto(`/dev/board?theme=${theme}`);
    await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
    await page.getByRole('button', { name: 'Change' }).click();
    const report = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')!;
      const small = [...dialog.querySelectorAll('button')]
        .filter((b) => b.getBoundingClientRect().height < 56)
        .map((b) => b.textContent);
      const tiny = [...dialog.querySelectorAll('*')]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
        .map((el) => el.textContent?.trim());
      return { small, tiny };
    });
    expect(report).toEqual({ small: [], tiny: [] });
    await contrastOk(page);
  });
}

for (const theme of ['day', 'evening'] as const) {
  test(`[BRD-03][NFR-11] fits the board and is legible in ${theme}: 56 px targets, 28 px text, no overflow`, async ({
    page,
  }) => {
    await page.goto(`/dev/board?theme=${theme}`);
    for (const view of ['Everyone', 'Maya']) {
      await people(page).getByRole('button', { name: view, exact: true }).click();
      const report = await page.evaluate(() => {
        const small = [...document.querySelectorAll('button')]
          .filter((b) => b.getBoundingClientRect().height < 56)
          .map((b) => b.getAttribute('aria-label') ?? b.textContent);
        const tiny = [...document.querySelectorAll('.fw-today *')]
          .filter(
            (el) =>
              el.childNodes.length &&
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()),
          )
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 28)
          .map((el) => el.textContent?.trim());
        return { wide: document.documentElement.scrollWidth, small, tiny };
      });
      expect(report).toEqual({ wide: 1920, small: [], tiny: [] });
      await contrastOk(page);
    }
  });
}
