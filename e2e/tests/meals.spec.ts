import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf, weekday } from '../support/day';
import { foldOf, mealDay, unfold } from '../support/fold';
import { withSchoolDays } from '../support/school';
import { signIn } from '../support/session';

// [MEAL-01][MEAL-02][MEAL-03][MEAL-04][MEAL-08] Meals on the preview (WP-25, D-77; lunch WP-26, D-78), as
// Alex of the demo family.
// The done-when: a full week is planned through the app (a meal added to the library, a dinner every
// day, two snacks put in order), then copied to the week after with skip (a dinner already planned
// there is kept) and with overwrite (it is replaced). Then school lunch: Maya's usual week set, one
// school day changed and changed back, in a week that is a school week of the test's own. The weeks
// used are two and three weeks ahead, clear of the seeded week, taken once from the household's day,
// and are cleared again afterwards (Maya's usual lunch put back as seeded).
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MEAL = 'Lasagne e2e';
const sql = (q: string) => query(db!, q);

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

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
/** What this spec changes, put back: the two weeks' plans, its meal, Maya's lunch in those weeks. */
const clear = () =>
  sql(`delete from public.meal_plan_entry where household_id = '${DEMO}'
         and plan_date between '${first}' and '${addDays(second, 6)}';
       delete from public.meal where household_id = '${DEMO}' and name = '${MEAL}';
       delete from public.lunch_override where household_id = '${DEMO}' and member_id = '${maya}'
         and lunch_date between '${first}' and '${addDays(second, 6)}';
       update public.member_lunch set defaults = '{"fri": "buy"}'
        where household_id = '${DEMO}' and member_id = '${maya}'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let maya: string;
/** The household weeks two and three weeks from this one, read once (D-110). */
let first: string;
let second: string;

test.beforeAll(async ({ browser }) => {
  maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  first = weekStartOf(addDays(householdToday(db!), 14), householdWeekStart(db!));
  second = addDays(first, 7);
  clear();
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  if (first) clear();
  await admin?.close();
});

async function add(
  week: string,
  day: string,
  slot: string,
  what: { meal?: string; text?: string },
  /** [MEAL-10] The people ticked; none is Everyone. */
  who: string[] = [],
) {
  // A named step, so a timeout says which add it was in (D-92).
  await test.step(`add ${what.meal ?? what.text} to ${day} ${slot}`, async () => {
    // The week's page is loaded only when it is not the one showing: after an add it stays on it.
    if (!admin.url().includes(`/admin/meals?week=${week}`))
      await admin.goto(`/admin/meals?week=${week}`);
    // [MEAL-14] Add to the plan is folded at first (WP-75); it stays open after an add.
    await unfold(admin.getByRole('region', { name: 'Add to the plan' }).locator('details'));
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
    // The form carries its entry's id; once added, the week comes back with a new, empty form (a
    // new id). That is the sign this add is saved and the next can start: the status alone reads
    // "Added to the plan." from the add before.
    const id = form.locator('input[name="id"]');
    const sent = await id.inputValue();
    await form.getByRole('button', { name: 'Add to the plan' }).click();
    await expect(id, `the form after adding (it was entry ${sent})`).not.toHaveValue(sent);
    await expect(admin.getByRole('status')).toHaveText('Added to the plan.');
  });
}

test('[MEAL-02][MEAL-01][MEAL-08][US-701][MEAL-03][US-702] done-when: a meal added to the library, a full week planned, then copied with skip and with overwrite', async () => {
  // [D-92][D-110] One story in three steps: a meal saved, eleven things added through the form (one
  // page load, then a saved form each: 3 to 4 s on a preview, up to 8 s on a slow one), two copies,
  // a move, a remove, five page loads and a few SQL reads. About 120 s at worst, so three times that.
  test.setTimeout(360_000);
  await test.step('[MEAL-02] a parent adds a meal to the library', async () => {
    await admin.goto('/admin/meals/library');
    // [NFR-18] Add a meal folds to its button while the library has meals (WP-93).
    await unfold(foldOf(admin, 'Add a meal'));
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

  await test.step('[MEAL-01][MEAL-08][US-701] done-when: a full week planned, two snacks put in order', async () => {
    const started = Date.now();
    await add(first, first, 'dinner', { meal: MEAL });
    for (let i = 1; i < 7; i++)
      await add(first, addDays(first, i), 'dinner', { text: `Dinner ${i}` });
    const wed = addDays(first, 3);
    await add(first, wed, 'snack', { text: 'Crackers' });
    await add(first, wed, 'snack', { text: 'Apple' }, ['Maya']);
    // [MEAL-10][US-708] A lunch for two of the four.
    const thu = addDays(first, 4);
    await add(first, thu, 'lunch', { text: 'Wraps' }, ['Maya', 'Leo']);
    report(`WP-62: ten things planned through the form in ${Date.now() - started} ms`);
    // Maya's apple first.
    await admin.goto(`/admin/meals?week=${first}`);
    // [MEAL-14] Each day is folded at first (WP-75); the moved entry's day comes back open.
    await unfold(mealDay(admin, wed));
    const snack = admin.locator(`[id="${wed}-snack"]`);
    await snack.getByText('Change', { exact: true }).nth(1).click();
    await snack.getByRole('button', { name: 'Move Apple earlier' }).click();
    await expect(admin.getByRole('status')).toHaveText('Moved.');
    await expect(admin.locator(`[id="${wed}-snack"]`).getByRole('listitem').first()).toContainText(
      'AppleMaya',
    );
    await unfold(mealDay(admin, thu));
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

  await test.step('[MEAL-03][US-702] done-when: copied to the next week with skip, then with overwrite', async () => {
    // The week after already has its first day's dinner.
    await add(second, second, 'dinner', { text: 'Pizza' });
    await admin.goto(`/admin/meals?week=${second}`);
    // [MEAL-14] Copy last week is folded at first (WP-75).
    const copyFold = admin.getByRole('region', { name: 'Copy last week' }).locator('details');
    await unfold(copyFold);
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
    await unfold(copyFold);
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
    await unfold(mealDay(admin, second));
    await expect(admin.locator(`[id="${second}-dinner"]`)).toContainText(MEAL);
    await admin.locator(`[id="${second}-dinner"]`).getByText('Change', { exact: true }).click();
    await admin.getByRole('button', { name: new RegExp(`^Remove ${MEAL} from `) }).click();
    await expect(admin.getByRole('status')).toHaveText('Removed from the plan.');
    expect(plan(first)).toContain(`${first} dinner ${MEAL}`);
    expect(plan(second)).not.toContain(`${second} dinner ${MEAL}`);
  });
});

test('[MEAL-04][US-703] school lunch: Maya’s usual week set, then one school day changed and changed back', async () => {
  // [D-110] The week two weeks on is a school week of the test's own, so this runs in every week of
  // the year (summer and winter break have no school day in the demo family's year).
  const undo = withSchoolDays(db!, [maya], first, addDays(first, 6));
  try {
    // The first school day of that week, as Maya's school year has it.
    const day =
      sql(`select d::date::text from generate_series('${first}'::date, '${first}'::date + 6, '1 day') d
                      where public.resolve_day_type('${maya}', d::date) = 'school_day' order by d limit 1`);
    expect(day, `a school day for Maya in the week of ${first}`).not.toBe('');
    const words: Record<number, string> = {
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
    };
    const inWeek = `member_id = '${maya}' and lunch_date between '${first}' and '${addDays(first, 6)}'`;
    await admin.goto(`/admin/meals?week=${first}`);
    // [MEAL-04][D-98] The usual week is folded at first (WP-75), a line per child.
    const usualFold = admin
      .getByRole('region', { name: 'School lunch' })
      .locator('details.fw-fold');
    await expect(usualFold.locator('summary')).toContainText('Maya: Mon');
    await unfold(usualFold);
    const usual = admin.getByRole('form', { name: 'Maya’s usual lunches' });
    await usual.getByRole('combobox', { name: words[weekday(day)] }).selectOption('buy');
    await usual.getByRole('button', { name: 'Save Maya’s usual lunches' }).click();
    await expect(admin.getByRole('status')).toHaveText('Usual lunches saved.');
    expect(sql(`select public.lunch_mode('${maya}', '${day}')`)).toBe('buy');

    // [MEAL-13] Maya's week on the list of days (WP-74): her day opened, Bring tapped at its top.
    await admin
      .getByRole('group', { name: 'Whose lunches' })
      .getByRole('button', { name: /^Maya/ })
      .click();
    const theDay = admin
      .getByRole('list', { name: 'Maya’s lunch week' })
      .locator(`.fw-lunchday[data-date="${day}"]`);
    const mode = theDay.getByRole('group', { name: `Maya, ${words[weekday(day)]}: buy or bring` });
    /** Opens the day unless it is open already (the page keeps it open after a change). */
    const openDay = async () => {
      if ((await theDay.locator('details').getAttribute('open')) === null)
        await theDay.locator('summary').click();
      await expect(mode).toBeVisible();
    };
    await openDay();
    await mode.getByRole('button', { name: 'Bring' }).click();
    await expect(admin.getByRole('status')).toHaveText('Lunch changed.');
    expect(
      sql(`select public.lunch_mode('${maya}', '${day}') || ':' || count(*) from public.lunch_override
                 where ${inWeek}`),
    ).toBe('bring:1');
    await expect(theDay).toContainText('Changed from the usual');
    await expect(theDay.locator('.fw-lunchday__end')).toHaveText('Bring');
    await openDay();
    await mode.getByRole('button', { name: 'Buy' }).click();
    // The status already says "Lunch changed." from the first tap, so wait for the day itself: once
    // the change is undone and the page is back, the day is Buy and not changed.
    await expect(theDay.locator('.fw-lunchday__end')).toHaveText(/^Buy/);
    await expect(theDay).not.toContainText('Changed from the usual');
    expect(sql(`select count(*) from public.lunch_override where ${inWeek}`)).toBe('0');
  } finally {
    undo();
  }
});
