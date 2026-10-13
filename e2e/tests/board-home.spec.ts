import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [BRD-09][US-1008] The board's home screen on one screen (WP-48, D-74), on the preview, at the
// reference panel's 3840×2160 (1920×1080 CSS px at device scale 2) and in a 13" laptop's browser
// window. The done-when: a paired board shows the rail, the bar, the calendar, today's list and
// every card with no page scroll at both sizes; Month chosen on the board shows the month there and
// changes nothing saved for the board. The idle return to the board's own view is in the UI suite
// (e2e/ui/dashboard.spec.ts), where the clock can run ahead. The board is disconnected at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'One screen e2e';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let board: Page;

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** What a board has saved of its own, and the household's layout. */
const saved = () =>
  sql(`select coalesce(d.board_config::text, '') || ' | ' || coalesce(s.board_layout::text, '')
         from public.device d join public.household_settings s using (household_id)
        where d.household_id = '${DEMO}' and d.name = '${BOARD}'`);

/** Each part of the home screen, where it sits in the window, and how far the page scrolls. */
const parts = (page: Page) =>
  page.evaluate(() => ({
    pageScroll: document.documentElement.scrollHeight - innerHeight,
    outside: [
      '.fw-today__people',
      '.fw-board__bar',
      '.fw-dash__cal',
      '.fw-dash__list',
      ...[...document.querySelectorAll('.fw-dash__card h2')].map(
        (_, i) => `.fw-dash__card:nth-child(${i + 1})`,
      ),
    ].filter((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return !r || r.top < 0 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1;
    }),
  }));

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  const admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  await admin.close();
  board = await (
    await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
  ).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
});

test('[BRD-09][US-1008] done-when: one screen on the 4K panel and a laptop; Month chosen on the board saves nothing', async () => {
  await expect(board.locator('.fw-dash')).toBeVisible();
  expect(await parts(board)).toEqual({ pageScroll: 0, outside: [] });

  // A 13" laptop's browser window: the board zooms down, and still nothing scrolls the page.
  await board.setViewportSize({ width: 1470, height: 830 });
  await expect.poll(() => parts(board)).toEqual({ pageScroll: 0, outside: [] });
  await board.setViewportSize({ width: 1920, height: 1080 });

  const before = saved();
  const span = await board.locator('.fw-dash').getAttribute('data-span');
  const view = board.getByRole('group', { name: 'Calendar view' });
  const started = Date.now();
  await view.getByRole('button', { name: 'Month' }).click();
  await expect(board.locator('.fw-dash')).toHaveAttribute('data-span', 'month');
  await expect(board.locator('.fw-dash__cells [data-today]')).toHaveCount(1);
  report(`WP-48: Month shown on the board ${Date.now() - started} ms after the tap (was ${span})`);
  expect(await parts(board)).toEqual({ pageScroll: 0, outside: [] });
  // The view is the board's own choice for now: nothing saved changes.
  expect(saved()).toBe(before);
});
