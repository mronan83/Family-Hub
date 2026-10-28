import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-29] Grocery brands on the preview (WP-116, D-148), as Alex of the spec's own made-up household
// (D-137). The done-when: an admin adds an item with a brand not yet saved from Groceries, finds it
// among Brands; ticks it, adds it again and finds the brand filled in; then merges a near-duplicate
// into it and the item moves. Each item and brand has a name of its own; what the spec added is
// taken off again.
const family = ownHousehold('grocery-brands');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const sql = (q: string) => query(db!, q);
const SUFFIX = `e2e ${Math.random().toString(36).slice(2, 7)}`;
const names = {
  item: `Seltzer ${SUFFIX}`,
  brand: `Fizzco ${SUFFIX}`,
  twin: `Fizzco Signature ${SUFFIX}`,
  other: `Tonic ${SUFFIX}`,
};
const esc = (s: string) => s.replace(/'/g, "''");

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** The brand of an item's latest row, or "none". */
const brandOf = (name: string) =>
  sql(`select coalesce(b.name, 'none') from public.grocery_item i
         left join public.grocery_brand b on b.id = i.brand_id
        where i.household_id = '${HOUSEHOLD}' and i.name = '${esc(name)}'
        order by i.created_at desc limit 1`);
const brands = () =>
  sql(`select coalesce(string_agg(name, ',' order by name), '') from public.grocery_brand
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(admin, 'Alex');
});
test.afterAll(async () => {
  sql(`update public.grocery_item set status = 'removed', removed_at = now(), ticked_at = null,
              brand_id = null
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);
  sql(
    `delete from public.grocery_brand where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`,
  );
  await admin?.close();
});

const add = () => admin.getByRole('form', { name: 'Add to the list' });
const brand = () => add().getByRole('combobox', { name: 'Brand' });

test('[MEAL-29-l] done-when: a new brand is saved with its item, filled in next time, and a merge moves it', async () => {
  test.setTimeout(120_000);
  await admin.goto('/admin/groceries');

  await test.step('add an item with a brand not yet saved', async () => {
    await add().getByRole('textbox', { name: 'Add an item' }).fill(names.item);
    await brand().fill(names.brand);
    await expect(add().getByRole('option', { name: `Add “${names.brand}”` })).toBeVisible();
    await add()
      .getByRole('option', { name: `Add “${names.brand}”` })
      .click();
    await expect(add()).toContainText(`${names.brand} is new. Adding saves it to your brands.`);
    await add().getByRole('button', { name: 'Add', exact: true }).click();
    await expect(admin.getByText(`Added ${names.item}.`)).toBeVisible();
    await expect.poll(() => brandOf(names.item)).toBe(names.brand);
  });

  await test.step('it is among Brands', async () => {
    await admin.goto('/admin/groceries?open=places#brands');
    await expect(admin.getByRole('list', { name: 'Brands', exact: true })).toContainText(
      names.brand,
    );
  });

  await test.step('ticked, then added again: the brand is filled in', async () => {
    await admin.goto('/admin/groceries');
    await admin.getByRole('button', { name: `Got ${names.item}` }).click();
    await expect(admin.getByText('Got it.', { exact: false })).toBeVisible();
    await add().getByRole('textbox', { name: 'Add an item' }).fill(names.item.toLowerCase());
    await expect(brand()).toHaveValue(names.brand);
    await expect(add()).toContainText('its brand last time');
    await add().getByRole('button', { name: 'Add', exact: true }).click();
    await expect(admin.getByText(`Added ${names.item}.`)).toBeVisible();
    await expect.poll(() => brandOf(names.item)).toBe(names.brand);
  });

  await test.step('a near-duplicate merged into it moves its item', async () => {
    await add().getByRole('textbox', { name: 'Add an item' }).fill(names.other);
    await brand().fill(names.twin);
    await add().getByRole('button', { name: 'Add', exact: true }).click();
    await expect(admin.getByText(`Added ${names.other}.`)).toBeVisible();
    await expect.poll(() => brandOf(names.other)).toBe(names.twin);
    await admin.goto('/admin/groceries?open=places#brands');
    const row = admin
      .getByRole('list', { name: 'Brands', exact: true })
      .getByRole('listitem')
      .filter({ hasText: names.twin });
    await row.getByLabel(`More for ${names.twin}`).click();
    await row.getByRole('link', { name: 'Merge into…' }).click();
    const form = admin.getByRole('form', { name: `Merge ${names.twin} into` });
    await expect(form.getByRole('radio', { name: names.brand, exact: true })).toBeChecked();
    await form.getByRole('button', { name: 'Merge' }).click();
    await expect(admin.getByText(`Merged. Those items are ${names.brand} now`)).toBeVisible();
    await expect.poll(() => brandOf(names.other)).toBe(names.brand);
    await expect.poll(brands).toBe(names.brand);
  });
  report(`grocery-brands: saved, filled in and merged a brand in ${HOUSEHOLD}`);
});
