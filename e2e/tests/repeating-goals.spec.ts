import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { pairBoard, retireBoard } from '../support/board';
import { foldOf, unfold } from '../support/fold';
import { retireItems } from '../support/history';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [RWD-15][RWD-16] Goals that repeat each week (WP-80, D-101, D-123) on the preview, as Alex of the
// demo family. The done-when: Alex sets Maya "Homework home every school day, each week" paying 10
// points. Two weeks ago Monday to Thursday were done and Friday was a day off school (nothing due), so
// that week is won and pays 10 once, however often it is worked out; last week a missed Tuesday lost it;
// Goals shows the weeks. On the board, Maya's card shows her weeks and, when this week already has a
// missed day (any day but the week's first), "Missed, starts again" next week's first day.
//
// Its own item ("Homework e2e …", 0 points, Maya's), with each day's state set in SQL, as the board and
// day close would leave them; the item's Friday to Sunday hold nothing. Afterwards the won week is
// undone (its 10 points come back off, so Maya's balance is as it was), the goal cancelled and the
// item removed.
const family = ownHousehold('repeating-goals');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const TITLE = `Homework home e2e ${TAG}`;
const ITEM = `Homework e2e ${TAG}`;
const BOARD = `Repeat e2e ${TAG}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page | undefined;
/** Read once (D-110): the family's today, this week's first day, and the two weeks before. */
let today: string;
let thisWeek: string;
let twoAgo: string;
let lastWeek: string;
let item = '';

const maya = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya'`);
const goalId = () =>
  sql(`select id from public.reward_goal where household_id = '${HOUSEHOLD}' and title = '${TITLE}'
        order by created_at desc limit 1`);
const occurrence = (date: string) =>
  sql(`select id from public.chore_occurrence where chore_id = '${item}' and due_date = '${date}'`);
/** Maya's homework on `date` done, as a parent's tick would record it. */
const tick = (date: string) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${occurrence(date)}', 'admin_complete', array['${maya()}'::uuid], now())`);
/** Maya's homework on `date` missed, as day close leaves it. */
const miss = (date: string) =>
  sql(`update public.chore_occurrence set status = 'missed' where id = '${occurrence(date)}'`);
const paid = () =>
  sql(`select coalesce(string_agg(entry_type || ' ' || amount, ', ' order by created_at, id), '')
         from public.points_ledger where goal_id = '${goalId() || '00000000-0000-0000-0000-000000000000'}'`);
const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

test.beforeAll(async ({ browser }) => {
  // [D-110] Sign-in and the item's set-up, about 10 s on the preview.
  test.setTimeout(60_000);
  today = householdToday(db!);
  thisWeek = weekStartOf(today, householdWeekStart(db!));
  lastWeek = addDays(thisWeek, -7);
  twoAgo = addDays(thisWeek, -14);
  item = sql(`select public.save_chore('${HOUSEHOLD}', null,
    jsonb_build_object('title', '${ITEM}', 'kind', 'chore', 'points', 0,
                       'schedule', jsonb_build_object('freq', 'daily'), 'start_date', '${twoAgo}'),
    array['${maya()}'::uuid])`);
  sql(
    `select private.generate_occurrences('${HOUSEHOLD}', '${twoAgo}', '${addDays(today, 7)}', array['${item}'::uuid])`,
  );
  // Each week's fifth to seventh days hold nothing: a day off school, then the weekend.
  for (const week of [twoAgo, lastWeek, thisWeek]) {
    sql(`delete from public.chore_occurrence where chore_id = '${item}'
          and due_date between '${addDays(week, 4)}' and '${addDays(week, 6)}'`);
  }
  for (let d = 0; d < 4; d++) {
    tick(addDays(twoAgo, d));
    if (d === 1) miss(addDays(lastWeek, d));
    else tick(addDays(lastWeek, d));
  }
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  try {
    if (goalId()) {
      // The won week undone: worked out once more, it takes back its 10 points; then cancelled.
      miss(twoAgo);
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
    await retireBoard(board, BOARD);
    await admin?.close();
  }
});

test('[RWD-15-m][US-410][US-411][NFR-14-e] done-when: Maya’s weekly homework goal, a 4-day week won and paid once, a missed Tuesday, the weeks on Goals and the board', async ({
  browser,
}) => {
  // [D-110] Six page loads, a save, and pairing a board (10 to 40 s, board.ts): about 70 s at worst
  // on the preview, so 3x that.
  test.setTimeout(210_000);

  await test.step('Alex sets the goal: each week, every day it’s due, 10 points a week', async () => {
    await admin.goto('/admin/goals/new');
    const form = admin.getByRole('form', { name: 'Set a goal' });
    await form.getByLabel('Name').fill(TITLE);
    await form.getByRole('radio', { name: 'Maya' }).check();
    await form
      .getByRole('group', { name: 'Repeats' })
      .getByRole('radio', { name: 'Each week' })
      .check();
    await form.getByLabel('Starts').fill(twoAgo);
    await form.getByRole('combobox', { name: 'Counts' }).selectOption('DAYS_DUE');
    await form.getByRole('radio', { name: 'Some items' }).check();
    await form.getByRole('checkbox', { name: ITEM }).check();
    const pays = form.getByRole('group', { name: 'What each week pays' });
    await pays.getByRole('radio', { name: 'Points' }).check();
    await pays.getByLabel('Points paid').fill('10');
    await form.getByRole('button', { name: 'Set the goal' }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${TITLE}.`);
  });

  await test.step('two weeks ago, 4 of 4 days with Friday off, is won and pays 10 once', async () => {
    // The Goals page works the goal out before it reads (previews run no jobs).
    await expect.poll(paid, { timeout: 30_000 }).toBe('bonus 10');
    await admin.reload();
    await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
    expect(paid()).toBe('bonus 10');
    expect(
      sql(`select string_agg(outcome || ':' || days_done || '/' || days_due, ', ' order by start_date)
             from public.reward_goal_period where goal_id = '${goalId()}' and start_date < '${thisWeek}'`),
    ).toBe('won:4/4, missed:3/4');
  });

  await test.step('Goals shows the weeks: one won, one lost on its Tuesday', async () => {
    const card = admin
      .getByRole('list', { name: 'Goals in play' })
      .locator(':scope > li')
      .filter({ hasText: TITLE });
    await expect(card).toContainText('Maya · each week · Pays 10 points');
    await expect(card).toContainText(/Won 1 of the last [23] weeks/);
    await admin.getByRole('link', { name: `Change ${TITLE}` }).click();
    await unfold(foldOf(admin, 'Weeks'));
    const rows = admin.getByRole('list', { name: 'Weeks' }).locator(':scope > li');
    await expect(rows.filter({ hasText: 'Won · 4 of 4 days' })).toContainText('+10');
    await expect(rows.filter({ hasText: `Missed ${weekday(addDays(lastWeek, 1))}.` })).toHaveCount(
      1,
    );
  });

  await test.step('the board shows Maya her weeks, and a week lost this week starts again next week', async () => {
    // A day of this week before today, missed: there is none on the week's first day (today is
    // never a miss), and then the board shows the week going.
    const lost = today > thisWeek && addDays(today, -1) < addDays(thisWeek, 4);
    if (lost) {
      miss(addDays(today, -1));
      await admin.goto('/admin/goals');
      await expect
        .poll(() =>
          sql(`select outcome from public.reward_goal_period
                where goal_id = '${goalId()}' and start_date = '${thisWeek}'`),
        )
        .toBe('missed');
    }
    // The won week was celebrated by no board yet; mark it, so this board opens on Maya's screen.
    sql(`update public.reward_goal_period set celebrated_at = now() where goal_id = '${goalId()}'`);
    ({ board } = await pairBoard(browser, BOARD));
    await board
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: 'Maya', exact: true })
      .click();
    const card = board.locator(`[data-goal="${goalId()}"]`);
    await expect(card.getByRole('list', { name: /^The last \d weeks$/ })).toBeVisible();
    await expect(card.getByRole('listitem', { name: new RegExp(`^Week of .*: won$`) })).toHaveCount(
      1,
    );
    if (lost) {
      const next = addDays(thisWeek, 7);
      await expect(card.locator('.fw-goal-line')).toHaveText(
        `Missed, starts again ${weekday(next)}, ${new Date(`${next}T12:00:00Z`).toLocaleDateString(
          'en-US',
          { month: 'short', day: 'numeric', timeZone: 'UTC' },
        )}`,
      );
    }
  });
});
