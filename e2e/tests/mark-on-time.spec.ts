import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { retireItems } from '../support/history';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [CHR-24][D-151] A parent marks a missed chore done on time (WP-117) on the preview, as Alex of the
// spec's own household. Maya's "Homework folder e2e …" is due at 3:30 pm, 3 points, on four days a week
// (the fifth a day off school, then the weekend); her goal "Homework home, by its due time" pays 10
// points a week when every day it's due is done by its due time. Last week Monday, Tuesday and
// Thursday were ticked at 3 pm and Wednesday was missed, so last week is lost. Alex opens Today on that
// Wednesday and marks it done on time: the week is settled, so the page asks first ("a win: 10
// points"); confirmed, Wednesday is approved for Maya with its 3 points, its goal counts it, the week
// is won and pays 10 once, however often it is worked out, and Today says "Marked on time by Alex".
//
// Afterwards Wednesday is unchecked (its points and the week's 10 come back off), the goal is
// cancelled and the item retired (its ticks skipped, so Maya's balance and runs are as they were).
const family = ownHousehold('mark-on-time');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const ITEM = `Homework folder e2e ${TAG}`;
const TITLE = `Homework home on time e2e ${TAG}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** Read once (D-110): the family's today, and last week's first day. */
let today: string;
let lastWeek: string;
let item = '';
let goal = '';

const maya = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya'`);
const occurrence = (date: string) =>
  sql(`select id from public.chore_occurrence where chore_id = '${item}' and due_date = '${date}'`);
/** Maya's homework on `date` ticked by a parent at 3 pm that day, on time. */
const tickAtThree = (date: string) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       select gen_random_uuid(), '${occurrence(date)}', 'admin_complete', array['${maya()}'::uuid],
              ('${date}'::date + time '15:00') at time zone h.timezone
         from public.household h where h.id = '${HOUSEHOLD}'`);
const paid = () =>
  sql(`select coalesce(string_agg(entry_type || ' ' || amount, ', ' order by created_at, id), '')
         from public.points_ledger where goal_id = '${goal || '00000000-0000-0000-0000-000000000000'}'`);
const earned = (date: string) =>
  sql(
    `select coalesce(sum(amount), 0) from public.points_ledger where occurrence_id = '${occurrence(date)}'`,
  );
const lastWeekOutcome = () =>
  sql(`select outcome from public.reward_goal_period
        where goal_id = '${goal}' and start_date = '${lastWeek}'`);

test.beforeAll(async ({ browser }) => {
  // [D-110] Sign-in and the item's set-up, about 10 s on the preview.
  test.setTimeout(60_000);
  today = householdToday(db!);
  lastWeek = addDays(weekStartOf(today, householdWeekStart(db!)), -7);
  item = sql(`select public.save_chore('${HOUSEHOLD}', null,
    jsonb_build_object('title', '${ITEM}', 'kind', 'chore', 'points', 3, 'due_time', '15:30',
                       'schedule', jsonb_build_object('freq', 'daily'), 'start_date', '${lastWeek}'),
    array['${maya()}'::uuid])`);
  sql(
    `select private.generate_occurrences('${HOUSEHOLD}', '${lastWeek}', '${addDays(today, 7)}', array['${item}'::uuid])`,
  );
  // Last week's fifth to seventh days hold nothing: a day off school, then the weekend.
  sql(`delete from public.chore_occurrence where chore_id = '${item}'
        and due_date between '${addDays(lastWeek, 4)}' and '${addDays(lastWeek, 6)}'`);
  for (const d of [0, 1, 3]) tickAtThree(addDays(lastWeek, d));
  // Wednesday missed, as day close leaves it.
  sql(`update public.chore_occurrence set status = 'missed', finalized_at = now()
        where id = '${occurrence(addDays(lastWeek, 2))}'`);
  // reward_goal.id has no default (the goal form makes its own), so the spec makes one too.
  goal = sql(`insert into public.reward_goal (id, household_id, member_id, title, icon, start_date,
                                              end_date, rule_logic, status, repeats, payout, created_by)
              select gen_random_uuid(), '${HOUSEHOLD}', '${maya()}', '${TITLE}', 'backpack', '${lastWeek}', null, 'all', 'active',
                     'week', '{"type": "points", "amount": 10}', hu.user_id
                from public.household_user hu where hu.household_id = '${HOUSEHOLD}' limit 1
              returning id`);
  sql(`insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
       values ('${HOUSEHOLD}', '${goal}', 'DAYS_DUE', 1, '{"chore_ids": ["${item}"]}',
               '{"misses_allowed": 0, "on_time": "due_time"}', 1);
       insert into public.reward_goal_progress (goal_id, household_id) values ('${goal}', '${HOUSEHOLD}')`);
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    if (goal) {
      // Wednesday unchecked: the week, worked out once more, takes back its 10; then cancelled.
      sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
           values (gen_random_uuid(), '${occurrence(addDays(lastWeek, 2))}', 'admin_uncomplete', now())`);
      if (paid() !== '') {
        await admin.goto('/admin/goals');
        await expect.poll(paid, { timeout: 30_000 }).toBe('bonus 10, reversal -10');
      }
      sql(`update public.reward_goal set status = 'cancelled' where id = '${goal}'`);
    }
  } finally {
    retireItems(db!, [item]);
    await admin?.close();
  }
});

test('[CHR-24-m][CHR-24-n][US-326] Alex marks Maya’s missed Wednesday done on time from Today: the settled week asks first, is won and paid once, and Today shows the trace', async () => {
  // [D-110] Five page loads and two form posts with the goal worked out: about 25 s on the
  // preview, so 3x that.
  test.setTimeout(90_000);
  const wednesday = addDays(lastWeek, 2);

  await test.step('last week is lost on its Wednesday, worked out on Goals', async () => {
    await admin.goto('/admin/goals');
    await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
    await expect.poll(lastWeekOutcome, { timeout: 30_000 }).toBe('missed');
    expect(paid()).toBe('');
  });

  const row = () => admin.locator('li.fw-day__row').filter({ hasText: ITEM });
  await test.step('Today on that Wednesday: Done on time… asks first, saying what it pays', async () => {
    await admin.goto(`/admin/today?date=${wednesday}`);
    await expect(row()).toContainText('Missed');
    await row().locator('details.fw-ontime > summary').click();
    await expect(row().getByRole('radio', { name: /On time/ })).toBeChecked();
    await row()
      .getByRole('button', { name: `Mark ${ITEM} done on time` })
      .click();
    await expect(admin).toHaveURL(/[?&]confirm=/);
    await expect(row().getByRole('status')).toHaveText(
      /^This makes Maya’s week of \w+ \d+ a win: 10 points\. It’s paid once\.$/,
    );
    // Nothing is recorded until Alex confirms.
    expect(earned(wednesday)).toBe('0');
  });

  await test.step('confirmed: done for Maya, its points back, the goal counts it, the week won and paid', async () => {
    await row()
      .getByRole('button', { name: `Mark ${ITEM} done on time` })
      .click();
    await expect(
      admin.getByText(`Marked ${ITEM} done on time. It counts for Maya’s goals.`),
    ).toBeVisible();
    await expect(row()).toContainText('Done by Maya');
    await expect(row().locator('.fw-ontime__trace')).toHaveText(
      /^Marked on time by Alex, \w+ \d+$/,
    );
    expect(
      sql(`select o.status || ' ' || e.marked_on_time
             from public.chore_occurrence o join public.chore_completion_event e on e.id = o.status_event_id
            where o.id = '${occurrence(wednesday)}'`),
    ).toBe('approved true');
    expect(earned(wednesday)).toBe('3');
    await expect.poll(lastWeekOutcome, { timeout: 30_000 }).toBe('won');
    await expect.poll(paid, { timeout: 30_000 }).toBe('bonus 10');
  });

  await test.step('worked out again, the week pays once', async () => {
    await admin.goto('/admin/goals');
    await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
    sql(`update public.reward_goal_progress set dirty = true where goal_id = '${goal}'`);
    await admin.reload();
    await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
    await expect
      .poll(() => sql(`select dirty from public.reward_goal_progress where goal_id = '${goal}'`), {
        timeout: 30_000,
      })
      .toBe('f');
    expect(paid()).toBe('bonus 10');
  });
});
