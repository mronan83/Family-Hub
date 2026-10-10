import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';

// [PTS-02][PTS-04][RWD-07][RWD-08] The board's shop, requests and goals on the preview (WP-20, D-59),
// at the reference panel's 3840×2160 (the board-4k project). The done-when: Maya earns points on the
// board, asks for a reward from her shop, sees it waiting, and Alex approves it in the admin app; the
// board shows the yes and the balance drops by its cost, live. Then a one-thing goal set for her today
// is nudged ("one more"), reached by that check-off once the Goals page has worked it out (previews run
// no jobs), and celebrated once by the board, which records it. Her seeded "Trip to the park", reached
// by the same evaluation, is celebrated in turn: each once.
//
// Leo is left alone (goals.spec reads his goal's history). Afterwards the reward is refunded, the bed
// put back, the test goal cancelled, and every reached goal recorded as celebrated, so the boards of
// later specs never open on a celebration.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Shop e2e';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const STAY_UP = '0de00000-0000-4000-8000-0000000e0003';
const STAY_UP_TITLE = 'Stay up 30 minutes late';
const GOAL = '0de00000-0000-4000-8000-0000000620e2';
const GOAL_TITLE = 'E2E kite';
const TODAY = `(now() at time zone 'America/New_York')::date`;

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}
const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const balance = (member: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${member}'`),
  );
const mayaBed = () =>
  sql(`select id from public.chore_occurrence where chore_id = '${MAKE_BED}' and due_date = ${TODAY}
         and member_id = '${memberId('Maya')}'`);

/** Maya's bed as the seed left it (still to do today): a parent's uncheck. */
function putBackBed() {
  const bed = mayaBed();
  if (sql(`select status from public.chore_occurrence where id = '${bed}'`) !== 'scheduled') {
    sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
         values (gen_random_uuid(), '${bed}', 'admin_uncomplete', now())`);
  }
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
const people = () => board.getByRole('list', { name: 'Family', exact: true });

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  // A retry starts again: the bed to do, no board of this name, the test goal set afresh.
  putBackBed();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';
       delete from public.reward_goal where id = '${GOAL}';`);
  // One thing done from today reaches it, ending tomorrow (so it is Maya's first goal on the board).
  sql(`insert into public.reward_goal (id, household_id, member_id, title, icon, start_date, end_date,
                                       rule_logic, status, created_at)
       values ('${GOAL}', '${DEMO}', '${memberId('Maya')}', '${GOAL_TITLE}', 'star', ${TODAY}, ${TODAY} + 1,
               'all', 'active', now());
       insert into public.reward_rule (household_id, goal_id, rule_type, target, scope, params, sort_order)
       values ('${DEMO}', '${GOAL}', 'COUNT', 1, '{"all": true}', '{}', 1);
       insert into public.reward_goal_progress (goal_id, household_id) values ('${GOAL}', '${DEMO}');`);

  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext({ hasTouch: true })).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  // Refund the reward (a parent cancels it), put the bed back, cancel the test goal.
  const approved = sql(
    `select coalesce(string_agg(id::text, ','), '') from public.redemption
      where member_id = '${memberId('Maya')}' and catalog_item_id = '${STAY_UP}' and status = 'approved'`,
  );
  if (approved) {
    await admin.goto('/admin/rewards');
    for (let n = approved.split(',').length; n > 0; n--) {
      await admin
        .getByRole('button', { name: `Cancel ${STAY_UP_TITLE} for Maya and refund`, exact: true })
        .first()
        .click();
      await expect(admin.getByRole('status')).toHaveText(
        'Cancelled. Any points spent on it are back.',
      );
    }
  }
  putBackBed();
  sql(`update public.reward_goal set status = 'cancelled', archived_at = now() where id = '${GOAL}';
       update public.reward_goal set celebrated_at = coalesce(celebrated_at, now())
        where household_id = '${DEMO}' and status = 'achieved';`);
  await retireBoard(board, BOARD);
});

test("[PTS-02][RWD-07][US-403] Maya's day: her balance, her goals, and a nudge naming the one nearly reached", async () => {
  await people().getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(board.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
  const maya = memberId('Maya');
  await expect(board.locator('.fw-today__me-head [data-balance]')).toHaveAttribute(
    'data-balance',
    String(balance(maya)),
  );
  await expect(board.locator('.fw-today__me-head .fw-today__nudge')).toHaveText(
    `One more thing to do for ${GOAL_TITLE}!`,
  );
  const goals = board.getByRole('region', { name: 'Goals' });
  await expect(
    goals.getByRole('listitem').filter({ hasText: GOAL_TITLE }).getByRole('progressbar'),
  ).toHaveAttribute('aria-valuetext', '0 of 1, 0%');
  await expect(goals.getByRole('listitem').filter({ hasText: 'Pizza night' })).toContainText(
    'Family',
  );
});

test('[PTS-04][US-1104][US-1105] the done-when: Maya earns, asks for a reward, Alex approves, the board shows it', async () => {
  const maya = memberId('Maya');
  const before = balance(maya);
  // Earn: her bed, on the board.
  await board.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
  await expect.poll(() => balance(maya)).toBe(before + 5);

  // Ask: from her shop, once more to be sure.
  await board.getByRole('button', { name: 'Shop', exact: true }).click();
  const shop = board.getByRole('dialog', { name: 'Maya’s shop' });
  await shop.getByRole('button', { name: `Ask for this: ${STAY_UP_TITLE}`, exact: true }).click();
  await shop.getByRole('button', { name: 'Yes, ask', exact: true }).click();
  await expect(shop).toHaveCount(0);
  const asked = board.getByRole('region', { name: 'Asked for' });
  // Newest first: a retry also lists the first attempt's request, refunded ("Called off").
  const row = asked.getByRole('listitem').filter({ hasText: STAY_UP_TITLE }).first();
  await expect(row).toContainText('Waiting for a grown-up');
  const id = sql(
    `select id from public.redemption where member_id = '${maya}' and catalog_item_id = '${STAY_UP}'
        and status = 'requested'`,
  );
  expect(
    sql(
      `select requested_by_type || ':' || cost_snapshot from public.redemption where id = '${id}'`,
    ),
  ).toBe('device:25');
  // Waiting, it holds its cost: what she can spend is 25 less, her balance the same.
  await expect(board.locator('.fw-today__spend')).toContainText('25 waiting for a grown-up');

  // Approve, in the admin app.
  await admin.goto('/admin/rewards');
  await admin
    .getByRole('button', { name: `Approve ${STAY_UP_TITLE} for Maya`, exact: true })
    .click();
  await expect(admin.getByRole('status')).toHaveText('Approved. The points are spent.');
  expect(
    sql(`select string_agg(entry_type || ' ' || amount, ',') from public.points_ledger
          where redemption_id = '${id}'`),
  ).toBe('spend -25');

  // The board hears it: a yes, the balance down by the cost, and the spend in her points.
  await expect(row).toContainText('Yes! It’s coming');
  await expect(board.locator('.fw-today__me-head [data-balance]')).toHaveAttribute(
    'data-balance',
    String(before + 5 - 25),
  );
  await expect(board.getByRole('list', { name: 'Points', exact: true })).toContainText(
    STAY_UP_TITLE,
  );
  await expect(board.locator('.fw-today__spend')).toHaveCount(0);
});

test('[RWD-08][US-404] a goal reached is celebrated once, by the board that shows it, and recorded', async () => {
  // Previews run no jobs: the Goals page works the goals out (the check-off above reached the kite;
  // Maya's seeded run reaches the park).
  await admin.goto('/admin/goals');
  expect(
    sql(`select status || ':' || achievement_count from public.reward_goal where id = '${GOAL}'`),
  ).toBe('achieved:1');
  // Each reached goal in turn, each once: the kite, and the park if the seeded run reached it.
  const party = board.getByRole('dialog', { name: /^Maya reached / });
  // The board hears the change through Realtime (normally within seconds); a missed event is read by
  // its next refresh. If it doesn't come, say where it stopped: the goal, and what the board heard.
  try {
    await expect(party).toBeVisible({ timeout: 30_000 });
  } catch (e) {
    const goal = sql(`select status || ' ' || achievement_count || ', ' ||
                             coalesce('celebrated ' || celebrated_at::text, 'not celebrated')
                        from public.reward_goal where id = '${GOAL}'`);
    const link = await board.locator('[data-link]').getAttribute('data-link');
    const heard = await board.locator('[data-events]').getAttribute('data-events');
    const read = await board.locator('main').getAttribute('data-fetched-at');
    // Any board of the household may celebrate first (D-59), so name every one still paired.
    const boards =
      sql(`select coalesce(string_agg(name || ' (' || status || ')', ', ' order by name), 'none')
                          from public.device where household_id = '${DEMO}'`);
    throw new Error(
      `no celebration on the board: the goal is ${goal}; the board is ${link}, heard ${heard} changes, last read at ${read}; the family's boards: ${boards}`,
      { cause: e },
    );
  }
  const seen: string[] = [];
  while (await party.isVisible()) {
    const line = (await party.getByRole('heading').textContent()) ?? '';
    seen.push(line);
    await party.getByRole('button', { name: 'Yay!', exact: true }).click();
    await expect(board.getByRole('dialog', { name: line, exact: true })).toHaveCount(0);
    await board.waitForTimeout(500);
  }
  expect(seen).toContain(`Maya reached ${GOAL_TITLE}!`);
  expect(new Set(seen).size).toBe(seen.length);
  await expect
    .poll(() =>
      sql(`select count(*) from public.reward_goal
            where household_id = '${DEMO}' and status = 'achieved' and celebrated_at is null`),
    )
    .toBe('0');
  // Read again from scratch: nothing left to celebrate.
  await board.reload();
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  await expect(board.getByRole('dialog')).toHaveCount(0);
  await people().getByRole('button', { name: 'Maya', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Goals' })
      .getByRole('listitem')
      .filter({ hasText: GOAL_TITLE }),
  ).toContainText('Reached!');
});
