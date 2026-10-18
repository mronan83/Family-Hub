import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '../support/test';
import { addBoardForm, pairingCode, retireBoard } from '../support/board';
import { sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';
import { signIn } from '../support/session';
import { ENGINE_VERSION } from '../../packages/rules-engine/src/index';
import { ownHousehold } from '../support/household';

// [RWD-11][RWD-12][US-408] Streak history and Insights on the preview (WP-17, D-55), as Alex of the
// demo family. The first two tests read a child this file adds, with a last week of its own, so no
// other spec's check-offs or unchecks on the seed's children can change what is expected. The week is
// the seed's week for Leo, written the same way (supabase/seed.sql), hand-computed: bed, teeth and the
// table every day, except teeth 5 days ago and the bed yesterday (missed), and the table 2 days ago
// (skipped):
//   7 6 days ago good, 5 bad, 4 3 2 good, yesterday bad
//   runs: good 2, bad 1, good 3, bad 1 (going); 18 of the 20 routines that counted were done.
// Opening Insights builds the child's history (new occurrences mark it), a rebuild leaves every row
// identical, and a board shows Maya's flame from her stored run.
const family = ownHousehold('insights');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const ALEX_SIGN_IN = family.own('0de00000-0000-4000-8000-0000000000a1');
const BOARD = 'Flame e2e';
const sql = (q: string) => query(db!, q);

// The child and their three routines: ids made here, so afterAll removes exactly these.
const SUFFIX = Math.random().toString(36).slice(2, 8);
const KID = randomUUID();
const KID_NAME = `Insights ${SUFFIX}`;
const BED = { id: randomUUID(), title: `Make bed ${SUFFIX}` };
const TEETH = { id: randomUUID(), title: `Brush teeth ${SUFFIX}` };
const TABLE = { id: randomUUID(), title: `Set the table ${SUFFIX}` };
const CHORES = `array['${BED.id}', '${TEETH.id}', '${TABLE.id}']::uuid[]`;

const memberId = (name: string) =>
  sql(
    `select id from public.member where household_id = '${HOUSEHOLD}' and display_name = '${name}'`,
  );
/** A member's stored history, as text that changes if any row does. */
const rows = (member: string) =>
  sql(`select md5(coalesce(string_agg(x, ',' order by x), '')) from (
         select to_jsonb(s)::text as x from public.member_daily_summary s where s.member_id = '${member}'
         union all
         select to_jsonb(r)::text from public.streak_segment r where r.member_id = '${member}') y`);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** The demo family's today, read once for the file ([D-110]). */
let TODAY = '';

/**
 * The child's last week, as the seed writes Leo's: occurrences for the 7 days before today, each
 * check-off recorded 5 minutes after its due time, then the past days closed (what is not done is
 * missed). Approval is off on these routines, so a check-off counts as done at once.
 */
function addChildWithLastWeek() {
  sql(`insert into public.member (id, household_id, display_name, role, color, earns_rewards)
       values ('${KID}', '${HOUSEHOLD}', '${KID_NAME}', 'child', 'member-6', false);
       insert into public.chore (id, household_id, title, icon, kind, points, approval, schedule, due_time,
                                 created_by, start_date, assignment)
       values ('${BED.id}', '${HOUSEHOLD}', '${BED.title}', 'chore-bed', 'chore', 0, 'none',
               '{"freq": "daily"}', '07:30', '${ALEX_SIGN_IN}', '${addDays(TODAY, -7)}', 'shared'),
              ('${TEETH.id}', '${HOUSEHOLD}', '${TEETH.title}', 'chore-teeth', 'chore', 0, 'none',
               '{"freq": "daily"}', '07:45', '${ALEX_SIGN_IN}', '${addDays(TODAY, -7)}', 'shared'),
              ('${TABLE.id}', '${HOUSEHOLD}', '${TABLE.title}', 'chore-table', 'chore', 0, 'none',
               '{"freq": "daily"}', '17:30', '${ALEX_SIGN_IN}', '${addDays(TODAY, -7)}', 'shared');
       insert into public.chore_assignee (household_id, chore_id, member_id)
       select '${HOUSEHOLD}', c, '${KID}' from unnest(${CHORES}) c;
       do $$
       declare
         v_today constant date := '${TODAY}';
         o record;
         k integer;
       begin
         perform private.generate_occurrences('${HOUSEHOLD}', v_today - 7, v_today - 1, ${CHORES});
         for o in select id, chore_id, due_date, due_time from public.chore_occurrence
                   where chore_id = any (${CHORES}) and due_date < v_today loop
           k := v_today - o.due_date;
           continue when (o.chore_id = '${BED.id}' and k = 1) or (o.chore_id = '${TEETH.id}' and k = 5);
           insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
           values (gen_random_uuid(), o.id,
                   case when o.chore_id = '${TABLE.id}' and k = 2 then 'skip' else 'complete' end,
                   case when o.chore_id = '${TABLE.id}' and k = 2 then '{}'::uuid[] else array['${KID}'::uuid] end,
                   ((o.due_date + o.due_time)::timestamp at time zone 'America/New_York') + interval '5 minutes');
         end loop;
         perform private.close_past_due('${HOUSEHOLD}');
       end $$;`);
}

/**
 * Removes the child, with their history, and every occurrence of their routines that has no
 * check-off. Check-offs are append-only, so the routines that hold one are archived instead.
 */
function removeChild() {
  sql(`delete from public.chore_occurrence o
        where o.chore_id = any (${CHORES})
          and not exists (select from public.chore_completion_event e where e.occurrence_id = o.id);
       update public.chore set archived_at = now() where id = any (${CHORES}) and archived_at is null;
       delete from public.member where id = '${KID}';`);
}

test.beforeAll(async ({ browser }) => {
  TODAY = householdToday(db!);
  addChildWithLastWeek();
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  await admin?.close();
  removeChild();
});

test('[RWD-11][RWD-12][US-408][NFR-14-h] a child’s last week, as hand-computed', async () => {
  await admin.goto(`/admin/insights?member=${KID}&days=7`);
  await expect(admin.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  const streaks = admin.getByRole('region', { name: 'Streaks' });
  await expect(streaks).toContainText('Good run now0 days (bad streak of 1 day)');
  await expect(streaks).toContainText('Best good run3 days');
  await expect(streaks).toContainText('Longest bad streak1 day');
  await expect(admin.getByRole('region', { name: 'Done' })).toContainText(
    '90% 18 of 20 routines that counted',
  );
  const heat = admin.getByRole('table', { name: 'Day by day' });
  await expect(heat.locator('td[data-class="good"]')).toHaveCount(5);
  await expect(heat.locator('td[data-class="bad"]')).toHaveCount(2);
  const missed = admin.getByRole('list', { name: 'Missed most' });
  await expect(missed.getByRole('listitem')).toHaveText([
    `${TEETH.title}missed once`,
    `${BED.title}missed once`,
  ]);
  const checking = admin.getByRole('region', { name: 'Checking' });
  await expect(checking).toContainText('Check-offs18');
  await expect(checking).toContainText('Unchecked by a parent0');

  // What opening the page stored: a row a day and the runs, the last still going; the mark cleared.
  expect(
    sql(`select count(*) || ':' || count(*) filter (where day_class = 'good') || ':' ||
                count(*) filter (where day_class = 'bad')
           from public.member_daily_summary where member_id = '${KID}'`),
  ).toBe('7:5:2');
  expect(
    sql(`select string_agg(kind || length_days || case when end_date is null then '+' else '' end, ','
                           order by start_date)
           from public.streak_segment where member_id = '${KID}'`),
  ).toBe('good2,bad1,good3,bad1+');
  expect(
    sql(`select count(*) from public.member_daily_summary
          where member_id = '${KID}' and engine_version <> ${ENGINE_VERSION}`),
  ).toBe('0');
});

test('[RWD-11][US-408] a rebuild from history leaves every row identical', async () => {
  // The page first, so the history it builds when behind is what the rebuild is compared with.
  await admin.goto(`/admin/insights?member=${KID}&days=7`);
  await expect(admin.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  const before = rows(KID);
  await admin.getByRole('button', { name: 'Rebuild from history', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('History rebuilt from every check-off.');
  expect(rows(KID)).toBe(before);
});

test('[RWD-05] a board shows Maya’s run from her stored history', async ({ browser }) => {
  const maya = memberId('Maya');
  // Opening her insights builds her history.
  await admin.goto(`/admin/insights?member=${maya}&days=7`);
  await expect(admin.getByRole('region', { name: 'Streaks' })).toBeVisible();
  const run = sql(`select coalesce(max(case when kind = 'good' then length_days end), 0)
                     from public.streak_segment where member_id = '${maya}' and end_date is null`);

  sql(`delete from public.device_pairing where household_id = '${HOUSEHOLD}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${HOUSEHOLD}' and name = '${BOARD}';`);
  let board: Page | undefined;
  try {
    await admin.goto('/admin/devices');
    const form = await addBoardForm(admin);
    await form.getByLabel('Board name', { exact: true }).fill(BOARD);
    await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
    const code = await pairingCode(admin);
    board = await (await browser.newContext()).newPage();
    await board.goto('/board');
    await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
    await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
    await expect(board).toHaveURL(/\/board$/);
    // Each person's flame heads their column on Chores (D-66).
    await board
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: 'Chores', exact: true })
      .click();
    const flame = board
      .getByRole('region', { name: 'Everyone today' })
      .locator('section', { has: board.getByRole('heading', { name: 'Maya', level: 2 }) })
      .locator('.fw-today__flame');
    // Today isn't done yet (the board specs put back what they tick), so the flame is her stored run
    // (none when she has no good run going).
    const waiting = Number(
      sql(`select count(*) from public.chore_occurrence
            where member_id = '${maya}' and kind = 'chore' and status = 'scheduled'
              and due_date = '${TODAY}'`),
    );
    expect(waiting, `Maya's routines still to do on ${TODAY}`).toBeGreaterThan(0);
    if (run === '0') await expect(flame).toHaveCount(0);
    else await expect(flame).toHaveText(`${run} ${run === '1' ? 'day' : 'days'} in a row`);
  } finally {
    await retireBoard(board, BOARD);
  }
});
