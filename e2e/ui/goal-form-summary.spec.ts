import { expect, test, type Page } from '@playwright/test';

// [NFR-16][D-128] The goal form's last four differences from its mockups, closed (WP-101), on the
// made-up family's /dev pages with no database: a rule as one summary line with its weight, the live
// summaries where the frames place them, item pictures, and dates and times written as the frames
// write them while staying real pickers. Today is Thursday, Oct 15, 2026; Friday, Oct 16 is a
// teacher planning day. It runs as a desktop Chrome and as an iPhone in WebKit (the `iphone` project).

const hydrated = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
/** The form has its first live summaries back (or knows it has none). */
const live = (page: Page) =>
  expect(page.locator('form.fw-form')).toHaveAttribute('data-live', 'ready');

test('[NFR-16-j] two weighted rules fold to "Rule 1 · weight" lines with Weight beside each; a tap opens one', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=weighted');
  await hydrated(page);
  const form = page.getByRole('form', { name: 'Edit School week' });
  const rule1 = form.getByRole('group', { name: 'Rule 1 · weight' });
  const rule2 = form.getByRole('group', { name: 'Rule 2 · weight' });
  await test.step('each rule is one line, its weight beside it', async () => {
    await expect(rule1.getByRole('button', { name: /^Counts/ })).toHaveText(
      'Every day it’s due: Homework home, by 6:00 pm',
    );
    await expect(rule2.getByRole('button', { name: /^Counts/ })).toHaveText(
      'Things done: 5 · Reading',
    );
    await expect(rule1.getByRole('spinbutton', { name: 'Weight of rule 1, in %' })).toHaveValue(
      '60',
    );
    await expect(rule2.getByRole('spinbutton', { name: 'Weight of rule 2, in %' })).toHaveValue(
      '40',
    );
    await expect(rule1.getByText('Weight', { exact: true })).toBeVisible();
    // Folded, its fields aren't shown.
    await expect(rule1.getByRole('combobox', { name: 'Counts' })).toHaveCount(0);
    // The line and the weight side by side.
    const line = await rule1.getByRole('button', { name: /^Counts/ }).boundingBox();
    const weight = await rule1.getByRole('spinbutton').boundingBox();
    expect(weight!.x, 'the weight sits to the right of the line').toBeGreaterThan(
      line!.x + line!.width - 1,
    );
  });
  await test.step('a folded rule still sends every field as it stands', async () => {
    const sent = await form.evaluate((f: HTMLFormElement) => {
      const d = new FormData(f);
      const keys = String(d.get('rule-keys')).split(',');
      return keys.map((k) => ({
        type: d.get(`rule-${k}-type`),
        scope: d.get(`rule-${k}-scope`),
        items: d.getAll(`rule-${k}-item`).length,
        ontime: d.get(`rule-${k}-ontime`),
        at: d.get(`rule-${k}-ontime-at`),
        weight: d.getAll(`rule-${k}-weight`),
      }));
    });
    expect(sent).toEqual([
      { type: 'DAYS_DUE', scope: 'items', items: 1, ontime: 'by', at: '18:00', weight: ['60'] },
      { type: 'COUNT', scope: 'items', items: 1, ontime: 'any', at: '', weight: ['40'] },
    ]);
  });
  await test.step('a tap opens a rule; Done folds it again', async () => {
    await rule2.getByRole('button', { name: /^Counts/ }).click();
    await expect(rule2.getByRole('combobox', { name: 'Counts' })).toHaveValue('COUNT');
    await expect(rule2.getByRole('spinbutton', { name: 'Target' })).toHaveValue('5');
    await rule2.getByRole('button', { name: 'Done with rule 2' }).click();
    await expect(rule2.getByRole('combobox', { name: 'Counts' })).toHaveCount(0);
  });
  await test.step('more than one rule open at once; a new rule opens and the others stay as they are', async () => {
    await rule1.getByRole('button', { name: /^Counts/ }).click();
    await rule2.getByRole('button', { name: /^Counts/ }).click();
    await expect(rule1.getByRole('combobox', { name: 'Counts' })).toBeVisible();
    await expect(rule2.getByRole('combobox', { name: 'Counts' })).toBeVisible();
    await rule2.getByRole('button', { name: 'Done with rule 2' }).click();
    await form.getByRole('button', { name: 'Add a rule' }).click();
    const rule3 = form.getByRole('group', { name: 'Rule 3 · weight' });
    await expect(rule3.getByRole('combobox', { name: 'Counts' })).toBeVisible();
    await expect(rule1.getByRole('combobox', { name: 'Counts' })).toBeVisible();
    await expect(rule2.getByRole('combobox', { name: 'Counts' })).toHaveCount(0);
  });
  await test.step('a rule with something to fix stays open and says so', async () => {
    const rule3 = form.getByRole('group', { name: 'Rule 3 · weight' });
    await rule3.getByRole('radio', { name: 'Some items' }).check();
    await expect(rule3.getByText('Choose an item it counts.')).toBeVisible();
    await expect(rule3.getByRole('button', { name: 'Done with rule 3' })).toHaveCount(0);
    await rule3.getByRole('button', { name: 'Remove rule 3' }).scrollIntoViewIfNeeded();
    // Without something chosen it can't be folded: it stays open, still asking.
    await expect(rule3.getByText('Choose an item it counts.')).toBeVisible();
    await expect(rule3.getByRole('combobox', { name: 'Counts' })).toBeVisible();
  });
});

test('[NFR-16-j] a single rule keeps its fields; What counts is one line that opens to the choices', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=family');
  await hydrated(page);
  const rule = page.getByRole('group', { name: 'Rule', exact: true });
  await expect(rule.getByRole('combobox', { name: 'Counts' })).toHaveValue('DAYS_DUE');
  const what = rule.getByRole('button', { name: /^What counts/ });
  await expect(what).toHaveText('Some items: Homework home');
  await expect(rule.getByRole('group', { name: 'What counts' })).toHaveCount(0);
  await what.click();
  await expect(
    rule.getByRole('group', { name: 'Items for rule 1' }).getByRole('checkbox', {
      name: 'Homework home',
    }),
  ).toBeChecked();
  await rule.getByRole('button', { name: 'Done with rule 1' }).click();
  await expect(rule.getByRole('button', { name: /^What counts/ })).toBeVisible();
});

test('[NFR-16-n] item pictures beside their names in the choices and the summary line', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=homework');
  await hydrated(page);
  const items = page.getByRole('group', { name: 'Items for rule 1' });
  for (const [name, icon] of [
    ['Homework home', 'backpack'],
    ['Reading', 'book-open'],
    ['Make bed', 'chore-bed'],
  ] as const) {
    const label = items.locator('label').filter({ hasText: name });
    await expect(label.locator(`.fw-item-pic svg[data-icon="${icon}"]`)).toBeVisible();
  }
  await page.goto('/dev/goals?form=weighted');
  await hydrated(page);
  const line = page
    .getByRole('group', { name: 'Rule 1 · weight' })
    .getByRole('button', { name: /^Counts/ });
  await expect(line.locator('svg[data-icon="backpack"]')).toBeVisible();
});

test('[NFR-16-l] the live summaries show where the frames place them and change with the form', async ({
  page,
}) => {
  await test.step('under the rule: the week’s days due, the day off named, a normal week', async () => {
    await page.goto('/dev/goals?form=homework');
    await hydrated(page);
    await live(page);
    const rule = page.getByRole('group', { name: 'Rule', exact: true });
    const summary = rule.getByTestId('rule-1-summary');
    await expect(summary).toHaveText(
      'This week Homework home is due 4 days for Maya (Friday, Oct 16 is a teacher planning day), so this week needs 4. A normal week needs 5.',
    );
    // It sits under What counts, inside the rule, as the frame draws it.
    const what = await rule.getByRole('group', { name: 'What counts' }).boundingBox();
    const box = await summary.boundingBox();
    expect(box!.y).toBeGreaterThan(what!.y);
    await rule.getByRole('combobox', { name: 'Misses allowed each week' }).selectOption('1');
    await expect(summary).toContainText('so this week needs 3. A normal week needs 4.');
    // Preview stays.
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  });
  await test.step('every child: each child’s days and what each needs', async () => {
    await page.goto('/dev/goals?form=family');
    await hydrated(page);
    await live(page);
    await expect(page.getByTestId('rule-1-summary')).toHaveText(
      'This week Homework home is due 4 days for Maya and 4 days for Leo (Friday, Oct 16 is a teacher planning day): each needs 4.',
    );
  });
  await test.step('steps by days missed: what each step pays this week', async () => {
    await page.goto('/dev/goals?form=steps');
    await hydrated(page);
    await live(page);
    const steps = page.getByTestId('steps-summary');
    await expect(steps).toHaveText(
      'This week Homework home is due 4 days for Maya (Friday, Oct 16 is a teacher planning day): all 4 on time pays 20, 3 pays 10, 2 pays 5.',
    );
    await page.getByRole('spinbutton', { name: '1 missed' }).fill('12');
    await expect(steps).toContainText('3 pays 12');
  });
  await test.step('weights: the sum so far and what the week would pay', async () => {
    await page.goto('/dev/goals?form=weighted');
    await hydrated(page);
    await live(page);
    const weights = page.getByTestId('weights-summary');
    await expect(weights).toHaveText(
      'So far this week: Homework home 3 of 4 days (75%) × 60% = 45, Reading 4 of 5 (80%) × 40% = 32. 77%: 10 points if the week closes now.',
    );
    await page.getByRole('spinbutton', { name: 'Weight of rule 1, in %' }).fill('50');
    await page.getByRole('spinbutton', { name: 'Weight of rule 2, in %' }).fill('50');
    await expect(weights).toContainText('× 50% = 38');
    await expect(weights).toContainText('78%: 10 points');
  });
  await test.step('weeks won: the weeks that start on or after the goal’s start (D-126)', async () => {
    await page.goto('/dev/goals?form=perfect');
    await hydrated(page);
    await live(page);
    await expect(page.getByTestId('rule-1-summary')).toContainText(
      'A week counts when it starts on or after this goal’s start, Thu, Oct 15, 2026, so the first that counts is the week of Mon, Oct 19, 2026.',
    );
  });
});

test('[NFR-16-p] Starts, Ends and By show the written date or time over a real picker', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=homework');
  await hydrated(page);
  const form = page.getByRole('form', { name: 'Set a goal' });
  await test.step('Starts: the written date, the real field over it', async () => {
    const pick = form.locator('.fw-pick').filter({ has: page.getByLabel('Starts') });
    await expect(pick.locator('.fw-pick__words')).toHaveText('Mon, Oct 12, 2026');
    const field = form.getByLabel('Starts');
    await expect(field).toHaveAttribute('type', 'date');
    // On a phone the field starts below the fold; what is under a point is only known on screen.
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveValue('2026-10-12');
    // The field covers the words, so a tap anywhere on them lands on it and opens the picker.
    const [face, input] = await Promise.all([
      pick.locator('.fw-pick__face').boundingBox(),
      field.boundingBox(),
    ]);
    expect(Math.round(input!.width)).toBe(Math.round(face!.width));
    expect(Math.round(input!.height)).toBe(Math.round(face!.height));
    const hit = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
    });
    expect(hit, 'a tap on the written date lands on the date field').toBe(true);
    await field.fill('2026-10-19');
    await expect(pick.locator('.fw-pick__words')).toHaveText('Mon, Oct 19, 2026');
  });
  await test.step('Ends: the written date once ticked', async () => {
    await form.getByRole('checkbox', { name: 'Ends on a date' }).check();
    const field = page.getByLabel('End date');
    const pick = form.locator('.fw-pick').filter({ has: field });
    await expect(pick.locator('.fw-pick__words')).toHaveText('Choose a date');
    await field.fill('2026-12-18');
    await expect(pick.locator('.fw-pick__words')).toHaveText('Fri, Dec 18, 2026');
  });
  await test.step('By: the time as "6:00 pm"', async () => {
    await form.getByRole('radio', { name: 'By', exact: true }).check();
    const field = page.getByLabel('Time', { exact: true });
    const pick = form.locator('.fw-pick').filter({ has: field });
    await expect(field).toHaveAttribute('type', 'time');
    await expect(pick.locator('.fw-pick__words')).toHaveText('6:00 pm');
    await field.fill('07:30');
    await expect(pick.locator('.fw-pick__words')).toHaveText('7:30 am');
  });
  await test.step('a started goal’s start, and Goals, write the whole date', async () => {
    await page.goto('/dev/goals?form=repeating');
    await hydrated(page);
    await expect(page.getByText('Mon, Sep 14, 2026', { exact: true })).toBeVisible();
    await page.goto('/dev/goals');
    await expect(
      page
        .getByRole('list', { name: 'Goals in play' })
        .getByRole('listitem')
        .filter({ hasText: 'Movie night' }),
    ).toContainText('Started Sat, Oct 3, 2026 · ends Sat, Oct 17, 2026');
  });
});

test('[NFR-16-q] every rule field keeps a name the form lists, however many forms the server drew', async ({
  page,
}) => {
  // The server draws the form more than once (each visit); the names must match what rule-keys says.
  for (const path of [
    'form=weighted',
    'form=weighted',
    'form=new',
    'form=started',
    'form=family',
  ]) {
    await test.step(path, async () => {
      await page.goto(`/dev/goals?${path}`);
      await hydrated(page);
      const stray = await page.locator('form.fw-form').evaluate((f: HTMLFormElement) => {
        const keys = String(new FormData(f).get('rule-keys')).split(',');
        return [...f.elements]
          .map((el) => (el as HTMLInputElement).name)
          .filter((n) => n.startsWith('rule-') && n !== 'rule-keys')
          .filter((n) => !keys.includes(n.split('-')[1]!));
      });
      expect(stray, 'fields named for a rule the form doesn’t list').toEqual([]);
    });
  }
});
