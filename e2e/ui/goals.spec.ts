import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-01][RWD-04][RWD-09][RWD-10][RWD-13] Goals for a parent (WP-19, WP-39) on /dev/goals: a made-up
// family, no database. The list (goals in play with their rules' meters and what they pay, then
// history), the goal form (rules added and removed, what a started goal keeps, what reaching it
// pays), the preview of a change, and the layout on a phone and a laptop in Day and Evening. The
// same pages run signed in against the database in e2e/tests/goals.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}
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
        return (
          r.height > 0 &&
          r.height < 44 &&
          (b as HTMLInputElement).type !== 'radio' &&
          (b as HTMLInputElement).type !== 'checkbox'
        );
      })
      .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
  );
  expect(small).toEqual([]);
}

for (const [device, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
] as const) {
  test.describe(`on a ${device}`, () => {
    test.use({ viewport });
    for (const theme of ['day', 'evening'] as const) {
      test(`[RWD-01][NFR-11] the list and the form fit a ${device} in ${theme}: no sideways scroll, 44 px targets, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/goals?theme=${theme}`);
        await fits(page, viewport.width);
        await contrastOk(page);
        await page.goto(`/dev/goals?form=new&theme=${theme}`);
        await page.getByRole('button', { name: 'Add a rule' }).click();
        await page.getByRole('combobox', { name: 'Counts' }).nth(1).selectOption('STREAK');
        await page.getByRole('radio', { name: 'A reward from the shop' }).check();
        await fits(page, viewport.width);
        await contrastOk(page);
        // [RWD-14] The dates with an end date and without one, and the box ticked with no date yet.
        await page.goto(`/dev/goals?form=started&theme=${theme}`);
        await expect(page.getByLabel('End date')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
        await fits(page, viewport.width);
        await contrastOk(page);
        await page.goto(`/dev/goals?form=no-end&theme=${theme}`);
        await expect(page.getByLabel('End date')).toHaveCount(0);
        await fits(page, viewport.width);
        await contrastOk(page);
        await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
        await page.getByRole('checkbox', { name: 'Ends on a date' }).check();
        await expect(page.getByLabel('End date')).toBeVisible();
        await fits(page, viewport.width);
        await contrastOk(page);
        // [RWD-10] The preview of a change: its table scrolls inside itself, never the page.
        await page.goto(`/dev/goals?form=preview&theme=${theme}`);
        await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();
        await fits(page, viewport.width);
        await contrastOk(page);
      });
    }
  });
}

test('[RWD-04][RWD-07] goals in play: achieved first, each rule’s meter and where it stands', async ({
  page,
}) => {
  await page.goto('/dev/goals');
  const inPlay = page.getByRole('list', { name: 'Goals in play' });
  await expect(inPlay.getByRole('listitem')).toHaveCount(4);
  await expect(inPlay.getByRole('listitem').first()).toContainText('Trip to the park');
  await expect(inPlay.getByRole('listitem').first()).toContainText('Achieved again');
  const movie = inPlay.getByRole('listitem').filter({ hasText: 'Movie night' });
  await expect(movie).toContainText('Leo · Started Sat, Oct 3 · ends Sat, Oct 17');
  await expect(movie.getByRole('progressbar', { name: '19 things done' })).toHaveAttribute(
    'aria-valuenow',
    '95',
  );
  await expect(movie).toContainText('18 of 19 · 95%');
  const park = inPlay.getByRole('listitem').filter({ hasText: 'Trip to the park' });
  await expect(park).toContainText('5 good days in a row (1 miss a week forgiven)');
  await expect(park).toContainText('20 things done, tagged Morning or Kitchen');
  await expect(park).toContainText('Reached when every rule is met.');
  await expect(park).toContainText('Reached. 5 in a row now.');
  await expect(inPlay.getByRole('listitem').filter({ hasText: 'Pizza night' })).toContainText(
    'The whole family · Started Sat, Oct 3, no end date',
  );
  const bike = inPlay.getByRole('listitem').filter({ hasText: 'Bike ride' });
  await expect(bike).toContainText('Starts later');
  await expect(bike).toContainText('Working out its progress');
});

test('[RWD-09][US-405] an achieved goal is marked redeemed; history keeps the rest', async ({
  page,
}) => {
  await page.goto('/dev/goals');
  await expect(page.getByRole('button', { name: 'Mark Trip to the park redeemed' })).toBeVisible();
  await expect(page.getByRole('button', { name: /redeemed$/ })).toHaveCount(1);
  const history = page.getByRole('list', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(history.getByRole('listitem').filter({ hasText: 'Zoo trip' })).toContainText(
    'Redeemed Thu, Oct 1 by Alex',
  );
  await expect(history.getByRole('listitem').filter({ hasText: 'Zoo trip' })).toContainText(
    'Needs a look',
  );
  await expect(history.getByRole('listitem').filter({ hasText: 'New book' })).toContainText(
    'Ended Wed, Sep 30',
  );
});

test('[RWD-02][RWD-03] the form: rules added up to five and removed; tags or items to count; all or any', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  await expect(form.getByRole('group', { name: 'Rule', exact: true })).toBeVisible();
  await expect(form.getByRole('group', { name: 'It’s reached when' })).toHaveCount(0);
  for (let i = 0; i < 4; i++) await form.getByRole('button', { name: 'Add a rule' }).click();
  await expect(form.getByRole('group', { name: /^Rule \d$/ })).toHaveCount(5);
  await expect(form.getByRole('button', { name: 'Add a rule' })).toHaveCount(0);
  await expect(form.getByRole('group', { name: 'It’s reached when' })).toBeVisible();
  await form.getByRole('button', { name: 'Remove rule 2' }).click();
  await expect(form.getByRole('group', { name: /^Rule \d$/ })).toHaveCount(4);
  const rule1 = form.getByRole('group', { name: 'Rule 1' });
  await rule1.getByRole('radio', { name: 'Some tags' }).check();
  await expect(
    rule1.getByRole('group', { name: 'Tags for rule 1' }).getByRole('checkbox'),
  ).toHaveCount(2);
  await rule1.getByRole('combobox', { name: 'Counts' }).selectOption('STREAK');
  await expect(rule1.getByRole('combobox', { name: 'Misses forgiven a week' })).toHaveValue('1');
  // Who it's for: the children who earn rewards, or the whole family.
  await expect(form.getByRole('group', { name: 'Who it’s for' }).getByRole('radio')).toHaveCount(3);
});

test('[RWD-06] a started goal keeps who it’s for and its start date; its rules can change', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=started');
  const form = page.getByRole('form', { name: 'Edit Trip to the park' });
  await expect(form.getByRole('group', { name: 'Who it’s for' })).toHaveCount(0);
  await expect(form.getByLabel('Starts')).toHaveCount(0);
  await expect(form.getByLabel('End date')).toHaveValue('2026-10-24');
  await expect(form.getByRole('group', { name: /^Rule \d$/ })).toHaveCount(2);
  await expect(form.getByRole('radio', { name: 'Any one rule is met' })).toBeChecked();
  await expect(
    form.getByRole('group', { name: 'Rule 2' }).getByRole('checkbox', { name: 'Morning' }),
  ).toBeChecked();
});

test('[RWD-14] the end date: ticked shows the date and Clear; Clear and unticking take it off; the date is the field’s value, not its default', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=started');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const form = page.getByRole('form', { name: 'Edit Trip to the park' });
  const ends = form.getByRole('group', { name: 'Ends' });
  const box = ends.getByRole('checkbox', { name: 'Ends on a date' });
  const date = ends.getByLabel('End date');
  await expect(box).toBeChecked();
  await expect(date).toHaveValue('2026-10-24');
  // Clear sits beside the date, never over it (an iPhone's tap there would open the picker).
  const [field, clear] = await Promise.all([
    date.boundingBox(),
    ends.getByRole('button', { name: 'Clear' }).boundingBox(),
  ]);
  expect(
    field!.x + field!.width,
    `date ${JSON.stringify(field)}, Clear ${JSON.stringify(clear)}`,
  ).toBeLessThanOrEqual(clear!.x);
  // A started goal's end date is today or later (D-115).
  await expect(date).toHaveAttribute('min', '2026-10-10');
  // An iPhone's picker puts a date field back to its default: none, so its clear empties it.
  await expect
    .poll(() =>
      date.evaluate((el: HTMLInputElement) => [el.defaultValue, el.getAttribute('value')]),
    )
    .toEqual(['', null]);

  await test.step('Clear empties the date and leaves the focus off it', async () => {
    await ends.getByRole('button', { name: 'Clear' }).click();
    await expect(date).toHaveValue('');
    await expect(ends.getByRole('button', { name: 'Clear' })).toHaveCount(0);
    await expect(ends).toContainText('Left empty, it saves with no end date.');
    await expect(date).not.toBeFocused();
  });
  await test.step('a date chosen again brings Clear back', async () => {
    await date.fill('2026-11-05');
    await expect(ends.getByRole('button', { name: 'Clear' })).toBeVisible();
  });
  await test.step('unticking hides the date and clears it; ticking again starts empty', async () => {
    await box.uncheck();
    await expect(date).toHaveCount(0);
    await expect(ends).toContainText('No end date.');
    await box.check();
    await expect(date).toHaveValue('');
  });
});

test('[RWD-14] a started goal with no end date: unticked at first, ticking it shows an empty date', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=no-end');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const ends = page.getByRole('group', { name: 'Ends' });
  await expect(ends.getByRole('checkbox', { name: 'Ends on a date' })).not.toBeChecked();
  await expect(ends.getByLabel('End date')).toHaveCount(0);
  await ends.getByRole('checkbox', { name: 'Ends on a date' }).check();
  await expect(ends.getByLabel('End date')).toHaveValue('');
  await ends.getByLabel('End date').fill('2026-10-31');
  await expect(ends.getByRole('button', { name: 'Clear' })).toBeVisible();
});

test('[RWD-14] a reached goal keeps its rules and dates (D-115)', async ({ page }) => {
  await page.goto('/dev/goals?form=reached');
  const form = page.getByRole('form', { name: 'Edit Trip to the park' });
  await expect(form.getByRole('group', { name: 'Ends' })).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Add a rule' })).toHaveCount(0);
  await expect(form.getByLabel('Name')).toBeEditable();
});

test('[RWD-13][US-409] what each goal pays, and a goal whose reward was given then undone needs a look', async ({
  page,
}) => {
  await page.goto('/dev/goals');
  const inPlay = page.getByRole('list', { name: 'Goals in play' });
  await expect(inPlay.getByRole('listitem').filter({ hasText: 'Movie night' })).toContainText(
    'Pays 50 points',
  );
  const park = inPlay.getByRole('listitem').filter({ hasText: 'Trip to the park' });
  await expect(park).toContainText('Pays Ice cream from the shop');
  await expect(park).toContainText('Needs a look');
  await expect(inPlay.getByRole('listitem').filter({ hasText: 'Pizza night' })).not.toContainText(
    'Pays',
  );
});

test('[RWD-13] the form: the celebration, points, or a reward from the shop (a child’s goal only)', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  const pays = form.getByRole('group', { name: 'What reaching it pays' });
  await expect(pays.getByRole('radio', { name: 'Just the celebration' })).toBeChecked();
  await pays.getByRole('radio', { name: 'Points', exact: true }).check();
  await expect(pays.getByRole('spinbutton', { name: 'Points paid' })).toHaveValue('10');
  await pays.getByRole('radio', { name: 'A reward from the shop' }).check();
  await expect(pays.getByRole('combobox', { name: 'Reward' })).toHaveValue(
    'f2f00000-0000-4000-8000-000000000001',
  );
  await expect(pays.getByRole('combobox', { name: 'Reward' })).toContainText(
    'Ice cream (30 points in the shop)',
  );
  // The whole family: points to each child, or the celebration; not a reward from the shop.
  await form
    .getByRole('group', { name: 'Who it’s for' })
    .getByRole('radio', { name: 'The whole family' })
    .check();
  await expect(pays.getByRole('radio', { name: 'A reward from the shop' })).toBeDisabled();
  await expect(pays.getByRole('radio', { name: 'Just the celebration' })).toBeChecked();
  await pays.getByRole('radio', { name: 'Points', exact: true }).check();
  await expect(pays).toContainText('Each child who earns rewards gets them');
  await expect(form.getByRole('button', { name: 'Preview' })).toBeVisible();
});

test('[RWD-10][US-406] the preview: what saving would do, and each rule now and after', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=preview');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview).toContainText('Its progress goes from 96% to 88%.');
  await expect(preview.getByRole('columnheader')).toHaveText(['Rule', 'Now', 'After saving']);
  await expect(preview.getByRole('row', { name: /25 things done, tagged Morning/ })).toContainText(
    'New or changed22 of 25',
  );
  await expect(preview.getByRole('row', { name: /The goal/ })).toContainText('96% there88% there');
  await expect(preview).toContainText('Nothing is saved until you save.');
  // The started goal's payout stays its own: a reward from the shop.
  await expect(
    page
      .getByRole('group', { name: 'What reaching it pays' })
      .getByRole('radio', { name: 'A reward from the shop' }),
  ).toBeChecked();
});
