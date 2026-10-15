import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { householdToday } from '../support/day';
import { signIn } from '../support/session';

// [RWD-04][RWD-10][RWD-13] Goal payouts and the preview of a change on the preview (WP-39, D-75), as
// Alex of the demo family. The done-when: a goal that pays 10 points posts one bonus when Maya's bed
// reaches it, even when it is worked out twice; unchecking the bed takes the 10 back once; checking
// it again pays again as achievement 2. Then its change form keeps its rules and dates: a reached goal
// can't change them (D-115), so nothing it paid can be taken back by an edit. (A fulfilled shop reward raising the review flag is pgTAP's,
// 320_goal_payouts.) Previews run no jobs, so the Goals page works goals out before it reads.
//
// Leo is left alone (goals.spec reads his goal's history). Afterwards Maya's bed is put back (which
// takes back achievement 2's points, so her balance is as it was) and the test goal is cancelled.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const TITLE = 'Payout e2e';
const sql = (q: string) => query(db!, q);

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

const maya = () =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`);
const goalId = () =>
  sql(`select id from public.reward_goal where household_id = '${DEMO}' and title = '${TITLE}'
        and status <> 'cancelled' order by created_at desc limit 1`);
/** The goal's ledger entries in posting order: "bonus 10 n1, reversal -10 n1". */
const paid = () =>
  sql(`select coalesce(string_agg(entry_type || ' ' || amount || ' n' || goal_n, ', ' order by created_at, id), '')
         from public.points_ledger where goal_id = '${goalId()}'`);
const state = () =>
  sql(`select status || ':' || achievement_count from public.reward_goal where id = '${goalId()}'`);
/** As if the job found the goal dirty again: the next read of the Goals page works it out again. */
const markDirty = () =>
  sql(`update public.reward_goal_progress set dirty = true, marked_at = clock_timestamp()
        where goal_id = '${goalId()}'`);

/** Maya's bed today, found once: put back by its id, so the family's midnight can't move it. */
let mayaBed = '';

/** Maya's bed as the seed left it (still to do today): a parent's uncheck. */
function putBackBed() {
  const bed = mayaBed;
  if (
    bed &&
    sql(`select status from public.chore_occurrence where id = '${bed}'`) !== 'scheduled'
  ) {
    sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
         values (gen_random_uuid(), '${bed}', 'admin_uncomplete', now())`);
  }
}

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;

test.beforeAll(async ({ browser }) => {
  // A retry starts again: the bed to do, no test goal in play.
  mayaBed = sql(`select id from public.chore_occurrence where chore_id = '${MAKE_BED}'
                   and due_date = '${householdToday(db!)}' and member_id = '${maya()}'`);
  putBackBed();
  sql(`update public.reward_goal set status = 'cancelled', archived_at = now()
        where household_id = '${DEMO}' and title = '${TITLE}' and status <> 'cancelled'`);
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  putBackBed();
  try {
    if (goalId()) {
      // Worked out once more (the bed undone takes back what it paid), then cancelled.
      await admin.goto('/admin/goals');
      await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
      await admin.getByRole('button', { name: `Cancel ${TITLE}`, exact: true }).click();
      await expect(admin.getByRole('status')).toHaveText('Cancelled. It’s in the history.');
    }
  } finally {
    // Whatever happened above, the test goal is not left in play for goals.spec and the boards.
    sql(`update public.reward_goal set status = 'cancelled', archived_at = now()
          where household_id = '${DEMO}' and title = '${TITLE}' and status <> 'cancelled'`);
    await admin?.context().close();
  }
});

const goal = () =>
  admin
    .getByRole('list', { name: 'Goals in play' })
    .getByRole('listitem')
    .filter({ hasText: TITLE });

async function setBed(action: 'Mark' | 'Uncheck') {
  await admin.goto('/admin/today');
  if (action === 'Mark') {
    await admin.getByRole('button', { name: 'Mark Make bed (Maya) done', exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText('Marked Make bed (Maya) done.');
  } else {
    await admin.getByRole('button', { name: 'Uncheck Make bed (Maya)', exact: true }).click();
    await expect(admin.getByRole('status')).toContainText('Unchecked Make bed (Maya).');
  }
}

test('[RWD-13][RWD-10][RWD-04][US-409][US-406] a goal that pays 10 points: set with a preview, paid once, taken back once, paid again as n + 1; a preview of raising the target saves nothing', async () => {
  // One story in three steps: about 20 server round trips (3 check-offs, 8 Goals pages that work
  // goals out before they render, 2 saves, 2 previews), up to about 60 s on a slow preview; 3x that.
  test.setTimeout(180_000);
  await test.step('a parent sets Maya a goal that pays 10 points, previewing it first', async () => {
    await admin.goto('/admin/goals/new');
    const form = admin.getByRole('form', { name: 'Set a goal' });
    await form.getByLabel('Name', { exact: true }).fill(TITLE);
    await form.getByRole('radio', { name: 'Maya', exact: true }).check();
    await form.getByRole('combobox', { name: 'Counts' }).selectOption('COUNT');
    await form.getByRole('spinbutton', { name: 'Target', exact: true }).fill('1');
    await form.getByRole('radio', { name: 'Some items', exact: true }).check();
    await form.getByRole('checkbox', { name: 'Make bed', exact: true }).check();
    const pays = form.getByRole('group', { name: 'What reaching it pays' });
    await pays.getByRole('radio', { name: 'Points', exact: true }).check();
    await pays.getByRole('spinbutton', { name: 'Points paid' }).fill('10');

    await form.getByRole('button', { name: 'Preview' }).click();
    const preview = form.getByRole('region', { name: 'Preview' });
    await expect(preview).toContainText('It starts 0% of the way there, from what’s already done.');
    await expect(preview.getByRole('row', { name: /1 thing done, from Make bed/ })).toContainText(
      '0 of 1',
    );
    expect(goalId()).toBe('');

    await form.getByRole('button', { name: 'Set goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${TITLE}.`);
    await expect(goal()).toContainText('Maya · Started');
    await expect(goal()).toContainText('Pays 10 points');
    expect(sql(`select payout::text from public.reward_goal where id = '${goalId()}'`)).toBe(
      '{"type": "points", "amount": 10}',
    );
  });

  await test.step('done-when: paid once however often it is worked out, taken back once, paid again as n + 1', async () => {
    const before = Number(
      sql(
        `select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${maya()}'`,
      ),
    );
    await setBed('Mark');
    const started = Date.now();
    await admin.goto('/admin/goals');
    await expect(goal()).toContainText('Achieved');
    report(`WP-39: reached and paid ${Date.now() - started} ms after the Goals page was opened`);
    expect(paid()).toBe('bonus 10 n1');
    expect(state()).toBe('achieved:1');

    // Worked out twice more: nothing more is paid.
    for (let i = 0; i < 2; i++) {
      markDirty();
      await admin.goto('/admin/goals');
      await expect(goal()).toContainText('Achieved');
    }
    expect(paid()).toBe('bonus 10 n1');

    await setBed('Uncheck');
    await admin.goto('/admin/goals');
    await expect(goal()).toContainText('Going');
    markDirty();
    await admin.goto('/admin/goals');
    await expect(goal()).toContainText('Going');
    expect(paid()).toBe('bonus 10 n1, reversal -10 n1');

    await setBed('Mark');
    await admin.goto('/admin/goals');
    await expect(goal()).toContainText('Achieved again');
    expect(paid()).toBe('bonus 10 n1, reversal -10 n1, bonus 10 n2');
    expect(state()).toBe('achieved:2');
    // The bed's own 5 points and the goal's 10.
    expect(
      Number(
        sql(
          `select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${maya()}'`,
        ),
      ),
    ).toBe(before + 15);

    // Its history says what it paid and took back.
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    const history = admin.getByRole('list', { name: 'What happened' });
    await expect(history).toContainText('Achieved again (2nd time): paid 10 points');
    await expect(history).toContainText('Payout undone: 10 points taken back');
  });

  await test.step('a reached goal keeps its rules and dates (D-115): its form offers no target, end date or preview; nothing changes', async () => {
    const version = sql(`select rules_version from public.reward_goal where id = '${goalId()}'`);
    await admin.goto('/admin/goals');
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    await expect(
      admin.getByText('It has been reached, so its rules and dates stay as they are.'),
    ).toBeVisible();
    const form = admin.getByRole('form', { name: `Edit ${TITLE}` });
    await expect(form.getByLabel('Name')).toBeEditable();
    await expect(form.getByRole('spinbutton', { name: 'Target', exact: true })).toHaveCount(0);
    await expect(form.getByRole('group', { name: 'Ends' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Preview' })).toHaveCount(0);
    expect(sql(`select rules_version from public.reward_goal where id = '${goalId()}'`)).toBe(
      version,
    );
    expect(state()).toBe('achieved:2');
    expect(paid()).toBe('bonus 10 n1, reversal -10 n1, bonus 10 n2');
  });
});
