import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [RWD-14] A goal's end date that can be cleared (WP-79, D-115), as Alex of the demo family on a
// 390 px phone, on the preview. The done-when: Alex opens a goal of Maya's that has an end date,
// unticks **Ends on a date**, saves, and the goal reads "no end date" and stays active, with no end
// date stored (so it can't expire on the old date: the engine's, rules-engine goal.test.ts); opening
// it again shows the box unticked. Then a date is added back, as a started goal may. Its own goal,
// made in SQL with a unique name (target 99, so nothing reaches it), removed afterwards.
const family = ownHousehold('goal-end-date');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const ALEX = family.own('0de00000-0000-4000-8000-0000000000a1');
const GOAL = 'e2e79000-0000-4000-8000-000000000001';
const TITLE = `Ends e2e ${Math.random().toString(36).slice(2, 6)}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');
test.use({ viewport: { width: 390, height: 844 } });

let admin: Page;
/** The demo family's today and the goal's end date, read once (D-110). */
let today: string;
let oldEnd: string;

const clear = () => sql(`delete from public.reward_goal where id = '${GOAL}'`);
const stored = () =>
  sql(
    `select status || ':' || coalesce(end_date::text, 'none') from public.reward_goal where id = '${GOAL}'`,
  );

test.beforeAll(async ({ browser }) => {
  today = householdToday(db!);
  oldEnd = addDays(today, 10);
  clear();
  sql(`insert into public.reward_goal (id, household_id, member_id, title, icon, start_date, end_date, rule_logic,
                                       status, created_by)
       select '${GOAL}', '${HOUSEHOLD}', id, '${TITLE}', 'trophy', '${addDays(today, -5)}', '${oldEnd}', 'all', 'active',
              '${ALEX}'
         from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya';
       insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
       values ('${HOUSEHOLD}', '${GOAL}', 'COUNT', 99, '{"all": true}', '{}', 1);
       insert into public.reward_goal_progress (goal_id, household_id) values ('${GOAL}', '${HOUSEHOLD}')`);
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  try {
    // Gone from the demo family's goals for every other spec and the boards (it paid nothing).
    clear();
  } finally {
    await admin?.close();
  }
});

const inPlay = () =>
  admin
    .getByRole('list', { name: 'Goals in play' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

test('[RWD-14] done-when: on a phone, Alex takes the end date off a goal of Maya’s; it stays active with no end date, and opens unticked', async () => {
  // [D-110] Four page loads and two saves (a save is 3 to 8 s on a preview, as meals.spec.ts
  // measures), about 25 s at worst: three times that.
  test.setTimeout(75_000);
  const form = admin.getByRole('form', { name: `Edit ${TITLE}` });
  const ends = form.getByRole('group', { name: 'Ends' });
  const box = ends.getByRole('checkbox', { name: 'Ends on a date' });

  await test.step('the goal opens with its end date ticked and filled in', async () => {
    await admin.goto('/admin/goals');
    await expect(inPlay()).toContainText('ends');
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    await expect(box).toBeChecked();
    await expect(ends.getByLabel('End date')).toHaveValue(oldEnd);
  });

  await test.step('unticking hides the date; saving stores no end date and the goal stays active', async () => {
    await box.uncheck();
    await expect(ends.getByLabel('End date')).toHaveCount(0);
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${TITLE}.`);
    await expect(inPlay()).toContainText('no end date');
    expect(stored()).toBe('active:none');
  });

  await test.step('opening it again shows the box unticked', async () => {
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    await expect(box).not.toBeChecked();
    await expect(ends).toContainText('No end date.');
  });

  await test.step('a started goal with no end date is given one again', async () => {
    const back = addDays(today, 20);
    await box.check();
    await ends.getByLabel('End date').fill(back);
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${TITLE}.`);
    expect(stored()).toBe(`active:${back}`);
  });
});
