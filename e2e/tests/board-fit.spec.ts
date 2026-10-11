import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [BRD-08][US-1007] A board's text size on the preview (WP-47, D-73), at the reference panel's
// 3840×2160 (the board-4k project: 1920×1080 CSS px at device scale 2, where the board's fit is 1).
// The done-when: Alex sets a paired board to Larger on Boards; without a reload the board zooms to
// 1.15 and puts the list under the calendar, and after a reload it is still Larger. Standard puts it
// back. The board is disconnected at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Text size e2e';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

const zoom = (page: Page) =>
  page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('.board')!).getPropertyValue('--fw-zoom')),
  );

async function setTextSize(label: string) {
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: `Text size for ${BOARD}`, exact: true });
  await form.getByLabel(`Text size for ${BOARD}`, { exact: true }).selectOption({ label });
  await form.getByRole('button', { name: 'Set text size', exact: true }).click();
  await admin.waitForURL(/\/admin\/devices$/);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  // The reference panel, named here rather than left to the project's defaults.
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

test('[BRD-08][US-1007] done-when: Larger on Boards zooms the board at once, and it stays Larger', async () => {
  // The panel's 1920×1080 CSS px are the canvas itself: Standard is 1, the list beside the calendar.
  expect(await zoom(board)).toBe(1);
  await expect(board.locator('html')).toHaveAttribute('data-text-size', 'standard');

  const saved = Date.now();
  await setTextSize('Larger text');
  expect(
    sql(`select board_config ->> 'text_size' from public.device
          where household_id = '${DEMO}' and name = '${BOARD}'`),
  ).toBe('larger');
  await expect.poll(() => zoom(board), { timeout: 10_000 }).toBe(1.15);
  report(`WP-47: Larger reached the board in ${Date.now() - saved} ms`);
  const [cal, list] = await Promise.all([
    board.locator('.fw-dash__cal').boundingBox(),
    board.locator('.fw-dash__list').boundingBox(),
  ]);
  expect(list!.y).toBeGreaterThanOrEqual(cal!.y + cal!.height);
  expect(await board.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);

  await board.reload();
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  expect(await zoom(board)).toBe(1.15);
  await expect(board.locator('html')).toHaveAttribute('data-text-size', 'larger');
});

test('[BRD-08] Standard puts the board back', async () => {
  await setTextSize('Standard text');
  await expect.poll(() => zoom(board), { timeout: 10_000 }).toBe(1);
  const [cal, list] = await Promise.all([
    board.locator('.fw-dash__cal').boundingBox(),
    board.locator('.fw-dash__list').boundingBox(),
  ]);
  expect(list!.x).toBeGreaterThanOrEqual(cal!.x + cal!.width);
});
