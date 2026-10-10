import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

// [RWD-11][RWD-12][US-408] Streak history and Insights on the preview (WP-17, D-55), as Alex of the
// demo family. The seed's last week for Leo (supabase/seed.sql), hand-computed: his bed, teeth and
// the table every day, except teeth 5 days ago and his bed yesterday (missed), and the table 2 days
// ago (skipped):
//   7 6 days ago good, 5 bad, 4 3 2 good, yesterday bad
//   runs: good 2, bad 1, good 3, bad 1 (going); 18 of the 20 routines that counted were done.
// Opening Insights builds his history (the seed marked it), a rebuild leaves every row identical,
// and a board shows Maya's flame from her stored run.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Flame e2e';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}
const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
/** A member's stored history, as text that changes if any row does. */
const rows = (member: string) =>
  sql(`select md5(coalesce(string_agg(x, ',' order by x), '')) from (
         select to_jsonb(s)::text as x from public.member_daily_summary s where s.member_id = '${member}'
         union all
         select to_jsonb(r)::text from public.streak_segment r where r.member_id = '${member}') y`);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
});

test('[RWD-11][RWD-12][US-408] Leo’s last week, as hand-computed from the seed', async () => {
  const leo = memberId('Leo');
  await admin.goto(`/admin/insights?member=${leo}&days=7`);
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
    'Brush teethmissed once',
    'Make bedmissed once',
  ]);
  const checking = admin.getByRole('region', { name: 'Checking' });
  await expect(checking).toContainText('Check-offs18');
  await expect(checking).toContainText('Unchecked by a parent0');

  // What opening the page stored: a row a day and the runs, the last still going; his mark cleared.
  expect(
    sql(`select count(*) || ':' || count(*) filter (where day_class = 'good') || ':' ||
                count(*) filter (where day_class = 'bad')
           from public.member_daily_summary where member_id = '${leo}'`),
  ).toBe('7:5:2');
  expect(
    sql(`select string_agg(kind || length_days || case when end_date is null then '+' else '' end, ','
                           order by start_date)
           from public.streak_segment where member_id = '${leo}'`),
  ).toBe('good2,bad1,good3,bad1+');
  expect(
    sql(`select count(*) from public.member_daily_summary
          where member_id = '${leo}' and engine_version <> 1`),
  ).toBe('0');
});

test('[RWD-11][US-408] a rebuild from history leaves every row identical', async () => {
  const leo = memberId('Leo');
  const before = rows(leo);
  await admin.goto(`/admin/insights?member=${leo}&days=7`);
  await admin.getByRole('button', { name: 'Rebuild from history', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('History rebuilt from every check-off.');
  expect(rows(leo)).toBe(before);
});

test('[RWD-05] a board shows Maya’s run from her stored history', async ({ browser }) => {
  const maya = memberId('Maya');
  // Opening her insights builds her history.
  await admin.goto(`/admin/insights?member=${maya}&days=7`);
  await expect(admin.getByRole('region', { name: 'Streaks' })).toBeVisible();
  const run = sql(`select coalesce(max(case when kind = 'good' then length_days end), 0)
                     from public.streak_segment where member_id = '${maya}' and end_date is null`);

  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  const board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  const flame = board
    .getByRole('region', { name: 'Everyone today' })
    .locator('section', { has: board.getByRole('heading', { name: 'Maya', level: 2 }) })
    .locator('.fw-today__flame');
  // Today isn't done yet, so the flame is her stored run (none when she has no good run going).
  if (run === '0') await expect(flame).toHaveCount(0);
  else await expect(flame).toHaveText(`${run} ${run === '1' ? 'day' : 'days'} in a row`);
  await board.context().close();
});
