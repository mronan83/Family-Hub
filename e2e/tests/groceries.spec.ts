import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-18][MEAL-23] Groceries on the preview (WP-104, D-138), as Alex of the spec's own made-up
// household (D-137). The done-when: an admin adds an item, ticks it, finds it under Got recently and
// unticks it back onto the list; then selects several items and moves them to another category at
// once. Each item has a name of its own; what the spec added is taken off the list again.
const family = ownHousehold('groceries');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const sql = (q: string) => query(db!, q);
const SUFFIX = `e2e ${Math.random().toString(36).slice(2, 7)}`;
const names = { quince: `Quince ${SUFFIX}`, kale: `Kale ${SUFFIX}`, leek: `Leek ${SUFFIX}` };

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** An item's status and category as the database has it: "open Produce". */
const stored = (name: string) =>
  sql(`select i.status || ' ' || c.name from public.grocery_item i
         join public.grocery_category c on c.id = i.category_id
        where i.household_id = '${HOUSEHOLD}' and i.name = '${name.replace(/'/g, "''")}'
        order by i.created_at desc limit 1`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(admin, 'Alex');
});
test.afterAll(async () => {
  sql(`update public.grocery_item set status = 'removed', removed_at = now(), ticked_at = null
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);
  await admin?.close();
});

async function openGroceries() {
  await admin.goto('/admin/groceries');
  await expect(admin.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
}

async function add(text: string, name: string, category?: string) {
  const form = admin.getByRole('form', { name: 'Add to the list' });
  await form.getByRole('textbox', { name: 'Add an item' }).fill(text);
  if (category) {
    const goesIn = form.getByRole('group', { name: 'Goes in' });
    await expect(goesIn).toBeVisible();
    const chip = goesIn.getByText(category, { exact: true });
    if (!(await chip.isVisible())) await goesIn.getByText('Other…').click();
    await chip.click();
  }
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(admin.getByText(`Added ${name}.`)).toBeVisible();
}

test('[MEAL-18-f][MEAL-23-e] done-when: add, tick, untick; then move several at once', async () => {
  test.setTimeout(120_000);
  await openGroceries();

  await test.step('[MEAL-18-f] add an item, tick it, untick it from Got recently', async () => {
    await add(`2 lb ${names.quince}`, names.quince);
    const row = admin.getByRole('listitem').filter({ hasText: names.quince });
    await expect(row).toContainText('2 lb');
    await expect.poll(() => stored(names.quince)).toBe('open Other');
    await row.getByRole('button', { name: `Got ${names.quince}` }).click();
    await expect(admin.getByText('Got it. It’s under Got recently for a week.')).toBeVisible();
    await expect(admin.getByRole('button', { name: `Got ${names.quince}` })).toHaveCount(0);
    await expect.poll(() => stored(names.quince)).toBe('ticked Other');
    const got = admin.locator('#got');
    await got.locator('summary').click();
    await got.getByRole('button', { name: `Untick ${names.quince}` }).click();
    await expect(admin.getByText('Back on the list.')).toBeVisible();
    await expect(admin.getByRole('button', { name: `Got ${names.quince}` })).toBeVisible();
    await expect.poll(() => stored(names.quince)).toBe('open Other');
  });

  await test.step('[MEAL-23-e] select several and move them to another category at once', async () => {
    await add(names.kale, names.kale, 'Snacks');
    await add(names.leek, names.leek, 'Snacks');
    await expect.poll(() => stored(names.leek)).toBe('open Snacks');
    await admin
      .getByRole('region', { name: 'On the list' })
      .getByRole('link', { name: 'Select' })
      .click();
    await expect(admin.getByRole('region', { name: 'Selected' })).toBeVisible();
    for (const n of [names.quince, names.kale, names.leek])
      await admin.getByRole('checkbox', { name: `Select ${n}` }).check();
    const bar = admin.getByRole('region', { name: 'Selected' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Move to…' }).click();
    const move = admin.getByRole('form', { name: 'Move 3 items to' });
    await move.getByText('Produce', { exact: true }).click();
    await move.getByRole('button', { name: 'Move 3 items' }).click();
    await expect(admin.getByText('Done: 3 items moved.')).toBeVisible();
    for (const n of Object.values(names)) await expect.poll(() => stored(n)).toBe('open Produce');
    const produce = admin.getByRole('region', { name: 'Produce', exact: true });
    for (const n of Object.values(names)) await expect(produce).toContainText(n);
  });
  report(`groceries: added, ticked, unticked and moved 3 items in ${HOUSEHOLD}`);
});
