import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-27][MEAL-28] Groceries on Home and the preferred store on the preview (WP-112, D-142), as
// Alex of the spec's own made-up household (D-137). The done-when: an admin adds an item from Home
// and finds it on the list, the same thing again merges; then sets New items go to, adds something
// new and finds it at that store, removes that store and New items go to says Any store. Each item
// and store has a name of its own; what the spec added is taken off again.
const family = ownHousehold('home-groceries');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const sql = (q: string) => query(db!, q);
const SUFFIX = `e2e ${Math.random().toString(36).slice(2, 7)}`;
const names = {
  quince: `Quince ${SUFFIX}`,
  rutabaga: `Rutabaga ${SUFFIX}`,
  store: `Shop ${SUFFIX}`,
};
const esc = (s: string) => s.replace(/'/g, "''");

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** The open items of a name, with their amounts and store: "1 · 2 lb + 1 lb · Shop e2e x". */
const stored = (name: string) =>
  sql(`select count(*) || ' · ' || coalesce(string_agg(coalesce(r.amounts, ''), ','), '') || ' · ' ||
              coalesce(string_agg(coalesce(s.name, 'any'), ','), '')
         from public.grocery_item i
         left join public.grocery_store s on s.id = i.store_id
         left join lateral (select string_agg(amount, ' + ' order by created_at) amounts
                              from public.grocery_item_reason where item_id = i.id) r on true
        where i.household_id = '${HOUSEHOLD}' and i.name = '${esc(name)}' and i.status = 'open'`);
const preferred = () =>
  sql(`select coalesce(s.name, 'any') from public.grocery_list l
         left join public.grocery_store s on s.id = l.preferred_store_id
        where l.household_id = '${HOUSEHOLD}'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(admin, 'Alex');
});
test.afterAll(async () => {
  sql(
    `update public.grocery_list set preferred_store_id = null where household_id = '${HOUSEHOLD}'`,
  );
  sql(`update public.grocery_item set status = 'removed', removed_at = now(), ticked_at = null
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);
  sql(
    `delete from public.grocery_store where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`,
  );
  await admin?.close();
});

const card = () =>
  admin
    .getByRole('list', { name: 'More quick actions' })
    .getByRole('listitem')
    .filter({ hasText: 'Groceries' });

/** How many Home's card says are on the list. */
async function count(): Promise<number> {
  const words = await card().locator('.fw-quick__words').innerText();
  return words.startsWith('Nothing') ? 0 : Number(words.split(' ')[0]);
}

test('[MEAL-27-e] done-when: an admin adds from Home, finds it on the list, and the same again merges', async () => {
  test.setTimeout(90_000);
  await admin.goto('/admin');
  await expect(card()).toBeVisible();
  const before = await count();
  const field = card().getByRole('textbox', { name: 'Add an item' });

  await test.step('add something new from Home', async () => {
    await field.fill(`2 lb ${names.quince}`);
    // The starter list (D-140) puts a quince in Produce; no store is preferred yet.
    await expect(card().getByRole('status')).toHaveText('Produce · Any store');
    await card().getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card().getByRole('status')).toContainText(
      `Added ${names.quince} 2 lb to Produce.`,
    );
    await expect(field).toHaveValue('');
    await expect.poll(count).toBe(before + 1);
    await expect.poll(() => stored(names.quince)).toBe('1 · 2 lb · any');
  });

  await test.step('the same thing again merges into it', async () => {
    await field.fill(`1 lb ${names.quince.toLowerCase()}`);
    await expect(card().getByRole('status')).toHaveText(
      `${names.quince} 2 lb is on the list already. Adding makes 3 lb.`,
    );
    await field.press('Enter');
    await expect(card().getByRole('status')).toContainText(
      `Added ${names.quince} 3 lb to Produce.`,
    );
    await expect.poll(() => stored(names.quince)).toBe('1 · 2 lb + 1 lb · any');
    await expect.poll(count).toBe(before + 1);
  });

  await test.step('Change opens it on Groceries', async () => {
    await card().getByRole('link', { name: 'Change' }).click();
    await expect(admin.getByRole('heading', { name: 'Groceries', level: 1 })).toBeVisible();
    const row = admin.getByRole('listitem').filter({ hasText: names.quince });
    await expect(row.getByRole('link', { name: /Store…/ })).toBeVisible();
  });
  report(`home-groceries: added and merged ${names.quince} from Home in ${HOUSEHOLD}`);
});

test('[MEAL-28-f] done-when: New items go to a store, a new item goes there, and removing it says Any store', async () => {
  test.setTimeout(90_000);
  await admin.goto('/admin/groceries?open=places');
  const places = admin.locator('#places');

  await test.step('add a store of the spec’s own and choose it under New items go to', async () => {
    const form = places.getByRole('form', { name: 'New store' });
    await form.getByRole('textbox').fill(names.store);
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(admin.getByText('Store added.')).toBeVisible();
    await places.getByRole('combobox', { name: 'New items go to' }).selectOption({
      label: names.store,
    });
    await expect(admin.getByText('Saved. New items go there.')).toBeVisible();
    await expect.poll(preferred).toBe(names.store);
    const row = places.getByRole('listitem').filter({ hasText: names.store });
    await expect(row).toContainText('Preferred');
  });

  await test.step('something new goes to the preferred store', async () => {
    const add = admin.getByRole('form', { name: 'Add to the list' });
    await add.getByRole('textbox', { name: 'Add an item' }).fill(names.rutabaga);
    await expect(add.getByRole('radio', { name: names.store })).toBeChecked();
    await expect(add).toContainText(`${names.store} is your preferred store.`);
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(admin.getByText(`Added ${names.rutabaga}.`)).toBeVisible();
    await expect.poll(() => stored(names.rutabaga)).toBe(`1 ·  · ${names.store}`);
  });

  await test.step('removing that store sets New items go to back to Any store', async () => {
    await admin.goto('/admin/groceries?open=places');
    const row = places.getByRole('listitem').filter({ hasText: names.store });
    await row.getByLabel(`More for ${names.store}`).click();
    await row.getByRole('button', { name: `Remove ${names.store}` }).click();
    await expect(admin.getByText('Store removed. Its items can be got anywhere.')).toBeVisible();
    await expect.poll(preferred).toBe('any');
    const choose = places.getByRole('combobox', { name: 'New items go to' });
    await expect(choose).toHaveValue('');
    await expect(choose.locator('option:checked')).toHaveText('Any store');
  });
  report(`home-groceries: preferred store set, used and cleared in ${HOUSEHOLD}`);
});
