import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { foldOf, unfold } from '../support/fold';
import { retireItems } from '../support/history';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [RWD-17][RWD-18] A goal done by a time, paid in steps (WP-81, D-102, D-124) on the preview, as Alex
// of the demo family. The done-when: Alex sets Maya "Homework before 6 pm", each week, by 6:00 pm,
// paying 20 for all days, 10 for 1 missed and 5 for 2 missed. Last week the homework was ticked at
// 5:30 pm four days and at 6:05 pm on the second: that tick completes the chore and doesn't count, so
// the closed week is won at 1 missed and pays 10, once.
//
// Its own item ("Homework e2e …", 0 points, Maya's), with each tick's time set in SQL as a board
// would record it; the week's last two days hold nothing. Afterwards the won week is undone (its 10
// points come back off, so Maya's balance is as it was), the goal cancelled and the item removed.
const family = ownHousehold('goal-steps');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const TITLE = `Homework before 6 pm e2e ${TAG}`;
const ITEM = `Homework e2e ${TAG}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** Read once (D-110): the family's today, and last week's first day. */
let today: string;
let lastWeek: string;
let item = '';

const maya = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya'`);
const goalId = () =>
  sql(`select id from public.reward_goal where household_id = '${HOUSEHOLD}' and title = '${TITLE}'
        order by created_at desc limit 1`);
const occurrence = (date: string) =>
  sql(`select id from public.chore_occurrence where chore_id = '${item}' and due_date = '${date}'`);
/** Maya's homework on `date` ticked at `time` on the family's clock, as a board records it. */
const tickAt = (date: string, time: string) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${occurrence(date)}', 'complete', array['${maya()}'::uuid],
               ('${date}'::date + '${time}'::time) at time zone
                 (select timezone from public.household where id = '${HOUSEHOLD}'))`);
const paid = () =>
  sql(`select coalesce(string_agg(entry_type || ' ' || amount, ', ' order by created_at, id), '')
         from public.points_ledger where goal_id = '${goalId() || '00000000-0000-0000-0000-000000000000'}'`);

test.beforeAll(async ({ browser }) => {
  // [D-110] Sign-in and the item's set-up, about 10 s on the preview.
  test.setTimeout(60_000);
  today = householdToday(db!);
  lastWeek = addDays(weekStartOf(today, householdWeekStart(db!)), -7);
  item = sql(`select public.save_chore('${HOUSEHOLD}', null,
    jsonb_build_object('title', '${ITEM}', 'kind', 'chore', 'points', 0,
                       'schedule', jsonb_build_object('freq', 'daily'), 'start_date', '${lastWeek}'),
    array['${maya()}'::uuid])`);
  sql(
    `select private.generate_occurrences('${HOUSEHOLD}', '${lastWeek}', '${addDays(lastWeek, 6)}', array['${item}'::uuid])`,
  );
  // Five days due; the week's last two hold nothing.
  sql(`delete from public.chore_occurrence where chore_id = '${item}'
        and due_date between '${addDays(lastWeek, 5)}' and '${addDays(lastWeek, 6)}'`);
  for (let d = 0; d < 5; d++) tickAt(addDays(lastWeek, d), d === 1 ? '18:05' : '17:30');
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    if (goalId()) {
      // The won week undone: worked out once more, it takes back its 10 points; then cancelled.
      sql(`update public.chore_occurrence set status = 'missed'
            where id in ('${occurrence(lastWeek)}', '${occurrence(addDays(lastWeek, 2))}')`);
      await admin.goto('/admin/goals');
      await expect.poll(paid, { timeout: 30_000 }).toBe('bonus 10, reversal -10');
      await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
      await unfold(foldOf(admin, 'Stop or cancel'));
      await admin.getByRole('button', { name: `Cancel ${TITLE}`, exact: true }).click();
      await expect(admin.getByRole('status')).toHaveText('Cancelled. It’s in the history.');
    }
  } finally {
    // [NFR-14-t] Its ticks skipped, so Maya's good and bad runs are as before (WP-109); its days
    // without a check-off removed and it archived.
    retireItems(db!, [item]);
    await admin?.close();
  }
});

test('[RWD-18-m][RWD-17-e][NFR-14-e][US-412][US-413] done-when: Maya’s homework by 6 pm in steps, a 6:05 pm tick that doesn’t count, a week of 4 on time paying 10', async () => {
  // [D-110] Four page loads and a save: about 30 s at worst on the preview, so 3x that.
  test.setTimeout(90_000);

  await test.step('Alex sets the goal: each week, by 6:00 pm, 20, 10 or 5 points', async () => {
    await admin.goto('/admin/goals/new');
    const form = admin.getByRole('form', { name: 'Set a goal' });
    await form.getByLabel('Name').fill(TITLE);
    await form.getByRole('radio', { name: 'Maya' }).check();
    await form
      .getByRole('group', { name: 'Repeats' })
      .getByRole('radio', { name: 'Each week' })
      .check();
    await form.getByLabel('Starts').fill(lastWeek);
    await form.getByRole('combobox', { name: 'Counts' }).selectOption('DAYS_DUE');
    await form.getByRole('radio', { name: 'Some items' }).check();
    await form.getByRole('checkbox', { name: ITEM }).check();
    await form.getByRole('radio', { name: 'By', exact: true }).check();
    await form.getByRole('textbox', { name: 'Time' }).fill('18:00');
    const pays = form.getByRole('group', { name: 'What each week pays' });
    await pays.getByRole('radio', { name: 'Points' }).check();
    await pays.getByLabel('Points paid').fill('20');
    const steps = form.getByRole('group', { name: 'Pay in steps' });
    await steps.getByRole('checkbox', { name: 'Pay less for a week with misses' }).check();
    await steps.getByLabel('1 missed').fill('10');
    await steps.getByLabel('2 missed').fill('5');
    await form.getByRole('button', { name: 'Set the goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${TITLE}.`);
  });

  await test.step('the 6:05 pm tick completes the chore and doesn’t count; the week pays 10, once', async () => {
    expect(
      sql(
        `select status from public.chore_occurrence where id = '${occurrence(addDays(lastWeek, 1))}'`,
      ),
    ).toBe('completed');
    // The Goals page works the goal out before it reads (previews run no jobs).
    await expect.poll(paid, { timeout: 30_000 }).toBe('bonus 10');
    await admin.reload();
    await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
    expect(paid()).toBe('bonus 10');
    expect(
      sql(`select outcome || ':' || days_done || '/' || days_due || ':' || step || ':' ||
                  (days -> 1 ->> 'mark')
             from public.reward_goal_period where goal_id = '${goalId()}' and start_date = '${lastWeek}'`),
    ).toBe('won:4/5:1:late');
  });

  await test.step('the goal’s weeks say it was won at 1 missed, and why', async () => {
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    await unfold(foldOf(admin, 'Weeks'));
    const rows = admin.getByRole('list', { name: 'Weeks' }).locator(':scope > li');
    const won = rows.filter({ hasText: 'Won at 1 missed: 10 points' });
    await expect(won).toContainText('+10');
    await expect(won).toContainText('4 of 5 days');
    await unfold(foldOf(admin, 'What happened'));
    await expect(admin.getByRole('list', { name: 'What happened' })).toContainText(
      'paid 10 points',
    );
  });
});
