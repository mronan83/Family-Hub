import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './test';

// [PTS-09] Penalties (WP-120, D-154, D-156) on their /dev pages, as the approved mockup draws them:
// made-up family, no database. The board (?penalties=1): Maya's points list tags a penalty with its
// reason, her Owes card lists what she owes, and the rail says it. The admin app: Settings, Penalties
// (the on/off and the reasons), Home's Give a penalty, Maya's Penalties (Record paid, Take back) and the
// register's Penalty type. On the preview, e2e/tests/penalties.spec.ts gives, pays and takes back
// penalties in the database (PTS-09-m). [PTS-10] And the penalty rules of WP-121 (D-157): Settings'
// Penalty rules, the rule form, a rule's misses on Maya's page, in the register and on the board's Owes
// card; on the preview, e2e/tests/penalty-rules.spec.ts (PTS-10-m).

const people = (page: Page) => page.getByRole('list', { name: 'Family', exact: true });

async function open(page: Page, url: string) {
  await page.goto(url);
  // [D-110] React has hydrated the page: its handlers are live.
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

test.describe('the board', () => {
  test('[PTS-09-k][US-1111] a penalty shows with its reason, and what Maya owes on her screen and in the rail', async ({
    page,
  }) => {
    await open(page, '/dev/board?penalties=1');
    await expect(people(page).locator('[data-owes]')).toHaveText(['Owes $3']);
    await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
    const points = page.getByRole('list', { name: 'Points' }).getByRole('listitem');
    await expect(points.first()).toHaveText(/Penalty\s*Rude to a sibling\s*−10/);
    await expect(points.first()).toHaveAttribute('data-type', 'penalty');
    const owes = page.getByRole('region', { name: 'Owes' });
    await expect(owes).toHaveAttribute('data-owed', '300');
    await expect(owes.getByRole('heading', { name: 'Owes' })).toBeVisible();
    await expect(owes.getByRole('listitem')).toHaveText([
      /Left bike in the driveway\s*\$1/,
      /Folder home: missed \w+ and \w+\s*\$2/,
    ]);
    // Board text is at least 28 px.
    const size = await owes
      .getByRole('listitem')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `the Owes card's text is ${size}px`).toBeGreaterThanOrEqual(28);
    // The tag and the rail's chip are board text too.
    for (const el of [
      points.first().locator('.fw-today__penalty-tag'),
      people(page).locator('[data-owes]'),
    ]) {
      const px = await el.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      expect(px, `the penalty's tag or chip is ${px}px`).toBeGreaterThanOrEqual(28);
    }
    const axe = await new AxeBuilder({ page }).include('.fw-today__owes').analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test('[PTS-09-k] points below zero after a penalty: "to earn back" on Maya\'s screen, "−8" in the rail, nothing past its edge', async ({
    page,
  }) => {
    await open(page, '/dev/board?penalties=below');
    const pill = people(page).locator('[data-pill-balance="-8"]');
    await expect(pill).toHaveText('−8');
    const rail = await people(page).boundingBox();
    const box = await pill.boundingBox();
    expect(box!.x + box!.width, "the rail's chip stays inside the rail").toBeLessThanOrEqual(
      rail!.x + rail!.width,
    );
    await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
    await expect(
      page.locator('.fw-today__me, main').getByText('−8 to earn back').first(),
    ).toBeVisible();
  });

  test('[PTS-09-k] with nothing owed, or penalties off, there is no Owes card and no chip', async ({
    page,
  }) => {
    await open(page, '/dev/board?penalties=1');
    await people(page).getByRole('button', { name: 'Leo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Leo', level: 2 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Owes' })).toHaveCount(0);
    await open(page, '/dev/board');
    await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Owes' })).toHaveCount(0);
    await expect(people(page).locator('[data-owes]')).toHaveCount(0);
  });
});

test.describe('the board: penalty rules', () => {
  test("[PTS-10-l][US-1112] the Owes card shows a rule's misses on one line, in board-size text", async ({
    page,
  }) => {
    await open(page, '/dev/board?penalties=1');
    await people(page).getByRole('button', { name: 'Maya', exact: true }).click();
    const rule = page.getByRole('region', { name: 'Owes' }).locator('li[data-rule="true"]');
    await expect(rule).toHaveText(
      /^Folder home: missed (Mon|Tue|Wed|Thu|Fri|Sat|Sun) and (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*\$2$/,
    );
    const px = await rule.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(px, `the rule's line is ${px}px`).toBeGreaterThanOrEqual(28);
  });
});

test.describe('the admin app', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[PTS-09-l] Settings: Penalties on, its reasons, and Add a reason', async ({ page }) => {
    await open(page, '/dev/settings');
    const tile = page
      .getByRole('list', { name: 'Settings', exact: true })
      .getByRole('link', { name: /Penalties/ });
    await expect(tile).toHaveAttribute('href', '/admin/settings/penalties');
    await expect(tile).toContainText('On · 4 reasons');
    await open(page, '/dev/settings/penalties');
    await expect(page.getByRole('heading', { name: 'Penalties', level: 1 })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Penalties' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Penalties are on' })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Penalty reasons' }).getByRole('listitem'),
    ).toHaveText([
      /Rude to a sibling\s*10 points\s*Remove/,
      /Screen time after bedtime\s*20 points · used by 1 rule\s*Remove/,
      /Left bike in the driveway\s*\$1\s*Remove/,
      /Homework folder not home\s*\$1 · used by 1 rule\s*Remove/,
    ]);
    const add = page.getByRole('form', { name: 'Add a reason' });
    await add.getByRole('radio', { name: 'Money' }).check();
    await expect(add.getByLabel('Money')).toBeChecked();
    await expect(add.getByLabel('Amount')).toHaveAttribute('inputmode', 'decimal');
    await open(page, '/dev/settings/penalties?state=off');
    await expect(page.getByRole('switch', { name: 'Penalties' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByText('No reasons yet. Add the first one below.')).toBeVisible();
  });

  test('[PTS-09-l][US-1111] Home: Give a penalty fills the amount from the reason and says what the board will show', async ({
    page,
  }) => {
    await open(page, '/dev/home');
    await expect(page.getByRole('form', { name: 'Give a penalty' })).toHaveCount(0);
    await open(page, '/dev/home?penalties=1');
    const form = page.getByRole('form', { name: 'Give a penalty' });
    const give = form.getByRole('button', { name: 'Give the penalty' });
    // Nobody is chosen for them: the parent picks who.
    await expect(give).toBeDisabled();
    await form.getByRole('radio', { name: 'Leo' }).check();
    await expect(form.getByLabel(/^Penalty, in/)).toHaveValue('10');
    await expect(form.locator('.fw-penalty__preview')).toContainText('Rude to a sibling −10');
    await form.getByRole('radio', { name: /^Left bike in the driveway/ }).check();
    await expect(form.getByLabel('Penalty, in dollars')).toHaveValue('1');
    await expect(form.locator('.fw-penalty__preview')).toContainText(
      'On the board, Leo sees: Left bike in the driveway $1 owed.',
    );
    await expect(give).toBeEnabled();
  });

  test('[PTS-09-l][US-1111] Maya’s Penalties: what she owes, Record paid on each, the history with Take back', async ({
    page,
  }) => {
    await open(page, '/dev/members?page=member&penalties=1');
    await expect(page.locator('.fw-penalty__owes')).toHaveText('Maya owes $3');
    const owing = page.getByRole('list', { name: 'What Maya owes' }).getByRole('listitem');
    await expect(owing).toHaveCount(2);
    await expect(owing.first()).toContainText('Left bike in the driveway');
    await expect(
      page
        .getByRole('form', { name: 'Record paid for Left bike in the driveway' })
        .getByLabel('Paid'),
    ).toHaveValue('1');
    await expect(owing.nth(1)).toContainText('Folder home');
    const history = page.getByRole('list', { name: 'Maya’s penalties' }).getByRole('listitem');
    await expect(history.first()).toContainText('Today Rude to a sibling Penalty by Sam');
    await expect(history.first()).toContainText('−10 pts');
    // Take back on each penalty not yet taken back, and never on a payment or a take-back.
    // A rule's misses have Take back too (the owner, 21 November).
    await expect(page.getByRole('button', { name: 'Take back' })).toHaveCount(4);
    await expect(history.filter({ hasText: 'Taken back' })).toHaveCount(1);
    await open(page, '/dev/members?page=member&penalties=give');
    const give = page.getByRole('form', { name: 'Give a penalty' });
    await expect(give.getByRole('radiogroup')).toHaveCount(0);
    await expect(give.locator('input[name="memberId"]')).toHaveValue(/^[0-9a-f-]{36}$/);
  });

  test('[PTS-09-l] the points register lists penalties as their own type', async ({ page }) => {
    await open(page, '/dev/rewards/points?penalties=1&type=penalty');
    const kinds = page.locator('.fw-kind');
    await expect(kinds).toHaveText(['Penalty', 'Penalty', 'Penalty', 'Penalty', 'Penalty']);
    await expect(page.getByText('Rude to a sibling')).toBeVisible();
    await expect(page.getByText('Slammed a door, taken back')).toBeVisible();
  });

  test('[PTS-10-k][US-1112] Settings: the penalty rules, each with its line and what it has on each person', async ({
    page,
  }) => {
    await open(page, '/dev/settings/penalties');
    const rules = page.getByRole('list', { name: 'Penalty rules' }).getByRole('listitem');
    await expect(rules).toHaveCount(2);
    await expect(rules.first()).toContainText('Folder home');
    await expect(rules.first()).toContainText(
      'Maya · Homework folder home · $1 a missed school day · max $10 · Nov 16 to Jan 31',
    );
    await expect(rules.first()).toContainText('Maya owes $2');
    await expect(rules.nth(1)).toContainText(
      'Leo · tag Bedtime · 5 points a miss · max 25 points · Nov 2 to Jan 1',
    );
    await expect(rules.nth(1)).toContainText('Nothing owed');
    await expect(rules.first().getByRole('link', { name: 'Edit Folder home' })).toHaveAttribute(
      'href',
      '/admin/settings/penalties/rules/0de0a900-0000-4000-8000-000000000001',
    );
    await expect(page.getByRole('link', { name: 'Add a rule' })).toHaveAttribute(
      'href',
      '/admin/settings/penalties/rules/new',
    );
    await open(page, '/dev/settings/penalties?state=off');
    await expect(page.getByText('Turn penalties on to add a rule.')).toBeVisible();
  });

  test('[PTS-10-k][US-1112] the rule form: name, reason, for, what counts, dates, each miss and the max', async ({
    page,
  }) => {
    await open(page, '/dev/settings/penalties/rule');
    await expect(page.getByRole('heading', { name: 'Folder home', level: 1 })).toBeVisible();
    const form = page.getByRole('form', { name: 'Penalty rule' });
    await expect(form.getByLabel('Name')).toHaveValue('Folder home');
    await expect(form.getByLabel('Reason', { exact: true })).toHaveValue(
      '0de0e000-0000-4000-8000-000000000004',
    );
    await expect(form.getByRole('checkbox', { name: 'Maya' })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Leo' })).not.toBeChecked();
    await expect(form.getByRole('radio', { name: 'Chosen items' })).toBeChecked();
    const items = form.getByRole('group', { name: 'Items' });
    await expect(items.getByRole('checkbox', { name: /Homework folder home/ })).toBeChecked();
    await expect(items).toContainText('Homework folder home · school days');
    // Only Maya's chores are listed while only Maya is chosen.
    await expect(items.getByRole('checkbox')).toHaveCount(2);
    await expect(form.getByLabel('Each miss adds')).toHaveValue('1');
    await expect(form.getByLabel('Max owed')).toHaveValue('10');
    await expect(form.locator('.fw-seg__item[data-on="true"]')).toHaveText('Money');
    await expect(form.locator('.fw-rule__never li')).toHaveText([
      'A skipped or covered day, a day off or a no-school day adds nothing.',
      'Mark done on time on a missed day takes its $1 back.',
      'After the end date nothing is added; what’s owed stays until it’s paid.',
    ]);
    await form.getByRole('radio', { name: 'A tag' }).check();
    await expect(form.getByLabel('Tag', { exact: true })).toBeVisible();
    await form.getByRole('radio', { name: 'All their items' }).check();
    await expect(
      form.getByText('Every chore of theirs counts. A task is never missed.'),
    ).toBeVisible();
    await expect(form.getByRole('button', { name: 'Save the rule' })).toBeEnabled();
    // Add a rule: a reason fills in the name and the amount, in its unit.
    await open(page, '/dev/settings/penalties/rule?state=new');
    await expect(page.getByRole('heading', { name: 'Add a rule', level: 1 })).toBeVisible();
    const add = page.getByRole('form', { name: 'Penalty rule' });
    await add
      .getByLabel('Reason', { exact: true })
      .selectOption({ label: 'Screen time after bedtime' });
    await expect(add.getByLabel('Name')).toHaveValue('Screen time after bedtime');
    await expect(add.getByLabel('Each miss adds')).toHaveValue('20');
    await expect(add.locator('.fw-seg__item[data-on="true"]')).toHaveText('Points');
  });

  test('[PTS-10-k][US-1112] Maya’s Penalties: a rule’s misses with Record paid, and its history rows tagged Rule', async ({
    page,
  }) => {
    await open(page, '/dev/members?page=member&penalties=1');
    const rule = page.getByRole('list', { name: 'What Maya owes' }).locator('[data-rule]');
    await expect(rule).toContainText('Folder home');
    await expect(rule).toContainText('$2');
    await expect(rule).toContainText(
      '$1 a missed school day · max $10 · Oct 12 to Dec 27 · missed Tue and Wed',
    );
    await expect(
      page.getByRole('form', { name: 'Record paid for Folder home' }).getByLabel('Paid'),
    ).toHaveValue('2');
    const history = page.getByRole('list', { name: 'Maya’s penalties' }).getByRole('listitem');
    await expect(history.filter({ hasText: 'Folder home, missed' })).toHaveText([
      /Yesterday Folder home, missed Rule\s*Take back\s*\+\$1 owed/,
      /Tue, Oct 13 Folder home, missed Rule\s*Take back\s*\+\$1 owed/,
    ]);
  });

  test('[PTS-10-k] the points register shows a rule’s miss, naming its rule', async ({ page }) => {
    await open(page, '/dev/rewards/points?penalties=1&type=penalty');
    const row = page.locator('.fw-row', { hasText: 'Bed by 8, missed Saturday' });
    await expect(row).toContainText('rule Bed by 8');
    await expect(row).toContainText('−5');
  });

  test('[PTS-10-n] Maya’s Penalties: Take back on each rule miss not taken back', async ({
    page,
  }) => {
    await open(page, '/dev/members?page=member&penalties=1');
    const misses = page
      .getByRole('list', { name: 'Maya’s penalties' })
      .getByRole('listitem')
      .filter({ hasText: 'Folder home, missed' });
    await expect(misses).toHaveCount(2);
    for (const row of await misses.all()) {
      await expect(row.getByRole('button', { name: 'Take back' })).toBeVisible();
    }
  });

  test('[PTS-10-o][PTS-10-p] the rule page: Stop now, and Remove only while it has added nothing', async ({
    page,
  }) => {
    await open(page, '/dev/settings/penalties/rule');
    const stop = page.getByRole('region', { name: 'Stop or remove' });
    await expect(stop.getByRole('button', { name: 'Stop now' })).toBeVisible();
    await expect(stop.getByRole('button', { name: 'Remove the rule' })).toHaveCount(0);
    await expect(stop).toContainText(
      'It has added 2 misses, so it can’t be removed; stop it instead.',
    );
    await open(page, '/dev/settings/penalties/rule?rule=bed');
    await expect(
      page
        .getByRole('region', { name: 'Stop or remove' })
        .getByRole('button', { name: 'Remove the rule' }),
    ).toBeVisible();
    await open(page, '/dev/settings/penalties/rule?state=stopped');
    await expect(page.getByText(/^Stopped Nov 19\. It adds nothing more/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Stop or remove' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save the rule' })).toBeDisabled();
  });
});
