import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-19][MEAL-20] A week's meals into groceries on the preview (WP-105, D-138), as Alex of the
// spec's own made-up household (D-137). The done-when: an admin adds a planned week's ingredients and
// finds each once on Groceries, two meals' onions and ground beef merged into one item each. The week
// is three weeks ahead, clear of the seeded one; its two dinners are the seed's Tacos and Spaghetti,
// planned here and taken off again afterwards, which takes their share off the list too (MEAL-19-c).
const family = ownHousehold('meal-groceries');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TACOS = family.own('0de00000-0000-4000-8000-000000071001');
const SPAGHETTI = family.own('0de00000-0000-4000-8000-000000071002');
const sql = (q: string) => query(db!, q);

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/**
 * How many open items there are of a key, and the meals that are their reasons: "1: Spaghetti, Tacos",
 * or "1:" with none. sql() trims its answer, so the count and the reasons are joined by a colon, not a
 * space alone that the trim would take off when there are no reasons.
 */
const onList = (key: string) =>
  sql(`select count(distinct i.id) || ':' || coalesce(' ' || string_agg(distinct split_part(r.label, ',', 1), ', '), '')
         from public.grocery_item i
         left join public.grocery_item_reason r on r.item_id = i.id and r.meal_plan_entry_id in (${entries()})
        where i.household_id = '${HOUSEHOLD}' and i.name_key = '${key}' and i.status = 'open'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let week: string;
let tacosEntry: string;
let spaghettiEntry: string;
const entries = () => `'${tacosEntry}', '${spaghettiEntry}'`;

test.beforeAll(async ({ browser }) => {
  const today = householdToday(db!);
  week = addDays(weekStartOf(today, householdWeekStart(db!)), 21);
  tacosEntry = sql(`select gen_random_uuid()`);
  spaghettiEntry = sql(`select gen_random_uuid()`);
  sql(`insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, meal_id) values
         ('${tacosEntry}', '${HOUSEHOLD}', '${addDays(week, 2)}', 'dinner', 1, '${TACOS}'),
         ('${spaghettiEntry}', '${HOUSEHOLD}', '${addDays(week, 3)}', 'dinner', 1, '${SPAGHETTI}')`);
  admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(admin, 'Alex');
});
test.afterAll(async () => {
  // Taking the week's meals off the plan takes their share off the list (MEAL-19-c).
  if (tacosEntry)
    sql(
      `delete from public.meal_plan_entry where id in (${entries()}) and household_id = '${HOUSEHOLD}'`,
    );
  await admin?.close();
});

test('[MEAL-19-f][MEAL-20] done-when: a week’s ingredients added once each, two meals merged', async () => {
  test.setTimeout(120_000);
  await test.step('the review lists the two meals, nothing added yet', async () => {
    await admin.goto(`/admin/meals?week=${week}`);
    await admin.getByRole('link', { name: 'Add to groceries' }).click();
    const sheet = admin.getByRole('dialog', { name: 'Add this week to groceries' });
    await expect(sheet.locator('legend b')).toHaveText(['Tacos', 'Spaghetti']);
    // Spaghetti's onions merge with Tacos' (the household's list has Onions already, so Tacos' own
    // row says so too).
    const spaghetti = sheet.locator('fieldset', {
      has: admin.locator('legend', { hasText: 'Spaghetti' }),
    });
    await expect(spaghetti.locator('label').filter({ hasText: 'Onions' })).toContainText(
      'With Tacos',
    );
    expect(onList('onion')).toBe('1:');
  });
  await test.step('Add: each thing once on the list, both meals its reasons', async () => {
    const sheet = admin.getByRole('dialog', { name: 'Add this week to groceries' });
    const add = sheet.getByRole('button', { name: /^Add \d+ to groceries$/ });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(admin.getByText(/^Added \d+ to groceries\./)).toBeVisible();
    await expect.poll(() => onList('onion')).toBe('1: Spaghetti, Tacos');
    await expect.poll(() => onList('ground beef')).toBe('1: Spaghetti, Tacos');
    await expect.poll(() => onList('tortilla')).toBe('1: Tacos');
    // What the family usually has wasn't added.
    expect(onList('taco seasoning')).toBe('0:');
    await admin.goto('/admin/groceries');
    await expect(admin.getByRole('button', { name: 'Got Onions' })).toHaveCount(1);
    await expect(admin.getByRole('button', { name: 'Got Ground beef' })).toHaveCount(1);
  });
  report(`meal-groceries: week of ${week} added once each in ${HOUSEHOLD}`);
});
