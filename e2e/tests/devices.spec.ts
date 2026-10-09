import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

// [DEV-01][DEV-02][DEV-03][DEV-05] A board on the preview (WP-05, WP-06, SPIKE-01, D-40): Alex gets
// a code, a second browser pairs with it and reads the demo family, admin changes reach it within
// the 3-second budget, it catches up after the network drops, follows the theme Alex sets, signs
// itself in again after its session is lost, and stops reading the moment Alex disconnects it.
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

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Nearest-rank percentile. */
function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]!;
}

/** A line for the DEV-05 latency report: the e2e workflow prints it to the log and the run summary. */
function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
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

// The seeded names, put back before a retry and after the run.
const RESET_NAMES = `update public.member set display_name = 'Maya' where household_id = '${DEMO}' and display_name like 'Maya%';
     update public.member set display_name = 'Leo' where household_id = '${DEMO}' and display_name like 'Leo%';`;

test.beforeAll(async ({ browser }) => {
  // A retry starts with no demo boards and the seeded member names (their sign-ins go at the next
  // demo family reset).
  sql(`${RESET_NAMES}
       delete from public.device_pairing where household_id = '${DEMO}';
       delete from public.device where household_id = '${DEMO}';`);
  admin = await alexOnBoards(browser);
  board = await (await browser.newContext()).newPage();
});

test.afterAll(() => {
  sql(RESET_NAMES);
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
  // Live means changes stream: the board waits for the server to confirm the subscription, which
  // can take up to about 20 seconds after a quiet spell.
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  sql(
    `update public.member set display_name = 'Maya R' where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  // The budget is measured in the next test (DEV-05, p95 under 3 s).
  await expect(board.getByRole('list', { name: 'Family', exact: true })).toContainText('Maya R', {
    timeout: 15_000,
  });
});

test('[DEV-05] a rename in the admin app reaches the board within 3 seconds (p95 of 20)', async () => {
  // Steady state: the board is live and Realtime has already delivered a change (the test above).
  test.setTimeout(300_000);
  const leo = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Leo'`,
  );
  const live = board.getByRole('status');
  const samples: number[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = `Leo ${i}`;
    const opened = Date.now();
    await admin.goto(`/admin/members/${leo}`);
    const form = admin.getByRole('form', { name: 'Edit member', exact: true });
    // The field's name includes its help text, so match by substring (as members.spec does).
    await form.getByLabel('Name').fill(name);
    const heard = await live.getAttribute('data-events');
    const saved = Date.now();
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    // Timed in the board's own page, checked every 50 ms, from the moment Save is pressed. A
    // sample that never shows counts as 15 s, and measuring goes on, so a slow run still reports.
    const shown = await board
      .waitForFunction(
        (want) =>
          [...document.querySelectorAll('[aria-label="Family"] .fw-board-members__name')].some(
            (el) => el.textContent === want,
          ) && Date.now(),
        name,
        { polling: 50, timeout: 15_000 },
      )
      .then(
        async (handle) => ((await handle.jsonValue()) as number) - saved,
        () => 15_000,
      );
    samples.push(shown);
    await admin.waitForURL(/\/admin\/members\?saved=/);
    report(
      `[DEV-05] #${i}: board ${shown} ms (admin page ${saved - opened} ms, save ${Date.now() - saved} ms, changes heard ${heard} → ${await live.getAttribute('data-events')})`,
    );
  }
  const p95 = percentile(samples, 95);
  const summary = `p50 ${percentile(samples, 50)} ms, p95 ${p95} ms, max ${Math.max(...samples)} ms; samples ${samples.join(', ')}`;
  test.info().annotations.push({ type: 'DEV-05 latency', description: summary });
  report(`[DEV-05] admin rename to board: ${summary}`);
  expect(p95).toBeLessThan(3_000);
});

test('[DEV-05] after the network drops and comes back, the board catches up on its own', async () => {
  const status = board.getByRole('status');
  await board.context().setOffline(true);
  await expect(status).toHaveText('Reconnecting…');
  sql(
    `update public.member set display_name = 'Leo again' where household_id = '${DEMO}' and display_name like 'Leo%'`,
  );
  await board.context().setOffline(false);
  await expect(board.getByRole('list', { name: 'Family', exact: true })).toContainText(
    'Leo again',
    { timeout: 15_000 },
  );
  await expect(status).toHaveText('Live', { timeout: 30_000 });
});

test('[DEV-05] an admin holds the board on Evening or Day; it switches at once and stays legible', async () => {
  const html = board.locator('html');
  for (const [label, theme] of [
    ['Always Evening', 'evening'],
    ['Always Day', 'day'],
  ] as const) {
    // A fresh load each time, so no earlier save is still settling on the admin page.
    await admin.goto('/admin/devices');
    const form = admin.getByRole('form', { name: `Theme for ${BOARD}`, exact: true });
    await form.getByLabel(`Theme for ${BOARD}`, { exact: true }).selectOption({ label });
    await form.getByRole('button', { name: 'Set theme', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', theme, { timeout: 5_000 });
    await expectContrastOk(board);
  }
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: `Theme for ${BOARD}`, exact: true });
  await form
    .getByLabel(`Theme for ${BOARD}`, { exact: true })
    .selectOption({ label: 'Automatic, by time of day' });
  await form.getByRole('button', { name: 'Set theme', exact: true }).click();
  await expect
    .poll(() =>
      sql(`select coalesce(board_config ->> 'theme', 'auto') from public.device
            where household_id = '${DEMO}' and name = '${BOARD}'`),
    )
    .toBe('auto');
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
  await admin.goto('/admin/devices');
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
    sql(`select string_agg(a.actor_type || ':' || a.action || ':' ||
                           coalesce(a.diff -> 'status' ->> 'to', a.diff -> 'board_config' -> 'to' ->> 'theme', a.diff ->> 'status'),
                           ',' order by a.id)
           from public.audit_log a
          where a.household_id = '${DEMO}' and a.entity_type = 'device'
            -- Only the board paired in this run: a retry pairs a new one, and earlier rows stay.
            and a.entity_id = (select id from public.device where household_id = '${DEMO}' and name = '${BOARD}')`),
  ).toBe(
    'system:insert:active,admin:update:evening,admin:update:day,admin:update:auto,admin:update:revoked',
  );
});
