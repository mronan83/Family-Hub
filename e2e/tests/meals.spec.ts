import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';

// [MEAL-01][MEAL-02][MEAL-03][MEAL-04][MEAL-08] Meals on the preview (WP-25, D-77; lunch WP-26, D-78), as
// Alex of the demo family.
// The done-when: a full week is planned through the app (a meal added to the library, a dinner every
// day, two snacks put in order), then copied to the week after with skip (a dinner already planned
// there is kept) and with overwrite (it is replaced). Then school lunch: Maya's usual week set, one
// school day changed and changed back. The weeks used are two and three weeks ahead, clear of the
// seeded week, and are cleared again afterwards (Maya's usual lunch put back as seeded).
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MEAL = 'Lasagne e2e';
const sql = (q: string) => query(db!, q);

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** The first day (Sunday) of the household week `weeks` from this one, as YYYY-MM-DD. */
const weekStart = (weeks: number) =>
  sql(`select ((now() at time zone 'America/New_York')::date
               - extract(dow from (now() at time zone 'America/New_York')::date)::integer + ${7 * weeks})::text`);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/**
 * A week's plan as it reads: "2026-10-25 dinner Lasagne e2e; 2026-10-29 lunch Wraps (Leo, Maya); …",
 * by day, slot and order, each entry's people by name (MEAL-10).
 */
const plan = (from: string) =>
  sql(`select coalesce(string_agg(e.plan_date || ' ' || e.slot || ' ' || coalesce(m.name, e.free_text)
                                  || coalesce(' (' || (select string_agg(p.display_name, ', ' order by p.display_name)
                                                         from public.meal_plan_entry_member x
                                                         join public.member p on p.id = x.member_id
                                                        where x.entry_id = e.id) || ')', ''), '; '
                                  order by e.plan_date, e.slot, e.sort_order), '')
         from public.meal_plan_entry e
         left join public.meal m on m.id = e.meal_id
        where e.household_id = '${DEMO}' and e.plan_date between '${from}' and '${addDays(from, 6)}'`);
const maya = () =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`);
const clear = () =>
  sql(`delete from public.meal_plan_entry where household_id = '${DEMO}'
         and plan_date between '${weekStart(2)}' and '${addDays(weekStart(3), 6)}';
       delete from public.meal where household_id = '${DEMO}' and name = '${MEAL}';
       delete from public.lunch_override where household_id = '${DEMO}';
       update public.member_lunch set defaults = '{"fri": "buy"}'
        where household_id = '${DEMO}' and member_id = '${maya()}'`);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let first: string;
let second: string;

test.beforeAll(async ({ browser }) => {
  clear();
  first = weekStart(2);
  second = weekStart(3);
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
});

test.afterAll(() => {
  clear();
});

async function add(
  week: string,
  day: string,
  slot: string,
  what: { meal?: string; text?: string },
  /** [MEAL-10] The people ticked; none is Everyone. */
  who: string[] = [],
) {
  await admin.goto(`/admin/meals?week=${week}`);
  const form = admin.getByRole('form', { name: 'Add to the plan' });
  await form.getByRole('combobox', { name: 'Day' }).selectOption(day);
  await form.getByRole('combobox', { name: 'Meal' }).selectOption(slot);
  if (what.meal) {
    await form.getByRole('radio', { name: 'From the library' }).check();
    await form
      .getByRole('combobox', { name: 'From the library' })
      .selectOption({ label: what.meal });
  } else {
    await form.getByRole('radio', { name: 'Something else' }).check();
    await form.getByRole('textbox', { name: 'Something else' }).fill(what.text!);
  }
  const people = form.getByRole('group', { name: 'For' });
  for (const name of who) await people.getByRole('checkbox', { name, exact: true }).check();
  await expect(people.getByRole('checkbox', { name: 'Everyone', exact: true })).toBeChecked({
    checked: who.length === 0,
  });
  await form.getByRole('button', { name: 'Add to the plan' }).click();
  await expect(admin.getByRole('status')).toHaveText('Added to the plan.');
}

test('[MEAL-02] a parent adds a meal to the library', async () => {
  await admin.goto('/admin/meals/library');
  const form = admin.getByRole('form', { name: 'Add a meal' });
  await form.getByLabel('Name', { exact: true }).fill(MEAL);
  await form.getByRole('checkbox', { name: 'Dinner' }).check();
  await form.getByRole('button', { name: 'Add meal' }).click();
  await expect(admin.getByRole('status')).toHaveText(`Saved ${MEAL}.`);
  await expect(admin.getByRole('list', { name: 'Meals', exact: true })).toContainText(MEAL);
  expect(
    sql(
      `select array_to_string(meal_types, ',') from public.meal where household_id = '${DEMO}' and name = '${MEAL}'`,
    ),
  ).toBe('dinner');
});

test('[MEAL-01][MEAL-08][US-701] done-when: a full week planned, two snacks put in order', async () => {
  // Ten things added through the form, each a page load and a saved form (about 3 s each on a
  // preview): more than the default 30 s, which the first run with WP-62's lunch ran out of.
  test.setTimeout(90_000);
  await add(first, first, 'dinner', { meal: MEAL });
  for (let i = 1; i < 7; i++)
    await add(first, addDays(first, i), 'dinner', { text: `Dinner ${i}` });
  const wed = addDays(first, 3);
  await add(first, wed, 'snack', { text: 'Crackers' });
  await add(first, wed, 'snack', { text: 'Apple' }, ['Maya']);
  // [MEAL-10][US-708] A lunch for two of the four.
  const thu = addDays(first, 4);
  await add(first, thu, 'lunch', { text: 'Wraps' }, ['Maya', 'Leo']);
  // Maya's apple first.
  await admin.goto(`/admin/meals?week=${first}`);
  const snack = admin.locator(`[id="${wed}-snack"]`);
  await snack.getByText('Change', { exact: true }).nth(1).click();
  await snack.getByRole('button', { name: 'Move Apple earlier' }).click();
  await expect(admin.getByRole('status')).toHaveText('Moved.');
  await expect(admin.locator(`[id="${wed}-snack"]`).getByRole('listitem').first()).toContainText(
    'AppleMaya',
  );
  await expect(admin.locator(`[id="${thu}-lunch"]`).getByRole('listitem')).toContainText(
    'WrapsLeoMaya',
  );
  expect(plan(first)).toBe(
    [
      `${first} dinner ${MEAL}`,
      ...[1, 2].map((i) => `${addDays(first, i)} dinner Dinner ${i}`),
      `${wed} dinner Dinner 3`,
      `${wed} snack Apple (Maya)`,
      `${wed} snack Crackers`,
      `${thu} dinner Dinner 4`,
      `${thu} lunch Wraps (Leo, Maya)`,
      ...[5, 6].map((i) => `${addDays(first, i)} dinner Dinner ${i}`),
    ].join('; '),
  );
});

test('[MEAL-03][US-702] done-when: copied to the next week with skip, then with overwrite', async () => {
  // The week after already has Sunday's dinner.
  await add(second, second, 'dinner', { text: 'Pizza' });
  await admin.goto(`/admin/meals?week=${second}`);
  const copy = admin.getByRole('form', { name: 'Copy last week' });
  await copy.getByRole('radio', { name: 'Keep it' }).check();
  const started = Date.now();
  await copy.getByRole('button', { name: 'Copy last week here' }).click();
  await expect(admin.getByRole('status')).toHaveText(
    'Copied 9 things from last week. 1 meal was already planned and kept.',
  );
  report(`WP-25: a week copied (skip) and shown ${Date.now() - started} ms after the tap`);
  const after = plan(second);
  expect(after).toContain(`${second} dinner Pizza`);
  expect(after).not.toContain(`${second} dinner ${MEAL}`);
  expect(after).toContain(
    `${addDays(second, 3)} snack Apple (Maya); ${addDays(second, 3)} snack Crackers`,
  );
  // [MEAL-10] Each copy is for the same people.
  expect(after).toContain(`${addDays(second, 4)} lunch Wraps (Leo, Maya)`);
  expect(after.split('; ')).toHaveLength(10);

  await admin.goto(`/admin/meals?week=${second}`);
  await copy.getByRole('radio', { name: 'Replace it with last week’s' }).check();
  await copy.getByRole('button', { name: 'Copy last week here' }).click();
  await expect(admin.getByRole('status')).toHaveText(
    'Copied 10 things from last week. 9 meals were replaced.',
  );
  // Now the same as the week it came from, a week on, and each copy its own.
  expect(plan(second)).toBe(
    plan(first)
      .split('; ')
      .map((row) => `${addDays(row.slice(0, 10), 7)}${row.slice(10)}`)
      .join('; '),
  );
  await expect(admin.locator(`[id="${second}-dinner"]`)).toContainText(MEAL);
  await admin.locator(`[id="${second}-dinner"]`).getByText('Change', { exact: true }).click();
  await admin.getByRole('button', { name: new RegExp(`^Remove ${MEAL} from `) }).click();
  await expect(admin.getByRole('status')).toHaveText('Removed from the plan.');
  expect(plan(first)).toContain(`${first} dinner ${MEAL}`);
  expect(plan(second)).not.toContain(`${second} dinner ${MEAL}`);
});

test('[MEAL-04][US-703] school lunch: Maya’s usual week set, then one school day changed and changed back', async () => {
  // The first school day of the week two weeks on, as Maya's school year has it.
  const day =
    sql(`select d::date::text from generate_series('${first}'::date, '${first}'::date + 6, '1 day') d
                    where public.resolve_day_type('${maya()}', d::date) = 'school_day' order by d limit 1`);
  test.skip(!day, 'no school day that week in the demo family’s year');
  const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
    new Date(`${day}T12:00:00Z`).getUTCDay()
  ]!;
  const words: Record<string, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
  };
  await admin.goto(`/admin/meals?week=${first}`);
  const usual = admin.getByRole('form', { name: 'Maya’s usual lunches' });
  await usual.getByRole('combobox', { name: words[weekday] }).selectOption('buy');
  await usual.getByRole('button', { name: 'Save Maya’s usual lunches' }).click();
  await expect(admin.getByRole('status')).toHaveText('Usual lunches saved.');
  expect(sql(`select public.lunch_mode('${maya()}', '${day}')`)).toBe('buy');

  const lunch = admin.getByRole('region', { name: 'School lunch' });
  await lunch
    .getByRole('button', { name: new RegExp(`^Maya, .*: buy\\. Change to bring$`) })
    .first()
    .click();
  await expect(admin.getByRole('status')).toHaveText('Lunch changed.');
  expect(
    sql(`select public.lunch_mode('${maya()}', '${day}') || ':' || count(*) from public.lunch_override
               where member_id = '${maya()}'`),
  ).toBe('bring:1');
  await expect(lunch.getByRole('row', { name: /^Maya/ })).toContainText('Changed');
  await lunch
    .getByRole('button', { name: /^Maya, .*: bring \(changed\)\. Change to buy$/ })
    .click();
  // The status already says "Lunch changed." from the first tap, so wait for the row itself: once
  // the change is undone and the page is back, Maya's week has no changed day.
  await expect(lunch.getByRole('row', { name: /^Maya/ })).not.toContainText('Changed');
  expect(sql(`select count(*) from public.lunch_override where member_id = '${maya()}'`)).toBe('0');
});
