import { expect, test, type Page } from '@playwright/test';

// [RWD-21][D-146] A goal's Some items (WP-114), on the made-up family's /dev page with no database:
// only Leo's items that repeat or are still to do, and every item the goal counts kept, flagged,
// under Still counted. Today is Tuesday, Oct 27, 2026. It runs as a desktop Chrome, as an iPhone in
// WebKit (`iphone`) and as Safari on a Mac (`mac`).

const hydrated = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');

/** Each line of the rule's Some items, in order: group names and items with their day or flags. */
const lines = (page: Page) =>
  page
    .getByRole('group', { name: 'Items for rule 1' })
    .locator(':scope > .fw-goal-items__head, :scope label')
    .allInnerTexts()
    .then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim()));

/** The item ids the form would send for its one rule. */
const sent = (page: Page) =>
  page
    .locator('form.fw-form')
    .evaluate((f: HTMLFormElement) => new FormData(f).getAll('rule-r1-item').length);

test('[RWD-21-f] a done and an archived item the goal counts stay ticked under Still counted, and are sent', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=items');
  await hydrated(page);
  expect(await lines(page)).toEqual([
    'Repeats',
    'Brush teeth',
    'Feed the dog',
    'Homework',
    'Make bed',
    'Once, still to do',
    'Return library books Overdue 10/26/2026',
    'Pack for the school trip 10/30/2026',
    'Carve the pumpkin 10/31/2026',
    'Write thank-you cards 11/05/2026',
    'Still counted',
    'Clean out the car done',
    'Water the plants archived',
  ]);
  await expect(page.getByRole('checkbox', { name: 'Clean out the car done' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Water the plants archived' })).toBeChecked();
  expect(await sent(page), 'Feed the dog, Clean out the car and Water the plants').toBe(3);
});

test('[RWD-21-g] changing Leo to Maya flags Feed the dog "not for Maya", still ticked; unticked, it stays on the form', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=items-new');
  await hydrated(page);
  await test.step('Maya’s items, and Leo’s Feed the dog kept', async () => {
    await page.getByRole('radio', { name: 'Maya' }).check();
    await expect(page.getByRole('checkbox', { name: 'Feed the dog not for Maya' })).toBeChecked();
    expect(await lines(page)).toEqual([
      'Repeats',
      'Brush teeth',
      'Homework',
      'Read 20 minutes',
      'Set the table',
      'Once, still to do',
      'Try on the costume 10/31/2026',
      'Still counted',
      'Feed the dog not for Maya',
    ]);
    await expect(page.getByRole('checkbox', { name: 'Homework' })).toBeChecked();
    expect(await sent(page), 'Feed the dog and Homework').toBe(2);
  });
  await test.step('unticked, it stays, so it can be ticked again', async () => {
    const dog = page.getByRole('checkbox', { name: 'Feed the dog not for Maya' });
    await dog.uncheck();
    await expect(dog).not.toBeChecked();
    expect(await sent(page), 'Homework alone').toBe(1);
    await dog.check();
    await expect(dog).toBeChecked();
  });
  await test.step('back to Leo, it is listed again', async () => {
    await page.getByRole('radio', { name: 'Leo' }).check();
    await expect(page.getByRole('checkbox', { name: 'Feed the dog', exact: true })).toBeChecked();
    expect(await lines(page)).not.toContain('Still counted');
  });
});

test('[RWD-21-i] the rule’s folded line names the items it counts that aren’t listed', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=items');
  await hydrated(page);
  await page.getByRole('button', { name: 'Done with rule 1' }).click();
  await expect(page.getByRole('button', { name: /^What counts/ })).toHaveText(
    'Some items: Feed the dog, Clean out the car or Water the plants',
  );
});

test('[RWD-21-j] a goal ending Oct 29 lists no chore after it; a ticked one is kept, "after the goal ends"', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=items-dates');
  await hydrated(page);
  const all = await lines(page);
  expect(all).not.toContain('Pack for the school trip 10/30/2026');
  expect(all).toContain('Write thank-you cards 11/05/2026');
  await expect(
    page.getByRole('checkbox', { name: 'Carve the pumpkin after the goal ends' }),
  ).toBeChecked();
});
