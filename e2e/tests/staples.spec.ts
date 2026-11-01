import { appendFileSync } from 'node:fs';
import { itemKey } from '../../apps/web/lib/grocery-merge';
import { expect, test, type Page } from '../support/test';
import { addDays, householdToday } from '../support/day';
import { sql as query } from '../support/db';
import { ownHousehold } from '../support/household';
import { signIn } from '../support/session';

// [MEAL-21] Staples on the preview (WP-106, D-138 (7), D-150), as Alex of the spec's own made-up
// household (D-137). Two made-up things with a steady history of ticks, each due today: Running low?
// offers both; Add puts one on the list as a staple, through the one way in; Not now hides the
// other until one more gap has passed. Dates come from the household's today; what the spec made is
// taken away again.
const family = ownHousehold('staples');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const sql = (q: string) => query(db!, q);
const SUFFIX = `e2e ${Math.random()
  .toString(36)
  .replace(/[^a-z]/g, '')
  .slice(0, 5)}q`;
const names = { ghee: `Ghee ${SUFFIX}`, oats: `Oats ${SUFFIX}` };
const q = (s: string) => s.replace(/'/g, "''");

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** Ticked items of a thing on these household days, each with its tick in the history. */
function bought(name: string, days: string[]) {
  for (const day of days) {
    sql(`with i as (
           insert into public.grocery_item (household_id, list_id, name, name_key, category_id, status, ticked_at)
           select l.household_id, l.id, '${q(name)}', '${q(itemKey(name))}', c.id, 'ticked',
                  ('${day} 10:00'::timestamp at time zone h.timezone)
             from public.grocery_list l
             join public.household h on h.id = l.household_id
             join public.grocery_category c on c.household_id = l.household_id and c.is_other
            where l.household_id = '${HOUSEHOLD}'
           returning id, household_id, ticked_at)
         insert into public.grocery_item_event (household_id, item_id, kind, at)
         select household_id, id, 'ticked', ticked_at from i`);
  }
}

/** How a thing stands now: its open item's reason, and the household's Not now for it. */
const reason = (name: string) =>
  sql(`select coalesce(string_agg(r.kind, ','), '') from public.grocery_item i
         join public.grocery_item_reason r on r.item_id = i.id
        where i.household_id = '${HOUSEHOLD}' and i.name = '${q(name)}' and i.status = 'open'`);
const notNow = (name: string) =>
  sql(`select coalesce(not_now_until::text, '') from public.grocery_staple
        where household_id = '${HOUSEHOLD}' and name_key = '${q(itemKey(name))}'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let today: string;
test.beforeAll(async ({ browser }) => {
  today = householdToday(db!, HOUSEHOLD);
  // Ghee every 9 days, last 10 days ago: due 3 days ago. Oats every week, last 7 days ago: due yesterday.
  bought(
    names.ghee,
    [37, 28, 19, 10].map((n) => addDays(today, -n)),
  );
  bought(
    names.oats,
    [28, 21, 14, 7].map((n) => addDays(today, -n)),
  );
  admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(admin, 'Alex');
});
test.afterAll(async () => {
  sql(
    `delete from public.grocery_staple where household_id = '${HOUSEHOLD}' and name_key like '%${SUFFIX}'`,
  );
  sql(`update public.grocery_item set status = 'removed', removed_at = now(), ticked_at = null
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);
  await admin?.close();
});

test('[MEAL-21-h][US-716] Running low? offers what is due; Add puts it on the list, Not now hides it', async () => {
  test.setTimeout(90_000);
  await admin.goto('/admin/groceries');
  const low = admin.locator('#low');
  await expect(low.getByRole('heading', { name: /Running low\?/ })).toBeVisible();
  const rows = low.getByRole('list', { name: 'Running low' });
  await expect(rows).toContainText(names.ghee);
  await expect(rows).toContainText(names.oats);
  await expect(rows.getByRole('listitem').filter({ hasText: names.ghee })).toContainText(
    'Usually every 9 days',
  );

  await test.step('Add puts it on the list as a staple', async () => {
    await rows.getByRole('button', { name: `Add ${names.ghee} to the list` }).click();
    await expect(
      admin.getByRole('button', { name: `Undo: take ${names.ghee} off the list` }),
    ).toBeVisible();
    await expect.poll(() => reason(names.ghee)).toBe('staple');
    await expect(admin.getByRole('button', { name: `Got ${names.ghee}` })).toBeVisible();
    await expect(
      admin.locator('#low').getByRole('button', { name: `Add ${names.ghee} to the list` }),
    ).toHaveCount(0);
  });

  await test.step('Not now hides the other until one more gap has passed', async () => {
    await admin
      .locator('#low')
      .getByRole('button', { name: `Not now: ${names.oats}` })
      .click();
    await expect(admin.getByText(`${names.oats} won’t be suggested until`)).toBeVisible();
    await expect.poll(() => notNow(names.oats)).toBe(addDays(today, 7));
    expect(reason(names.oats)).toBe('');
  });
  report(`staples: added ${names.ghee} and put off ${names.oats} in ${HOUSEHOLD}`);
});
