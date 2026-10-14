import { appendFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '../support/test';
import { runMenuImport, type Fetcher } from '../../apps/web/lib/menu/import';
import { retireBoard } from '../support/board';
import { serviceRpc, sql as query } from '../support/db';

// [MEAL-06][US-705] Meals on a board, on the preview (WP-28, D-80). The demo family has today's snacks
// (seeded); the spec plans today's breakfast, lunch and dinner. The done-when: the board's home screen
// shows the day's four meals and each child's lunch, buying or bringing, as lunch_mode() has it for
// today (none on a weekend or a day off). A dinner changed reaches the board through Realtime. The
// Meals screen shows the week, today marked, and each child's lunch each day as the database has it.
// The meals planned here are removed at the end. [MENU-06][US-804] Last, WP-64's done-when: a made-up
// Nutrislice feed, fetched by the menu_import job's own code, is Leo's menu; his school day shows its
// entree options on the home screen (a tap shows the whole menu), the Meals screen has its three
// sections, and the long line is gone. Leo's menu and lunches are put back at the end.
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

test('[MEAL-10][US-708] done-when: a dinner for Maya and Leo shows both faces, and is on Maya’s screen but not Sam’s', async () => {
  // Planned as add_meal_entry() plans it: the entry, then its people.
  sql(`with e as (
         insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, free_text)
         values (gen_random_uuid(), '${DEMO}', ${TODAY}, 'dinner', 10, 'Fish fingers e2e') returning id)
       insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
       select '${DEMO}', e.id, m.id from e, public.member m
        where m.household_id = '${DEMO}' and m.display_name in ('Maya', 'Leo')`);
  const fish = (scope: Locator) =>
    scope.getByRole('listitem', { name: 'Fish fingers e2e, for Leo and Maya', exact: true });
  await expect(fish(meals())).toBeVisible({ timeout: 15_000 });
  await expect(fish(meals()).locator('.fw-avatar')).toHaveCount(2);
  // The board's Meals screen: both faces on today's dinner.
  await rail().getByRole('button', { name: 'Meals', exact: true }).click();
  const today = board.getByRole('table').locator('tr[data-slot="dinner"] td[aria-current="date"]');
  await expect(fish(today).locator('.fw-avatar')).toHaveCount(2);
  // On Maya's own screen, not on Sam's.
  const card = board.getByRole('region', { name: 'Today’s meals', exact: true });
  await rail().getByRole('button', { name: /^Maya/ }).click();
  await expect(fish(card)).toBeVisible();
  await rail().getByRole('button', { name: /^Sam/ }).click();
  await expect(card.locator('[data-slot="dinner"]')).toContainText('Fish pie e2e');
  await expect(fish(card)).toHaveCount(0);
  report('MEAL-10 a dinner for Maya and Leo: both faces on the board, on Maya’s screen, not Sam’s');
  await rail().getByRole('button', { name: 'Home', exact: true }).click();
  await expect(meals()).toBeVisible();
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

/** A made-up Nutrislice week from a Sunday: each weekday's entrees, fruit and milk, by section. */
function sectionsWeek(sunday: string) {
  const title = (text: string) => ({ is_section_title: true, text, food: null });
  const food = (name: string) => ({ is_section_title: false, text: '', food: { name } });
  const word = (text: string) => ({ is_section_title: false, text, food: null });
  return {
    start_date: sunday,
    days: [0, 1, 2, 3, 4, 5, 6].map((n) => ({
      date: new Date(Date.parse(`${sunday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10),
      menu_items:
        n === 0 || n === 6
          ? []
          : [
              title('Choice of Entree'),
              food('Tacos e2e'),
              word('or'),
              food('Wrap e2e'),
              word('with'),
              food('Chips e2e'),
              title('Fruits & Vegetables offered'),
              food('Corn e2e'),
              food('Pear e2e'),
              title('Choice of Milk'),
              food('Milk e2e'),
              word('or'),
              food('Chocolate milk e2e'),
            ],
    })),
  };
}
const answering: Fetcher = async (url) => {
  const sunday = /\/(\d{4})\/(\d{2})\/(\d{2})\/$/.exec(url)!.slice(1).join('-');
  return new Response(JSON.stringify(sectionsWeek(sunday)));
};

test('[MENU-06][US-804] done-when: a feed’s day shows its entree options at home and three sections on Meals', async () => {
  const FEED = 'Sections e2e';
  const leo = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Leo'`,
  );
  const change = sql(
    `select coalesce(mode, '') from public.lunch_override where member_id = '${leo}' and lunch_date = ${TODAY}`,
  );
  const before = sql(
    `select coalesce(menu_source_id::text, '') from public.member_lunch where member_id = '${leo}'`,
  );
  sql(`delete from public.menu_source where household_id = '${DEMO}' and name = '${FEED}'`);
  sql(`insert into public.menu_source (household_id, name, adapter, config)
       values ('${DEMO}', '${FEED}', 'nutrislice',
               '{"district": "example-district", "school": "sections-e2e", "menu_type": "lunch"}')`);
  try {
    const run = await runMenuImport(
      serviceRpc(db!) as unknown as Parameters<typeof runMenuImport>[0],
      DEMO,
      { fetch: answering },
    );
    expect(run.failed).toBe(0);
    expect(run.fetched).toBeGreaterThanOrEqual(1);
    // Stored as options: the wrap's chips share its option, and "or" and "with" are no items.
    expect(
      sql(`select string_agg((i ->> 'name') || ':' || (i ->> 'option'), ' ' order by n)
             from public.school_menu_day d join public.menu_source s on s.id = d.source_id,
                  jsonb_array_elements(d.items) with ordinality x (i, n)
            where s.household_id = '${DEMO}' and s.name = '${FEED}'
              and i ->> 'section' = 'Choice of Entree'
            group by d.menu_date order by d.menu_date limit 1`),
    ).toBe('Tacos e2e:1 Wrap e2e:2 Chips e2e:2');
    sql(`insert into public.member_lunch (member_id, household_id, menu_source_id)
         values ('${leo}', '${DEMO}', (select id from public.menu_source where household_id = '${DEMO}' and name = '${FEED}'))
         on conflict (member_id) do update set menu_source_id = excluded.menu_source_id`);
    const school = sql(`select public.resolve_day_type('${leo}', ${TODAY}) = 'school_day'`) === 't';
    if (school) {
      sql(`insert into public.lunch_override (household_id, member_id, lunch_date, mode)
           values ('${DEMO}', '${leo}', ${TODAY}, 'buy')
           on conflict (member_id, lunch_date) do update set mode = 'buy'`);
      const line = meals().getByRole('button', { name: 'Show Leo’s whole lunch menu' });
      await expect(line).toHaveText('Tacos e2e or Wrap e2e with Chips e2e', { timeout: 15_000 });
      // The long line is gone: the fruit and milk aren't on it.
      await expect(meals().locator('[data-slot="lunch"]')).not.toContainText('Pear e2e');
      await line.click();
      const box = board.getByRole('dialog', { name: 'Leo buys lunch today' });
      await expect(box.locator('dt')).toHaveText(['Entree', 'Fruits & Vegetables', 'Milk']);
      await box.getByRole('button', { name: 'Close' }).click();
      report('MENU-06 Leo’s buy day on the home screen: Tacos e2e or Wrap e2e with Chips e2e');
    } else {
      report(
        'MENU-06 no school for Leo today: the home screen’s line is shown on the Meals screen only',
      );
    }
    await rail().getByRole('button', { name: 'Meals', exact: true }).click();
    const week = board.getByRole('table');
    await expect(week.locator('.fw-mweek__menu-head')).toHaveText(`School menu · ${FEED}`, {
      timeout: 15_000,
    });
    await expect(week.locator('tr[data-slot="menu"]:not(.fw-mweek__menu-head) th')).toHaveText([
      'Entree',
      'Fruits & Vegetables',
      'Milk',
    ]);
    await expect(
      week.locator('tr[data-slot="menu"] li', { hasText: 'Wrap e2e' }).first(),
    ).toContainText('with Chips e2e');
    report('MENU-06 the Meals screen: Entree, Fruits & Vegetables and Milk, a row each');
  } finally {
    sql(
      change
        ? `update public.lunch_override set mode = '${change}' where member_id = '${leo}' and lunch_date = ${TODAY}`
        : `delete from public.lunch_override where member_id = '${leo}' and lunch_date = ${TODAY}`,
    );
    sql(`update public.member_lunch set menu_source_id = ${before ? `'${before}'` : 'null'}
          where member_id = '${leo}'`);
    sql(`delete from public.menu_source where household_id = '${DEMO}' and name = '${FEED}'`);
    await rail().getByRole('button', { name: 'Home', exact: true }).click();
  }
});
