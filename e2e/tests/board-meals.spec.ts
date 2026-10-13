import { appendFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '../support/test';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [MEAL-06][US-705] Meals on a board, on the preview (WP-28, D-80). The demo family has today's snacks
// (seeded); the spec plans today's breakfast, lunch and dinner. The done-when: the board's home screen
// shows the day's four meals and each child's lunch, buying or bringing, as lunch_mode() has it for
// today (none on a weekend or a day off). A dinner changed reaches the board through Realtime. The
// Meals screen shows the week, today marked, and each child's lunch each day as the database has it.
// The meals planned here are removed at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Meals e2e';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let board: Page;

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

const TODAY = `(now() at time zone 'America/New_York')::date`;
const WEEK = `(${TODAY} - extract(dow from ${TODAY})::integer)`;
const clear = () =>
  sql(`delete from public.meal_plan_entry
        where household_id = '${DEMO}' and free_text like '% e2e'`);
/** Plans a meal for everyone today, written in. */
const plan = (slot: string, name: string) =>
  sql(`insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, free_text)
       values (gen_random_uuid(), '${DEMO}', ${TODAY}, '${slot}', 9, '${name}')`);

/**
 * Each child's school lunch over the household week, as lunch_mode() has it: "date|name|mode" lines,
 * the mode empty on a day without school lunch.
 */
const lunches = () =>
  sql(`select d::date || '|' || m.display_name || '|' || coalesce(public.lunch_mode(m.id, d::date), '')
         from public.member m, generate_series(${WEEK}, ${WEEK} + 6, interval '1 day') d
        where m.household_id = '${DEMO}' and m.role = 'child' and m.archived_at is null
        order by d, m.display_name`)
    .split('\n')
    .map((l) => l.split('|') as [string, string, string]);
const today = () => sql(`select ${TODAY}`);

const rail = () => board.getByRole('list', { name: 'Family', exact: true });
const meals = () => board.getByRole('region', { name: 'Today’s meals', exact: true });

/** A place's lunches as they read: "Leo buys lunch", "Maya brings lunch" (what follows aside). */
const lunchLines = (scope: Locator) =>
  scope
    .locator('li[data-mode]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/:.*/, '')));
const expected = (rows: [string, string, string][]) =>
  rows.filter(([, , mode]) => mode).map(([, name, mode]) => `${name} ${mode}s lunch`);

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  clear();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  const admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  await admin.close();
  board = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  // Planned before the board opens: its first snapshot has them.
  plan('breakfast', 'Waffles e2e');
  plan('lunch', 'Soup e2e');
  plan('dinner', 'Stew e2e');
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  clear();
  await retireBoard(board, BOARD);
});

test('[MEAL-06][US-705] the done-when: the home screen shows the day’s four meals and each child’s lunch', async () => {
  await expect(meals()).toBeVisible();
  await expect(meals().locator('dt')).toHaveText(['Breakfast', 'Snack', 'Lunch', 'Dinner']);
  await expect(meals().locator('[data-slot="breakfast"]')).toContainText('Waffles e2e');
  // The seeded snacks: Maya's apple slices after school, and crackers for everyone.
  await expect(meals().getByRole('listitem', { name: 'Apple slices, for Maya' })).toBeVisible();
  await expect(meals().locator('[data-slot="snack"]')).toContainText('Crackers');
  await expect(meals().locator('[data-slot="lunch"]')).toContainText('Soup e2e');
  await expect(meals().locator('[data-slot="dinner"]')).toContainText('Stew e2e');
  // Each child's lunch today as the database has it: buying or bringing, or none on a day off.
  const day = lunches().filter(([d]) => d === today());
  const want = expected(day);
  await expect.poll(() => lunchLines(meals().locator('[data-slot="lunch"]'))).toEqual(want);
  report(`MEAL-06 today's lunch on the board: ${want.join(', ') || 'none (no school today)'}`);
});

test('[MEAL-06][DEV-05] a dinner changed reaches the board at once', async () => {
  await expect(meals().locator('[data-slot="dinner"]')).toContainText('Stew e2e');
  const changed = Date.now();
  sql(`update public.meal_plan_entry set free_text = 'Fish pie e2e'
        where household_id = '${DEMO}' and free_text = 'Stew e2e'`);
  await expect(meals().locator('[data-slot="dinner"]')).toContainText('Fish pie e2e', {
    timeout: 15_000,
  });
  report(`MEAL-06 a changed dinner reached the board in ${Date.now() - changed} ms`);
  await expect(meals().locator('[data-slot="dinner"]')).not.toContainText('Stew e2e');
});

test('[MEAL-06][US-705] the Meals screen: the week, today marked, each child’s lunch each day, read-only', async () => {
  await rail().getByRole('button', { name: 'Meals', exact: true }).click();
  const week = board.getByRole('table');
  await expect(week.getByRole('columnheader')).toHaveCount(7);
  await expect(week.locator('th[aria-current="date"]')).toContainText('Today');
  await expect(week.locator('tr[data-slot="dinner"] td[aria-current="date"]')).toContainText(
    'Fish pie e2e',
  );
  const rows = lunches();
  const days = [...new Set(rows.map(([d]) => d))];
  const cells = week.locator('tr[data-slot="school"] td');
  await expect(cells).toHaveCount(7);
  for (const [i, d] of days.entries()) {
    const want = expected(rows.filter(([x]) => x === d));
    expect(await lunchLines(cells.nth(i)), d).toEqual(want);
    if (!want.length) await expect(cells.nth(i).locator('.fw-mweek__empty')).toBeVisible();
  }
  await expect(week.getByRole('button')).toHaveCount(0);
  // Home again, for the board's next visitor.
  await rail().getByRole('button', { name: 'Home', exact: true }).click();
  await expect(meals()).toBeVisible();
});
