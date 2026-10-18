import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { boardFold, pairBoard, retireBoard } from '../support/board';
import { sql as query } from '../support/db';
import { ownHousehold } from '../support/household';

// [BRD-08][US-1007] A board's text size on the preview (WP-47, D-73), at the reference panel's
// 3840×2160 (the board-4k project: 1920×1080 CSS px at device scale 2, where the board's fit is 1).
// The done-when: Alex sets a paired board to Larger on Boards; without a reload the board zooms to
// 1.15 and puts the list under the calendar, and after a reload it is still Larger. Standard puts it
// back. The board is disconnected at the end. [DEV-09][D-118] (WP-91) Boards opens with every board folded;
// the board's header says its text size, and it is open again after the save.
const family = ownHousehold('board-fit');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const BOARD = 'Text size e2e';
const sql = (q: string) => query(db!, q);

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

const savedSize = () =>
  sql(`select coalesce(board_config ->> 'text_size', 'standard') from public.device
        where household_id = '${HOUSEHOLD}' and name = '${BOARD}'`);

/**
 * Chooses a text size on Boards, and waits until it is saved (the page is already on Boards).
 * [DEV-09][D-118][D-120] (WP-91) The board is folded at first, its header saying its text size; opened, the
 * size is under Display; after the save the board is open again, its header saying the new size.
 */
async function setTextSize(label: string, value: string) {
  // A fresh load, so no earlier save is still settling on the admin page.
  await admin.goto('/admin/devices');
  const folds = admin.getByRole('list', { name: 'Paired boards', exact: true }).locator('details');
  await expect(folds.first()).toBeVisible();
  // Every board folded at first (a board's Disconnect is its own small disclosure, closed too).
  expect(await folds.evaluateAll((ds) => ds.filter((d) => d.hasAttribute('open')).length)).toBe(0);
  const fold = await boardFold(admin, BOARD);
  const form = fold.getByRole('form', { name: `Text size for ${BOARD}`, exact: true });
  await form.getByLabel(`Text size for ${BOARD}`, { exact: true }).selectOption({ label });
  await form.getByRole('button', { name: 'Set text size', exact: true }).click();
  await expect.poll(savedSize, { message: `${BOARD}'s text size saved` }).toBe(value);
  // The save sends Boards back with this board named, so its fold opens on the new page.
  await expect(admin).toHaveURL(/[?&]board=/);
  await expect(fold, `${BOARD} open again after the save`).toHaveAttribute('open', '');
  await expect(fold.locator(':scope > summary')).toContainText(` · ${label} · `);
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board takes 10 to 40 s on a cold preview (pairBoard).
  testInfo.setTimeout(120_000);
  // Alex on a phone; the board is the reference panel, named here rather than left to the project's
  // defaults.
  ({ admin, board } = await pairBoard(browser, BOARD, {
    admin: { viewport: { width: 390, height: 844 } },
    board: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
  }));
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
});

// One story: Larger, kept over a reload, then Standard again.
test('[BRD-08][US-1007] done-when: Larger on Boards zooms the board at once, and it stays Larger; Standard puts it back', async () => {
  // Two saves on a fresh Boards page, a reload and the board's Live again: 15 to 50 s; 3× the slow end.
  test.setTimeout(150_000);
  await test.step('[BRD-08][US-1007] Larger zooms the board at once, and it stays Larger', async () => {
    // The panel's 1920×1080 CSS px are the canvas itself: Standard is 1, the list beside the calendar.
    await expect.poll(() => zoom(board), { message: 'the board’s zoom at Standard' }).toBe(1);
    await expect(board.locator('html')).toHaveAttribute('data-text-size', 'standard');

    await setTextSize('Larger text', 'larger');
    // From the database having the save (setTextSize waited for it) to the board's new size.
    const saved = Date.now();
    await expect.poll(() => zoom(board), { message: 'the board’s zoom at Larger' }).toBe(1.15);
    report(`WP-47: Larger reached the board ${Date.now() - saved} ms after it was saved`);
    const [cal, list] = await Promise.all([
      board.locator('.fw-dash__cal').boundingBox(),
      board.locator('.fw-dash__list').boundingBox(),
    ]);
    expect(list!.y).toBeGreaterThanOrEqual(cal!.y + cal!.height);
    expect(await board.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);

    await board.reload();
    await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
    await expect
      .poll(() => zoom(board), { message: 'the board’s zoom at Larger after a reload' })
      .toBe(1.15);
    await expect(board.locator('html')).toHaveAttribute('data-text-size', 'larger');
  });

  await test.step('[BRD-08] Standard puts the board back', async () => {
    await setTextSize('Standard text', 'standard');
    await expect.poll(() => zoom(board), { message: 'the board’s zoom at Standard again' }).toBe(1);
    const [cal, list] = await Promise.all([
      board.locator('.fw-dash__cal').boundingBox(),
      board.locator('.fw-dash__list').boundingBox(),
    ]);
    expect(list!.x).toBeGreaterThanOrEqual(cal!.x + cal!.width);
  });
});
