import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { comingWeek } from '../../apps/web/lib/lunch-picks';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [MEAL-09][MEAL-11][US-707][D-95] Next week's lunches picked on the board, on the preview (WP-49).
// The done-when: a weekly item opens Maya's coming week on a paired board; a day changed there shows
// as changed on Meals in the admin app within 3 seconds (as a change waiting for a parent, D-95);
// Done checks the item off for her; on a buy day she picks an entree, two fruits and a milk, and once
// a parent approves it on Today, the board's home screen shows her entree that day in place of the
// options (when today is a school day for her). Made-up menu: "Lunches e2e", a manual menu by
// section on every day of the next three weeks. The day picked is today when it is a school day (the
// cut-off is moved to 11:59 pm for the spec, so today is open), else the next school day. Maya's
// menu, the cut-off and the day are put back at the end; the item, menu and board are removed.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Lunches e2e';
const ITEM = 'Pick next week’s lunches e2e';
const MENU = 'Lunches e2e';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let board: Page;
let admin: Page;
let maya = '';
let day = '';
let before: { menu: string; cutoff: string; change: string } = { menu: '', cutoff: '', change: '' };

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

const TODAY = `(now() at time zone 'America/New_York')::date`;
const items = JSON.stringify([
  { name: 'Tacos e2e', section: 'Choice of Entree', option: 1 },
  { name: 'Wrap e2e', section: 'Choice of Entree', option: 2 },
  { name: 'Chips e2e', section: 'Choice of Entree', option: 2 },
  { name: 'Corn e2e', section: 'Fruits & Vegetables offered', option: 1 },
  { name: 'Pear e2e', section: 'Fruits & Vegetables offered', option: 2 },
  { name: 'Apple e2e', section: 'Fruits & Vegetables offered', option: 3 },
  { name: 'Milk e2e', section: 'Choice of Milk', option: 1 },
  { name: 'Chocolate milk e2e', section: 'Choice of Milk', option: 2 },
]);

const cleanUp = () =>
  sql(`delete from public.lunch_request where member_id = '${maya}' and lunch_date >= ${TODAY} - 1;
       delete from public.lunch_choice where member_id = '${maya}' and lunch_date >= ${TODAY} - 1;
       delete from public.chore where household_id = '${DEMO}' and title = '${ITEM.replace(/'/g, "''")}';
       update public.member_lunch set menu_source_id = ${before.menu ? `'${before.menu}'` : 'null'}
        where member_id = '${maya}';
       delete from public.menu_source where household_id = '${DEMO}' and name = '${MENU}';`);

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(120_000);
  maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  before = {
    menu: sql(
      `select coalesce(menu_source_id::text, '') from public.member_lunch where member_id = '${maya}'`,
    ),
    cutoff: sql(
      `select to_char(lunch_cutoff, 'HH24:MI') from public.household_settings where household_id = '${DEMO}'`,
    ),
    change: '',
  };
  // The day: today when it is a school day for Maya, else her next one.
  day = sql(`select min(d)::date from generate_series(${TODAY}, ${TODAY} + 14, interval '1 day') d
              where public.resolve_day_type('${maya}', d::date) = 'school_day'`);
  before.change = sql(
    `select coalesce(mode, '') from public.lunch_override where member_id = '${maya}' and lunch_date = '${day}'`,
  );
  cleanUp();
  sql(`update public.household_settings set lunch_cutoff = '23:59' where household_id = '${DEMO}'`);
  sql(`insert into public.menu_source (household_id, name, adapter, config)
       values ('${DEMO}', '${MENU}', 'manual', '{}')`);
  sql(`insert into public.school_menu_day (household_id, source_id, menu_date, meal_service, items, origin,
                                           is_override)
       select '${DEMO}', s.id, d::date, 'lunch', '${items}'::jsonb, 'manual', true
         from public.menu_source s, generate_series(${TODAY}, ${TODAY} + 21, interval '1 day') d
        where s.household_id = '${DEMO}' and s.name = '${MENU}'`);
  sql(`insert into public.member_lunch (member_id, household_id, menu_source_id)
       values ('${maya}', '${DEMO}', (select id from public.menu_source where household_id = '${DEMO}' and name = '${MENU}'))
       on conflict (member_id) do update set menu_source_id = excluded.menu_source_id`);
  // Bring that day, so she changes it to Buy.
  sql(`select set_config('request.jwt.claims', '{}', false);
       delete from public.lunch_override where member_id = '${maya}' and lunch_date = '${day}';
       insert into public.lunch_override (household_id, member_id, lunch_date, mode)
       select '${DEMO}', '${maya}', '${day}', 'bring' where private.usual_lunch('${maya}', '${day}') = 'buy'`);
  // [MEAL-09] The weekly item that opens Lunches, due today for Maya, set on the item in Chores.
  sql(`with c as (
         insert into public.chore (household_id, title, icon, kind, points, schedule, day_types, start_date,
                                   assignment, opens)
         values ('${DEMO}', '${ITEM.replace(/'/g, "''")}', 'lunch', 'task', 0,
                 jsonb_build_object('freq', 'once', 'on_date', ${TODAY}),
                 array['school_day', 'no_school', 'break', 'weekend', 'summer'], ${TODAY}, 'each', 'lunches')
         returning id)
       insert into public.chore_assignee (household_id, chore_id, member_id)
       select '${DEMO}', c.id, '${maya}' from c`);
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);

  admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  if (!db) return;
  cleanUp();
  sql(`update public.household_settings set lunch_cutoff = '${before.cutoff || '08:00'}'
        where household_id = '${DEMO}'`);
  sql(
    before.change
      ? `insert into public.lunch_override (household_id, member_id, lunch_date, mode)
         values ('${DEMO}', '${maya}', '${day}', '${before.change}')
         on conflict (member_id, lunch_date) do update set mode = excluded.mode`
      : `delete from public.lunch_override where member_id = '${maya}' and lunch_date = '${day}'`,
  );
  await admin?.close();
  await retireBoard(board, BOARD);
});

const theDay = () => board.locator(`.fw-lunches__day[data-date="${day}"]`);

test('[MEAL-09][MEAL-11][US-707] done-when: the item opens Maya’s week; she picks a buy day; Meals shows it within 3 s', async () => {
  // The item is on the home screen's list; a tap opens her coming week instead of checking it off.
  const open = board.getByRole('button', { name: new RegExp(`^Open ${ITEM}`) }).first();
  await expect(open).toBeVisible({ timeout: 15_000 });
  await open.click();
  await expect(board.getByRole('heading', { name: /^Maya’s lunches/, level: 2 })).toBeVisible();
  const today = sql(`select ${TODAY}`);
  if (!comingWeek(today).includes(day))
    await board.getByRole('button', { name: 'Next week' }).click();
  await expect(theDay()).toBeVisible({ timeout: 15_000 });
  await expect(theDay().getByRole('button', { name: /Bring$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Admin Meals for the day's week, ready before she taps.
  await admin.goto(`/admin/meals?week=${day}`);
  // Buy, then her picks: an entree, two fruits, a milk.
  await theDay().getByRole('button', { name: /Buy$/ }).click();
  const dialog = board.getByRole('dialog', { name: /^Maya’s lunch on / });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Wrap e2e with Chips e2e', exact: true }).click();
  await dialog.getByRole('button', { name: 'Corn e2e', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apple e2e', exact: true }).click();
  await dialog.getByRole('button', { name: 'Milk e2e', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(theDay()).toContainText('Waiting for a parent', { timeout: 15_000 });
  await expect(theDay()).toContainText('Wrap e2e · Corn e2e, Apple e2e · Milk e2e');
  // The database has it: from here, Meals in the admin app shows it within 3 seconds.
  const saved = Date.now();
  expect(
    sql(`select mode || ' ' || jsonb_array_length(choices) || ' ' || status from public.lunch_request
          where member_id = '${maya}' and lunch_date = '${day}'`),
  ).toBe('buy 3 waiting');
  const waiting = admin
    .getByRole('region', { name: 'School lunch' })
    .getByRole('row', { name: /^Maya/ })
    .getByRole('link', { name: 'Buy? waiting' });
  await expect
    .poll(
      async () => {
        await admin.reload();
        return waiting.count();
      },
      { timeout: 3_000, intervals: [0] },
    )
    .toBe(1);
  report(
    `MEAL-09 a change on the board showed on Meals in the admin app in ${Date.now() - saved} ms`,
  );
});

test('[MEAL-09][MEAL-11][US-707] a parent approves it on Today: the day is Buy with her picks', async () => {
  await admin.goto('/admin/today');
  const group = admin.getByRole('region', { name: 'Maya’s lunch changes' });
  await expect(group).toContainText('Picked: Wrap e2e · Corn e2e, Apple e2e · Milk e2e');
  await group
    .getByRole('button', { name: /^Approve Maya’s/ })
    .first()
    .click();
  await expect(admin.getByText('Approved 1 lunch change.')).toBeVisible();
  expect(sql(`select public.lunch_mode('${maya}', '${day}')`)).toBe('buy');
  expect(
    sql(`select string_agg(array_to_string(names, ','), ' | ' order by section) from public.lunch_choice
          where member_id = '${maya}' and lunch_date = '${day}'`),
  ).toBe('Wrap e2e | Milk e2e | Corn e2e,Apple e2e');
  // The board hears it: the line goes, the picks stay.
  await expect(theDay()).not.toContainText('Waiting for a parent', { timeout: 15_000 });
  await expect(theDay()).toContainText('Wrap e2e · Corn e2e, Apple e2e · Milk e2e');
  report('MEAL-11 approved on Today: an entree, two fruits and a milk, by section');
});

test('[MEAL-09][US-707] Done checks the item off for Maya', async () => {
  await board.getByRole('button', { name: 'Done' }).click();
  await expect(board.getByRole('heading', { name: /’s lunches/ })).toHaveCount(0);
  await expect
    .poll(
      () =>
        sql(`select o.status from public.chore_occurrence o join public.chore c on c.id = o.chore_id
              where c.household_id = '${DEMO}' and c.title = '${ITEM.replace(/'/g, "''")}'
                and o.member_id = '${maya}'`),
      { timeout: 15_000 },
    )
    .toMatch(/^(completed|approved|pending_approval)$/);
  report('US-707 Done checked the item off for Maya');
});

test('[MEAL-11][US-707] done-when: the home screen shows her entree that day in place of the options', async () => {
  const today = sql(`select ${TODAY}`);
  const rail = board.getByRole('list', { name: 'Family', exact: true });
  await rail.getByRole('button', { name: 'Home', exact: true }).click();
  if (day === today) {
    const line = board
      .getByRole('region', { name: 'Today’s meals', exact: true })
      .getByRole('button', { name: 'Show Maya’s whole lunch menu' });
    await expect(line).toHaveText('Wrap e2e with Chips e2e', { timeout: 15_000 });
    report('MEAL-11 the home screen shows Maya’s entree: Wrap e2e with Chips e2e');
  } else {
    // Not a school day today: her own screen's Lunches card still opens her week, with the picks.
    await rail.getByRole('button', { name: /^Maya/ }).click();
    await board.getByRole('button', { name: 'Pick lunches' }).click();
    if (!comingWeek(today).includes(day))
      await board.getByRole('button', { name: 'Next week' }).click();
    await expect(theDay()).toContainText('Wrap e2e · Corn e2e, Apple e2e · Milk e2e');
    await board.getByRole('button', { name: 'Done' }).click();
    report(
      `MEAL-11 no school today: Maya's picks for ${day} shown on her week, not the home screen`,
    );
  }
});
