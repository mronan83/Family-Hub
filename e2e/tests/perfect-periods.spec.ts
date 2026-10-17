import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { foldOf, unfold } from '../support/fold';
import { retireItems, storedRuns } from '../support/history';
import { signIn } from '../support/session';

// [RWD-19][RWD-20] Perfect weeks, and a family goal every child meets (WP-82, D-103, D-126) on the
// preview, as Alex of the demo family. The done-when: Alex sets the family "Everyone's homework home,
// each week", every child meets it, 20 points each: two weeks ago Maya and Leo each made every day and
// both are paid 20 once; last week Leo's missed Tuesday leaves the week unreached though Maya made
// every day. And Maya's "3 perfect weeks in a row" counts her own weekly homework goal's won weeks: 2
// of 3 in a row.
//
// Its own items ("Homework e2e … Maya" and "… Leo", 0 points, one each), with each day's state set in
// SQL, as the board and day close would leave them; each week's fifth to seventh days hold nothing.
// Afterwards the won family week is undone (each child's 20 points come back off, so the balances are
// as they were), the goals cancelled and the items removed. [NFR-14-t] Check-offs are append-only, so
// the items' ticks stay in Maya's and Leo's history: each is skipped, a day that counts for nothing,
// and the last step checks their good and bad runs are as before (wishlist.spec.ts and insights.spec.ts
// read Leo's as the seed left them).
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const TAG = Math.random().toString(36).slice(2, 6);
const FAMILY = `Everyone’s homework e2e ${TAG}`;
const MAYAS = `Homework home e2e ${TAG}`;
const PERFECT = `3 perfect weeks e2e ${TAG}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** Read once (D-110): this week's first day and the two weeks before. */
let thisWeek: string;
let twoAgo: string;
let lastWeek: string;
const items: Record<'Maya' | 'Leo', string> = { Maya: '', Leo: '' };

const member = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const goalId = (title: string) =>
  sql(`select id from public.reward_goal where household_id = '${DEMO}' and title = '${title.replace(/'/g, "''")}'
        order by created_at desc limit 1`);
const occurrence = (who: 'Maya' | 'Leo', date: string) =>
  sql(
    `select id from public.chore_occurrence where chore_id = '${items[who]}' and due_date = '${date}'`,
  );
/** A child's homework on `date` done, as a parent's tick would record it. */
const tick = (who: 'Maya' | 'Leo', date: string) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${occurrence(who, date)}', 'admin_complete',
               array['${member(who)}'::uuid], now())`);
/** A child's homework on `date` missed, as day close leaves it. */
const miss = (who: 'Maya' | 'Leo', date: string) =>
  sql(`update public.chore_occurrence set status = 'missed' where id = '${occurrence(who, date)}'`);
/** The family goal's payments: "Leo bonus 20, Maya bonus 20". */
const paid = () =>
  sql(`select coalesce(string_agg(m.display_name || ' ' || l.entry_type || ' ' || l.amount, ', '
                                  order by m.display_name, l.created_at, l.id), '')
         from public.points_ledger l join public.member m on m.id = l.member_id
        where l.goal_id = '${goalId(FAMILY) || '00000000-0000-0000-0000-000000000000'}'`);
/** Opens the child's Insights, which brings their stored history up to date first, then reads it. */
async function runsNow(who: 'Maya' | 'Leo') {
  await admin.goto(`/admin/insights?member=${member(who)}&days=7`);
  await expect(admin.getByRole('region', { name: 'Streaks' })).toBeVisible();
  return storedRuns(db!, member(who));
}
/** Each child's runs before the spec added anything. */
const before: Record<'Maya' | 'Leo', string> = { Maya: '', Leo: '' };
let putBackDone = false;

const weeks = (title: string) =>
  sql(`select string_agg(outcome, ', ' order by start_date) from public.reward_goal_period
        where goal_id = '${goalId(title)}' and start_date < '${thisWeek}'`);

test.beforeAll(async ({ browser }) => {
  // [D-110] Sign-in, two Insights pages and the items' set-up, about 15 s on the preview.
  test.setTimeout(60_000);
  admin = await browser.newPage();
  await signIn(admin);
  for (const who of ['Maya', 'Leo'] as const) before[who] = await runsNow(who);
  const today = householdToday(db!);
  thisWeek = weekStartOf(today, householdWeekStart(db!));
  lastWeek = addDays(thisWeek, -7);
  twoAgo = addDays(thisWeek, -14);
  for (const who of ['Maya', 'Leo'] as const) {
    items[who] = sql(`select public.save_chore('${DEMO}', null,
      jsonb_build_object('title', 'Homework e2e ${TAG} ${who}', 'kind', 'chore', 'points', 0,
                         'schedule', jsonb_build_object('freq', 'daily'), 'start_date', '${twoAgo}'),
      array['${member(who)}'::uuid])`);
  }
  sql(`select private.generate_occurrences('${DEMO}', '${twoAgo}', '${addDays(today, 7)}',
         array['${items.Maya}'::uuid, '${items.Leo}'::uuid])`);
  for (const week of [twoAgo, lastWeek, thisWeek]) {
    sql(`delete from public.chore_occurrence where chore_id in ('${items.Maya}', '${items.Leo}')
          and due_date between '${addDays(week, 4)}' and '${addDays(week, 6)}'`);
  }
  // Two weeks ago both made every day; last week Maya did and Leo missed the week's second day.
  for (let d = 0; d < 4; d++) {
    tick('Maya', addDays(twoAgo, d));
    tick('Leo', addDays(twoAgo, d));
    tick('Maya', addDays(lastWeek, d));
    if (d === 1) miss('Leo', addDays(lastWeek, d));
    else tick('Leo', addDays(lastWeek, d));
  }
});

/**
 * Puts back what the spec changed: the won family week undone, the goals cancelled, each check-off
 * skipped and the items removed. Once only: the last step does it and checks it, the clean-up does it
 * when a step before failed.
 */
async function putBack() {
  if (putBackDone) return;
  putBackDone = true;
  try {
    if (goalId(FAMILY)) {
      // The won family week undone: worked out once more, it takes back each child's 20 points.
      miss('Leo', twoAgo);
      await admin.goto('/admin/goals');
      await expect
        .poll(paid, { timeout: 30_000 })
        .toBe('Leo bonus 20, Leo reversal -20, Maya bonus 20, Maya reversal -20');
    }
  } finally {
    sql(`update public.reward_goal set status = 'cancelled', archived_at = now()
          where household_id = '${DEMO}' and title in ('${FAMILY.replace(/'/g, "''")}', '${MAYAS}', '${PERFECT}')
            and status <> 'cancelled'`);
    // [NFR-14-t] The goals cancelled first, so none is worked out again from the skips.
    retireItems(db!, Object.values(items));
  }
}

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    if (admin) await putBack();
  } finally {
    await admin?.close();
  }
});

/** Sets a goal through the form: its name, who it's for, each week from two weeks ago, every day it's due. */
async function setWeekly(title: string, who: 'Maya' | 'The whole family', itemsChecked: string[]) {
  await admin.goto('/admin/goals/new');
  const form = admin.getByRole('form', { name: 'Set a goal' });
  await form.getByLabel('Name').fill(title);
  await form.getByRole('radio', { name: who }).check();
  await form
    .getByRole('group', { name: 'Repeats' })
    .getByRole('radio', { name: 'Each week' })
    .check();
  await form.getByLabel('Starts').fill(twoAgo);
  await form.getByRole('combobox', { name: 'Counts' }).selectOption('DAYS_DUE');
  await form.getByRole('radio', { name: 'Some items' }).check();
  for (const name of itemsChecked) await form.getByRole('checkbox', { name }).check();
  return form;
}

test('[RWD-20-k][RWD-19-j][NFR-14-e][NFR-14-o][NFR-14-t][US-414][US-415] done-when: every child meets the family’s homework goal; Maya’s perfect weeks in a row; their history put back', async () => {
  // [D-110] Nine page loads (the put-back's three included) and three saves: about 50 s at worst on
  // the preview, so 3x that.
  test.setTimeout(150_000);

  await test.step('Alex sets the family goal: every child meets it, 20 points each', async () => {
    const form = await setWeekly(FAMILY, 'The whole family', [
      `Homework e2e ${TAG} Maya`,
      `Homework e2e ${TAG} Leo`,
    ]);
    await form.getByRole('checkbox', { name: /Every child meets it/ }).check();
    const pays = form.getByRole('group', { name: 'What each week pays' });
    await pays.getByRole('radio', { name: 'Points' }).check();
    await pays.getByLabel('Points paid').fill('20');
    await form.getByRole('button', { name: 'Set the goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${FAMILY}.`);
  });

  await test.step('two weeks ago both made it: each is paid 20, once; Leo’s missed Tuesday leaves last week unreached', async () => {
    await expect.poll(paid, { timeout: 30_000 }).toBe('Leo bonus 20, Maya bonus 20');
    expect(weeks(FAMILY)).toBe('won, missed');
    expect(
      sql(`select string_agg(m.display_name || ' ' || (c.value ->> 'outcome'), ', ' order by m.display_name)
             from public.reward_goal_period p, jsonb_array_elements(p.children) c
             join public.member m on m.id = (c.value ->> 'member_id')::uuid
            where p.goal_id = '${goalId(FAMILY)}' and p.start_date = '${lastWeek}'
              and m.display_name in ('Maya', 'Leo')`),
    ).toBe('Leo missed, Maya won');
    await admin.reload();
    expect(paid()).toBe('Leo bonus 20, Maya bonus 20');
  });

  await test.step('the goal’s weeks say who missed', async () => {
    await admin.getByRole('link', { name: `Change ${FAMILY}` }).click();
    await unfold(foldOf(admin, 'Weeks'));
    const rows = admin.getByRole('list', { name: 'Weeks' }).locator(':scope > li');
    await expect(rows.filter({ hasText: 'Leo missed' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Leo 4 of 4 days' })).toContainText('+20 each');
  });

  await test.step('Maya’s weekly goal, and her 3 perfect weeks in a row counting it', async () => {
    const form = await setWeekly(MAYAS, 'Maya', [`Homework e2e ${TAG} Maya`]);
    await form.getByRole('button', { name: 'Set the goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${MAYAS}.`);
    await expect.poll(() => weeks(MAYAS), { timeout: 30_000 }).toBe('won, won');

    await admin.goto('/admin/goals/new');
    const perfect = admin.getByRole('form', { name: 'Set a goal' });
    await perfect.getByLabel('Name').fill(PERFECT);
    await perfect.getByRole('radio', { name: 'Maya' }).check();
    await perfect.getByLabel('Starts').fill(twoAgo);
    await perfect.getByRole('combobox', { name: 'Counts' }).selectOption('PERIODS_WON');
    await perfect
      .getByRole('combobox', { name: 'Which goal' })
      .selectOption({ label: `${MAYAS} (each week)` });
    await perfect.getByRole('radio', { name: 'In a row' }).check();
    // [NFR-14-o] The number field by its role: a label match also finds the icon picker's "target"
    // icon, whose radio stays in the form while the picker is folded (WP-100).
    await perfect.getByRole('spinbutton', { name: 'Target' }).fill('3');
    await perfect.getByRole('button', { name: 'Set the goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${PERFECT}.`);
    await expect
      .poll(() =>
        sql(
          `select current_value from public.reward_rule_progress where goal_id = '${goalId(PERFECT)}'`,
        ),
      )
      .toBe('2');
    const card = admin
      .getByRole('list', { name: 'Goals in play' })
      .locator(':scope > li')
      .filter({ hasText: PERFECT });
    await expect(card).toContainText(`Maya · counts ${MAYAS}`);
    await expect(card).toContainText('2 of 3 weeks in a row');
  });

  await test.step('[NFR-14-t] put back: the won week undone, and Maya’s and Leo’s runs as before', async () => {
    await putBack();
    for (const who of ['Maya', 'Leo'] as const)
      expect(await runsNow(who), `${who}’s good and bad runs after the put-back`).toBe(before[who]);
  });
});
