import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '../support/test';
import { pairBoard, retireBoard } from '../support/board';
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

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let board: Page;
/** The household's layout as it was before this spec, put back after it. */
let layout = '';

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
  // Signing in and pairing a board takes 10 to 40 s on a cold preview (pairBoard).
  testInfo.setTimeout(120_000);
  // [D-105] One screen is judged on the household's default layout (the cards a board shows by
  // default), whatever another spec left: set here, put back after.
  layout = sql(
    `select board_layout::text from public.household_settings where household_id = '${DEMO}'`,
  );
  sql(`update public.household_settings set board_layout = '{}' where household_id = '${DEMO}'`);
  const paired = await pairBoard(browser, BOARD, {
    admin: { viewport: { width: 390, height: 844 } },
    board: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
  });
  await paired.admin.close();
  board = paired.board;
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
  if (layout) {
    sql(`update public.household_settings set board_layout = '${layout.replace(/'/g, "''")}'::jsonb
          where household_id = '${DEMO}'`);
  }
});

test('[BRD-09][US-1008] done-when: one screen on the 4K panel and a laptop; Month chosen on the board saves nothing', async () => {
  await expect(board.locator('.fw-dash')).toBeVisible();
  // Retried: the weather, the calendar's read and the fonts may still move things as they land.
  await expect
    .poll(() => parts(board), { message: 'the 4K panel: page scroll, and the parts outside it' })
    .toEqual({ pageScroll: 0, outside: [] });

  // A 13" laptop's browser window: the board zooms down, and still nothing scrolls the page.
  await board.setViewportSize({ width: 1470, height: 830 });
  await expect
    .poll(() => parts(board), { message: 'the laptop: page scroll, and the parts outside it' })
    .toEqual({ pageScroll: 0, outside: [] });
  await board.setViewportSize({ width: 1920, height: 1080 });

  const before = saved();
  const span = await board.locator('.fw-dash').getAttribute('data-span');
  const view = board.getByRole('group', { name: 'Calendar view' });
  const started = Date.now();
  await view.getByRole('button', { name: 'Month' }).click();
  await expect(board.locator('.fw-dash')).toHaveAttribute('data-span', 'month');
  await expect(board.locator('.fw-dash__cells [data-today]')).toHaveCount(1);
  // A month has 4 to 6 rows, by the month the run falls in: said with the result.
  const rows = Math.ceil((await board.locator('.fw-dash__cells > li').count()) / 7);
  report(
    `WP-48: Month (${rows} rows) shown on the board ${Date.now() - started} ms after the tap (was ${span})`,
  );
  await expect
    .poll(() => parts(board), {
      message: `the month (${rows} rows): page scroll, and the parts outside it`,
    })
    .toEqual({ pageScroll: 0, outside: [] });
  // The view is the board's own choice for now: nothing saved changes.
  expect(saved()).toBe(before);
});
