import { expect, test, type Page } from '../support/test';
import { runMenuImport, type Fetcher } from '../../apps/web/lib/menu/import';
import { parseMenuCsv } from '../../apps/web/lib/menu/csv';
import { serviceRpc, sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf, weekday } from '../support/day';
import { withSchoolDays } from '../support/school';
import { signIn } from '../support/session';

// [MENU-01..05][MEAL-05] School menus on the preview (WP-27, D-79), as Alex of the demo family. The
// done-when: four weeks load from a file, and a feed that fails keeps its cached menus and shows a
// warning. Alex adds a menu from a file on School menus and loads four weeks of a made-up CSV (looked
// at first). A Nutrislice feed is added for a made-up district, and the menu_import job's own code
// (lib/menu/import.ts) runs here on the e2e runner against the shared database, as the job does
// (previews hold no job secret), with its fetch answering made-up weeks, then failing: the page says
// why, and the menus stay. Last, Maya's lunch comes from a file's menu (one of that test's own, in a
// school week of its own), and her buy day shows it on Meals. Each test makes its own menu, so none
// needs another. Production's jobs leave the demo family alone (D-62). No real school's menu or
// identifiers.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const FILE = 'Oak e2e';
const FEED = 'Cedar e2e';
const BIRCH = 'Birch e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

/** The demo family's day, read once (D-110). */
let today = '';
const day = (n: number) => addDays(today, n);
const maya = () =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`);
/** A day as the pages name it: "Mon, Oct 19". */
const dayName = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

/** `days` days of a made-up menu from `from`: two items each weekday, the date in the first. */
function menuCsv(name: string, from: string, days: number): string {
  const rows = ['date,item,section'];
  for (let n = 0; n < days; n++) {
    const d = addDays(from, n);
    if (weekday(d) === 0 || weekday(d) === 6) continue;
    rows.push(`${d},${name} lunch ${d},Main Line`, `${d},"Milk, 1%",Beverages`);
  }
  return `${rows.join('\n')}\n`;
}

/** A made-up Nutrislice week from a Sunday: Monday to Friday each "Cedar lunch <date>". */
function cedarWeek(sunday: string) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const date = new Date(Date.parse(`${sunday}T00:00:00Z`) + n * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      menu_items:
        n === 0 || n === 6
          ? []
          : [
              { is_section_title: true, text: 'Main Line', food: null },
              { is_section_title: false, text: '', food: { name: `Cedar lunch ${date}` } },
            ],
    };
  });
  return { start_date: sunday, days };
}
const answering =
  (status: number): Fetcher =>
  async (url) => {
    expect(url).toContain(
      'https://example-district.api.nutrislice.com/menu/api/weeks/school/cedar-e2e/menu-type/lunch/',
    );
    const sunday = /\/(\d{4})\/(\d{2})\/(\d{2})\/$/.exec(url)!.slice(1).join('-');
    return status === 200
      ? new Response(JSON.stringify(cedarWeek(sunday)))
      : new Response('Unavailable', { status });
  };
/**
 * The job's run for the demo family, `hours` ahead of the database's clock (which stamped the last
 * fetch), so the feed is due again.
 */
const runJob = (hours: number, fetcher: Fetcher) =>
  runMenuImport(serviceRpc(db!) as unknown as Parameters<typeof runMenuImport>[0], DEMO, {
    fetch: fetcher,
    now: new Date(
      Number(sql(`select (extract(epoch from now()) * 1000)::bigint`)) + hours * 3_600_000,
    ),
  });

function cleanUp() {
  // This spec's menus only. Days go with their menu; children who had it are unlinked (and Maya's
  // put back below).
  sql(`delete from public.menu_source where household_id = '${DEMO}'
         and name in ('${FILE}', '${FEED}', '${BIRCH}')`);
  sql(`update public.member_lunch set defaults = '{"fri": "buy"}',
              menu_source_id = (select id from public.menu_source
                                 where household_id = '${DEMO}' and name = 'Maple Elementary')
        where household_id = '${DEMO}' and member_id = '${maya()}'`);
}

async function asAlexOnMenus(page: Page) {
  await signIn(page);
  await page.goto('/admin/meals/menus');
  await expect(page.getByRole('heading', { name: 'School menus', level: 1 })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole('list', { name: 'School menus' }).locator('> li').filter({ hasText: name });

test.beforeAll(() => {
  cleanUp();
  today = householdToday(db!);
});
test.afterAll(() => cleanUp());

test('[MENU-01][MENU-03][US-802] done-when: four weeks load from a file, looked at first', async ({
  page,
}) => {
  await asAlexOnMenus(page);
  const add = page.getByRole('form', { name: 'Add a school menu' });
  await add.getByRole('textbox', { name: 'Name', exact: true }).fill(FILE);
  await add.getByRole('radio', { name: /A file/ }).check();
  await add.getByRole('button', { name: 'Add the menu' }).click();
  await expect(page.getByText(`Added ${FILE}.`)).toBeVisible();

  await row(page, FILE)
    .locator('summary', { hasText: `Load a file into ${FILE}` })
    .click();
  const load = page.getByRole('form', { name: `Load a file into ${FILE}` });
  await load.getByLabel('Menu file (CSV)').setInputFiles({
    name: 'oak-e2e.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(menuCsv('Oak', today, 28)),
  });
  await load.getByRole('button', { name: 'Look at the file' }).click();
  await expect(load.getByRole('region', { name: 'The file holds' })).toContainText('20 days');
  // Nothing is stored until the parent says so.
  expect(
    sql(`select count(*) from public.school_menu_day d join public.menu_source s on s.id = d.source_id
               where s.household_id = '${DEMO}' and s.name = '${FILE}'`),
  ).toBe('0');
  await load.getByRole('button', { name: 'Load 20 days' }).click();
  await expect(page.getByText('Loaded 20 days from the file.')).toBeVisible();
  expect(
    sql(`select count(*) || ' ' || bool_and(d.is_override and d.origin = 'csv')
           from public.school_menu_day d join public.menu_source s on s.id = d.source_id
          where s.household_id = '${DEMO}' and s.name = '${FILE}'`),
  ).toBe('20 true');
  const first = [0, 1, 2, 3].map(day).find((d) => weekday(d) > 0 && weekday(d) < 6)!;
  // [MENU-06] A line a section: Main Line's item, then Beverages' (WP-64).
  const firstDay = page
    .getByRole('list', { name: `Lunch at ${FILE}` })
    .getByRole('listitem')
    .filter({ hasText: `Oak lunch ${first}` });
  await expect(firstDay.locator('.fw-menu-text__row')).toHaveText([
    `Main Line: Oak lunch ${first}`,
    'Beverages: Milk, 1%',
  ]);
});

test('[MENU-02][MENU-04][MENU-05][US-803] done-when: a feed that fails keeps its menus and says why', async ({
  page,
}) => {
  // [D-110] Three job runs (five weekly fetches each, every one a few psql round trips), a sign-in,
  // two page loads and a saved day: about 60 s at worst on a preview, so three times that.
  test.setTimeout(180_000);
  sql(`insert into public.menu_source (household_id, name, adapter, config)
       values ('${DEMO}', '${FEED}', 'nutrislice',
               '{"district": "example-district", "school": "cedar-e2e", "menu_type": "lunch",
                 "school_name": "Cedar e2e", "menu_type_name": "Lunch"}')`);
  expect(await runJob(0, answering(200))).toEqual({ due: 1, fetched: 1, unchanged: 0, failed: 0 });
  const stored =
    sql(`select count(*) from public.school_menu_day d join public.menu_source s on s.id = d.source_id
                       where s.household_id = '${DEMO}' and s.name = '${FEED}'`);
  expect(Number(stored)).toBe(20);

  // A day later Nutrislice is down: the run records why, and the menus stay.
  expect(await runJob(24, answering(503))).toEqual({ due: 1, fetched: 0, unchanged: 0, failed: 1 });
  expect(
    sql(`select s.status || ' ' || count(d.*) from public.menu_source s
           left join public.school_menu_day d on d.source_id = s.id
          where s.household_id = '${DEMO}' and s.name = '${FEED}' group by s.status`),
  ).toBe(`error ${stored}`);

  await asAlexOnMenus(page);
  const cedar = row(page, FEED);
  await expect(cedar).toContainText('Can’t fetch');
  await expect(cedar).toContainText('Nutrislice answered 503. FamilyWise tries again tomorrow.');
  await expect(cedar).toContainText('the menus below are kept until it works again');
  const first = [0, 1, 2, 3].map(day).find((d) => weekday(d) > 0 && weekday(d) < 6)!;
  await expect(page.getByRole('list', { name: `Lunch at ${FEED}` })).toContainText(
    `Cedar lunch ${first}`,
  );

  // A day of the parent's own is kept through the next good fetch: a weekday two or more days on, so
  // the next run (two days on, its four weeks from that day) fetches that day again.
  const own = [2, 3, 4].map(day).find((d) => weekday(d) > 0 && weekday(d) < 6)!;
  const ownDay = page
    .getByRole('list', { name: `Lunch at ${FEED}` })
    .locator('li', { has: page.locator(`summary[aria-label="Change ${dayName(own)}"]`) });
  await expect(ownDay).toContainText(`Cedar lunch ${own}`);
  await ownDay.locator('summary').click();
  const change = ownDay.getByRole('form', { name: `Change ${dayName(own)}` });
  await change.getByLabel('What’s for lunch').fill('Field trip: bring a packed lunch');
  await change.getByRole('button', { name: 'Save the day' }).click();
  await expect(page.getByText('Saved the day.')).toBeVisible();
  expect(await runJob(48, answering(200))).toEqual({ due: 1, fetched: 1, unchanged: 0, failed: 0 });
  await page.reload();
  await expect(row(page, FEED)).toContainText('Fetched');
  await expect(ownDay).toContainText('Field trip: bring a packed lunch');
});

test('[MEAL-05][US-704] Maya’s buy day shows the menu her lunch comes from', async ({ page }) => {
  // [D-110] Next week, a school week of the test's own (summer and winter break have no school day in
  // the demo family's year), with a file's menu of its own for it.
  const next = weekStartOf(day(7), householdWeekStart(db!));
  const kid = maya();
  const undo = withSchoolDays(db!, [kid], next, addDays(next, 6));
  try {
    const source = sql(`insert into public.menu_source (household_id, name, adapter, status)
                        values ('${DEMO}', '${BIRCH}', 'csv', 'ok') returning id`);
    // The week's days as a loaded file stores them (the app's own parser, then save_menu_days' insert).
    const days = JSON.stringify(parseMenuCsv(menuCsv('Birch', next, 7)).days).replace(/'/g, "''");
    sql(`insert into public.school_menu_day (household_id, source_id, menu_date, items, origin, is_override)
         select '${DEMO}', '${source}', (d ->> 'date')::date, private.menu_items(d -> 'items'), 'csv', true
           from jsonb_array_elements('${days}'::jsonb) d`);
    // The first school day of next week, as Maya's school year has it.
    const school =
      sql(`select d::date::text from generate_series('${next}'::date, '${next}'::date + 6, '1 day') d
                         where public.resolve_day_type('${kid}', d::date) = 'school_day' order by d limit 1`);
    expect(school, `a school day for Maya in the week of ${next}`).not.toBe('');
    const words = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][weekday(school)]!;
    await asAlexOnMenus(page);
    await page.goto(`/admin/meals?week=${next}`);
    const usual = page.getByRole('form', { name: 'Maya’s usual lunches' });
    await usual.getByRole('combobox', { name: words }).selectOption('buy');
    await usual.getByRole('combobox', { name: 'School menu' }).selectOption({ label: BIRCH });
    await usual.getByRole('button', { name: 'Save Maya’s usual lunches' }).click();
    await expect(page.getByRole('status')).toHaveText('Usual lunches saved.');
    // [MEAL-13] Her Buy day on the list of days (WP-74), opened: the menu a section each, to pick from.
    await page
      .getByRole('group', { name: 'Whose lunches' })
      .getByRole('button', { name: /^Maya/ })
      .click();
    const theDay = page
      .getByRole('list', { name: 'Maya’s lunch week' })
      .locator(`.fw-lunchday[data-date="${school}"]`);
    await theDay.locator('summary').click();
    await expect(theDay.locator('fieldset')).toHaveText([
      new RegExp(`^Main Line · any\\s*Birch lunch ${school}$`),
      /^Beverages · any\s*Milk, 1%$/,
    ]);
  } finally {
    undo();
  }
});
