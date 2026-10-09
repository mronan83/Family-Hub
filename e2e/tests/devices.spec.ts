import { execFileSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';

// [DEV-01][DEV-02][DEV-03][DEV-05] Pairing a board on the preview (WP-05, SPIKE-01, D-40): Alex gets
// a code, a second browser pairs with it, reads the demo family, hears changes live, signs itself
// in again after its session is lost, and stops reading the moment Alex disconnects it.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Kitchen e2e';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

async function alexOnBoards(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
  await page.goto('/admin/devices');
  await expect(page.getByRole('heading', { name: 'Boards', level: 1, exact: true })).toBeVisible();
  return page;
}

async function newCode(admin: Page): Promise<string> {
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  expect(code).toMatch(/^\d{8}$/);
  return code;
}

async function pair(board: Page, code: string) {
  await board.goto('/board');
  await expect(board).toHaveURL(/\/board\/pair/);
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let code = '';
let admin: Page;
let board: Page;

test.beforeAll(async ({ browser }) => {
  // A retry starts with no demo boards and the seeded member name (their sign-ins go at the next
  // demo family reset).
  sql(`update public.member set display_name = 'Maya' where household_id = '${DEMO}' and display_name like 'Maya%';
       delete from public.device_pairing where household_id = '${DEMO}';
       delete from public.device where household_id = '${DEMO}';`);
  admin = await alexOnBoards(browser);
  board = await (await browser.newContext()).newPage();
});

test.afterAll(() => {
  sql(
    `update public.member set display_name = 'Maya' where household_id = '${DEMO}' and display_name like 'Maya%';`,
  );
});

test('[DEV-01] an admin gets an 8-digit code for a named board', async () => {
  code = await newCode(admin);
  expect(
    sql(`select device_name || ':' || (expires_at - created_at)::text from public.device_pairing
          where household_id = '${DEMO}' and consumed_at is null order by created_at desc limit 1`),
  ).toBe(`${BOARD}:00:10:00`);
});

test('[DEV-01][DEV-02] a second browser pairs with the code and reads the family', async () => {
  await pair(board, code);
  await expect(board).toHaveURL(/\/board$/);
  await expect(
    board.getByRole('heading', { name: 'Demo family', level: 1, exact: true }),
  ).toBeVisible();
  const family = board.getByRole('list', { name: 'Family', exact: true });
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) await expect(family).toContainText(name);
  expect(
    sql(`select d.status || ':' || (u.raw_app_meta_data ->> 'role') || ':' || (d.last_seen_at is not null)
           from public.device d join auth.users u on u.id = d.auth_user_id
          where d.household_id = '${DEMO}' and d.name = '${BOARD}'`),
  ).toBe('active:device:true');
});

test('[DEV-05] a change in the household reaches the board live (Realtime under RLS)', async () => {
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 15_000 });
  sql(
    `update public.member set display_name = 'Maya R' where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  // Generous for the first change after a quiet spell, while Realtime starts its replication;
  // WP-06 measures the steady-state budget (DEV-05, p95 under 3 s).
  await expect(board.getByRole('list', { name: 'Family', exact: true })).toContainText('Maya R', {
    timeout: 15_000,
  });
});

test('[DEV-02] a board whose session is lost signs itself in again', async () => {
  await board.context().clearCookies({ name: /^sb-/ });
  await board.goto('/board');
  await expect(board).toHaveURL(/\/board$/);
  await expect(
    board.getByRole('heading', { name: 'Demo family', level: 1, exact: true }),
  ).toBeVisible();
});

test('[DEV-01] a used code is refused', async ({ browser }) => {
  const other = await (await browser.newContext()).newPage();
  await pair(other, code);
  await expect(other.getByRole('status')).toContainText('That code didn’t match.');
  await other.context().close();
});

test('[DEV-02] a board cannot open the admin app', async () => {
  // Sent with the board's cookies, without navigating its page away from the board.
  const res = await board.context().request.get('/admin', { maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test('[DEV-03] the admin sees the board, renames it and disconnects it; the board loses access at once', async () => {
  await admin.reload();
  const boards = admin.getByRole('list', { name: 'Paired boards', exact: true });
  await expect(boards).toContainText(BOARD);
  await expect(boards).toContainText('Last seen');

  await admin.getByRole('button', { name: `Disconnect ${BOARD}`, exact: true }).click();
  await expect(admin.getByRole('list', { name: 'Disconnected boards', exact: true })).toContainText(
    BOARD,
  );

  // Realtime stops: a change made now never reaches the disconnected board (RLS, SPIKE-01).
  await expect(board).toHaveURL(/\/board$/);
  const live = board.getByRole('status');
  await expect(live).toHaveText('Live');
  const heard = await live.getAttribute('data-events');
  sql(
    `update public.member set display_name = 'Maya Q' where household_id = '${DEMO}' and display_name = 'Maya R'`,
  );
  await board.waitForTimeout(6_000);
  await expect(live).toHaveAttribute('data-events', heard ?? '0');
  await expect(board.getByRole('list', { name: 'Family', exact: true })).not.toContainText(
    'Maya Q',
  );

  // Its next load is refused, and it cannot sign itself in again.
  await board.goto('/board');
  await expect(board).toHaveURL(/\/board\/pair\?disconnected=1$/);
  await expect(board.getByRole('status')).toContainText('This board was disconnected.');
  expect(
    sql(`select d.status || ':' || (u.banned_until = 'infinity')
           from public.device d join auth.users u on u.id = d.auth_user_id
          where d.household_id = '${DEMO}' and d.name = '${BOARD}'`),
  ).toBe('revoked:true');
  expect(
    sql(`select string_agg(a.actor_type || ':' || a.action, ',' order by a.id) from public.audit_log a
          where a.household_id = '${DEMO}' and a.entity_type = 'device'`),
  ).toBe('system:insert,admin:update');
});
