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
        // [RWD-15-l] A repeating goal's page: its form and its weeks, folded and opened.
        await page.goto(`/dev/goals?form=repeating&theme=${theme}`);
        await page.locator('summary').filter({ hasText: 'Weeks' }).click();
        await fits(page, viewport.width);
        await contrastOk(page);
        await page.goto(`/dev/goals?form=new&theme=${theme}`);
        await page.getByRole('button', { name: 'Add a rule' }).click();
        // [D-128] Adding a rule opens it; the first stays open too.
        await page.getByRole('combobox', { name: 'Counts' }).last().selectOption('STREAK');
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
  // Each goal is a list item of its own (a repeating goal's days and weeks are lists inside it).
  await expect(inPlay.locator(':scope > li')).toHaveCount(6);
  await expect(inPlay.getByRole('listitem').first()).toContainText('Trip to the park');
  await expect(inPlay.getByRole('listitem').first()).toContainText('Achieved again');
  const movie = inPlay.getByRole('listitem').filter({ hasText: 'Movie night' });
  await expect(movie).toContainText('Leo · Started Sat, Oct 3, 2026 · ends Sat, Oct 17, 2026');
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
    'The whole family · Started Sat, Oct 3, 2026, no end date',
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
  // History is folded (D-120) to its counts, with the goal that needs a look on the header.
  const fold = page.locator('summary').filter({ hasText: 'History' });
  await expect(fold).toContainText('1 redeemed · 1 ended · 1 cancelled');
  await expect(fold).toContainText('1 needs a look');
  await fold.click();
  const history = page.getByRole('list', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(history.getByRole('listitem').filter({ hasText: 'Zoo trip' })).toContainText(
    'Redeemed Thu, Oct 1, 2026 by Alex',
  );
  await expect(history.getByRole('listitem').filter({ hasText: 'Zoo trip' })).toContainText(
    'Needs a look',
  );
  await expect(history.getByRole('listitem').filter({ hasText: 'New book' })).toContainText(
    'Ended Wed, Sep 30, 2026',
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
  // [D-128] A new goal's rule and each one added are open, any number at once.
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
  // [D-128] A saved goal's rules are folded to their lines; a tap opens one.
  const rule2 = form.getByRole('group', { name: 'Rule 2' });
  await expect(rule2.getByRole('button', { name: /^Counts/ })).toContainText(
    'Things done: 20 · Morning items',
  );
  await rule2.getByRole('button', { name: /^Counts/ }).click();
  await expect(rule2.getByRole('checkbox', { name: 'Morning' })).toBeChecked();
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

test('[RWD-13] the form: points, a reward from the shop (a child’s goal only), or something else', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  const pays = form.getByRole('group', { name: 'What reaching it pays' });
  await expect(pays.getByRole('radio', { name: 'Something else' })).toBeChecked();
  await pays.getByRole('radio', { name: 'Points', exact: true }).check();
  await expect(pays.getByRole('spinbutton', { name: 'Points paid' })).toHaveValue('10');
  await pays.getByRole('radio', { name: 'A reward from the shop' }).check();
  await expect(pays.getByRole('combobox', { name: 'Reward' })).toHaveValue(
    'f2f00000-0000-4000-8000-000000000001',
  );
  await expect(pays.getByRole('combobox', { name: 'Reward' })).toContainText(
    'Ice cream (30 points in the shop)',
  );
  // The whole family: points to each child, or something else; not a reward from the shop.
  await form
    .getByRole('group', { name: 'Who it’s for' })
    .getByRole('radio', { name: 'The whole family' })
    .check();
  await expect(pays.getByRole('radio', { name: 'A reward from the shop' })).toBeDisabled();
  await expect(pays.getByRole('radio', { name: 'Something else' })).toBeChecked();
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

test('[RWD-15-l][RWD-16][US-410] a repeating goal on Goals: this week’s days, a lost week, and the weeks', async ({
  page,
}) => {
  await page.goto('/dev/goals');
  const inPlay = page.getByRole('list', { name: 'Goals in play' });
  const maya = inPlay.getByRole('listitem').filter({ hasText: 'Homework home every school day' });
  await expect(maya).toContainText('Maya · each week · Pays 10 points');
  await expect(maya).toContainText('This week: 3 of 4 days · Friday no school');
  await expect(maya.locator('.fw-goal__status')).toHaveText('Going');
  const days = maya.getByRole('list', { name: 'This week’s days' }).getByRole('listitem');
  await expect(days).toHaveCount(5);
  await expect(days.nth(4)).toHaveAttribute('aria-label', 'Fri: no school');
  await expect(maya).toContainText('Won 3 of the last 4 weeks');
  await expect(
    maya.getByRole('list', { name: 'The last 5 weeks' }).getByRole('listitem').nth(2),
  ).toHaveAttribute('aria-label', 'Week of Sep 28: missed');
  // Leo's, one miss allowed, lost on its second miss: no part count, starts again next week.
  const leo = inPlay.getByRole('listitem').filter({ hasText: 'Reading every day it’s due' });
  await expect(leo).toContainText('Leo · each week · 1 miss allowed · Pays 10 points');
  await expect(leo.locator('.fw-goal__status')).toHaveText('Missed this week');
  await expect(leo.locator('.fw-goal-line')).toHaveText(
    'Missed Tuesday and Wednesday. Starts again Monday, Oct 19.',
  );
  // A break week neither won nor missed is left out of the count.
  await expect(leo).toContainText('Won 2 of the last 4 weeks');
});

test('[RWD-15-l][RWD-15-e] a repeating goal’s page: how it repeats stays, its rule and its weeks', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=repeating');
  const form = page.getByRole('form', { name: 'Edit Homework home every school day' });
  // Started: how it repeats is fixed (D-123), sent back as it is.
  await expect(form.getByRole('group', { name: 'Repeats' })).toHaveCount(0);
  await expect(form.locator('input[name="repeat"]')).toHaveValue('week');
  await expect(form.getByRole('combobox', { name: 'Counts' })).toHaveValue('DAYS_DUE');
  await expect(form.getByRole('combobox', { name: 'Misses allowed each week' })).toHaveValue('0');
  await expect(form.getByRole('spinbutton', { name: 'Target' })).toHaveCount(0);
  await expect(form.getByRole('group', { name: 'What each week pays' })).toBeVisible();
  await expect(form).toContainText('This week Homework home is due 4 days, so this week needs 4.');
  const weeks = page.locator('summary').filter({ hasText: 'Weeks' });
  await expect(weeks).toContainText('Won 3 of the last 4 weeks');
  await expect(weeks).toContainText('30 points paid · this week 3 of 4 days');
  await weeks.click();
  const rows = page.getByRole('list', { name: 'Weeks' }).locator(':scope > li');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('This week, Oct 12 to 18');
  await expect(rows.nth(0)).toContainText('Going · 3 of 4 days · Friday no school');
  await expect(rows.nth(2)).toContainText('Sep 28 to Oct 4');
  await expect(rows.nth(2)).toContainText('Missed Tuesday. · 4 of 5 days');
  await expect(rows.nth(1)).toContainText('+10');
});

test('[RWD-15-l][RWD-16-i] a new goal: choosing how it repeats offers "every day it’s due" and its misses', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  const repeats = form.getByRole('group', { name: 'Repeats' });
  await expect(repeats.getByRole('radio', { name: 'Doesn’t repeat' })).toBeChecked();
  const counts = form.getByRole('combobox', { name: 'Counts' });
  await expect(counts.getByRole('option', { name: 'Every day it’s due' })).toHaveCount(0);
  await repeats.getByRole('radio', { name: 'Each week' }).check();
  await expect(form.getByRole('group', { name: 'What each week pays' })).toBeVisible();
  await counts.selectOption('DAYS_DUE');
  await expect(form.getByRole('spinbutton', { name: 'Target' })).toHaveCount(0);
  await form.getByRole('combobox', { name: 'Misses allowed each week' }).selectOption('1');
  await repeats.getByRole('radio', { name: 'Each school term' }).check();
  await expect(form.getByRole('combobox', { name: 'Misses allowed each term' })).toHaveValue('1');
  // Back to a goal reached once: the rule can't be "every day it's due".
  await repeats.getByRole('radio', { name: 'Doesn’t repeat' }).check();
  await expect(counts).toHaveValue('COUNT');
  await expect(form.getByRole('group', { name: 'What reaching it pays' })).toBeVisible();
});
