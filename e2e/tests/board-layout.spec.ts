import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [BRD-01][BRD-05][US-1004] The board's home screen on the preview (WP-35, D-66, D-67). A board paired
// here opens on the family dashboard: the calendar (five days unless set), today's list, then the
// cards. The done-when: Alex moves a card on Boards, and the board shows the new order within 3
// seconds, 10 times in 11. Alex then gives this board its own layout (the month, without Goals); the household's
// stays as it was. The household's layout and the board are put back at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Layout e2e';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;

/** A line for the run's report: the e2e workflow prints it to the log and the run summary. */
function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** The household's layout as the seed left it: none saved, so the defaults. */
const putBack = () =>
  sql(`update public.household_settings set board_layout = '{}' where household_id = '${DEMO}'`);

const cards = () => board.locator('.fw-dash__cards > section h2');
const everyBoard = () =>
  admin.getByRole('form', { name: 'Home screen for every board', exact: true });

/** The board's home screen, opened again if something left it elsewhere. */
async function home() {
  const button = board
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Home', exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(board.locator('.fw-dash')).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  putBack();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  // Changes stream before the done-when times one (see devices.spec: up to about 20 seconds after a
  // quiet spell).
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  putBack();
  await retireBoard(board, BOARD);
});

test('[BRD-01][BRD-05][D-66] a new board opens on the dashboard: five days, today’s list, then the cards', async () => {
  await home();
  await expect(board.locator('.fw-dash')).toHaveAttribute('data-span', '5');
  await expect(board.locator('.fw-dash__day')).toHaveCount(5);
  await expect(board.getByRole('heading', { name: 'Today’s list', level: 2 })).toBeVisible();
  // Meals stay hidden until there are meals (WP-25).
  await expect(cards()).toHaveText(['Goals', 'Waiting for a parent', 'Coming up']);
});

test('[BRD-05][US-1004] the done-when: Alex moves a card on Boards, and the board shows the new order within 3 seconds (p90 of 11)', async () => {
  // One sample judged a typical-latency budget on its own, and a moment's Realtime delay on the
  // shared database failed it (3.2 s once, while DEV-05 saw 4.7 s in the same run). Measured like
  // DEV-05 instead: Coming up moves up, down, up … eleven times, and 10 of the 11 must be in time.
  test.setTimeout(180_000);
  await home();
  const ORDERS = ['Goals|Coming up|Waiting for a parent', 'Goals|Waiting for a parent|Coming up'];
  const samples: number[] = [];
  for (let i = 0; i < 11; i++) {
    await admin.goto('/admin/devices');
    const up = i % 2 === 0;
    const move = everyBoard().getByRole('button', {
      name: `Move Coming up ${up ? 'up' : 'down'}`,
      exact: true,
    });
    await expect(move).toBeEnabled();
    // Timed in the board's own page, checked every 50 ms, from the moment the button is pressed. A
    // sample that never shows counts as 15 s, and measuring goes on, so a slow run still reports.
    const pressed = Date.now();
    const [ms] = await Promise.all([
      board
        .waitForFunction(
          (want) =>
            [...document.querySelectorAll('.fw-dash__cards > section h2')]
              .map((h) => h.textContent?.trim())
              .join('|') === want && Date.now(),
          ORDERS[i % 2],
          { polling: 50, timeout: 15_000 },
        )
        .then(
          async (handle) => ((await handle.jsonValue()) as number) - pressed,
          () => 15_000,
        ),
      move.click(),
    ]);
    samples.push(ms);
    // Saved, said beside the form it came from, before the next move.
    await expect(admin.locator('#layout-household').getByRole('status')).toHaveText(
      'Saved the home screen for every board. It shows the change in a moment.',
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1]!;
  report(
    `BRD-05 layout change reached the board: p50 ${sorted[5]} ms, p90 ${p90} ms, max ${sorted[10]} ms (budget 3000 ms); samples ${samples.join(', ')}`,
  );
  expect(p90).toBeLessThanOrEqual(3_000);
  // An odd number of moves leaves Coming up a place higher than the seed had it.
  await expect(cards()).toHaveText(['Goals', 'Coming up', 'Waiting for a parent']);
  expect(
    sql(
      `select board_layout -> 'cards' -> 2 ->> 'id' from public.household_settings where household_id = '${DEMO}'`,
    ),
  ).toBe('coming');
});

test('[BRD-05][D-67] a board with its own layout: the month and no Goals here; every other board keeps the household’s', async () => {
  await admin.goto('/admin/devices');
  const details = admin.locator('details', {
    has: admin.getByText(`Home screen on ${BOARD}: the household’s layout`),
  });
  await details.locator('summary').click();
  const own = details.getByRole('form', { name: `Layout for ${BOARD}`, exact: true });
  await own.getByLabel(`Give ${BOARD} its own layout`).check();
  await own.getByRole('button', { name: 'Save', exact: true }).click();
  // It starts as a copy of the household's, opened where it was saved.
  const mine = admin.getByRole('form', { name: `Home screen on ${BOARD}`, exact: true });
  await expect(mine).toBeVisible();
  await mine.getByRole('radio', { name: 'Month', exact: true }).check();
  await mine.getByRole('checkbox', { name: /^Goals/ }).uncheck();
  await mine.getByRole('button', { name: 'Save layout', exact: true }).click();
  const id = sql(
    `select id from public.device where household_id = '${DEMO}' and name = '${BOARD}' and status = 'active'`,
  );
  await expect(admin.locator(`#layout-${id}`).getByRole('status')).toHaveText(
    `Saved the home screen for ${BOARD}. It shows the change in a moment.`,
  );

  await home();
  await expect(board.locator('.fw-dash')).toHaveAttribute('data-span', 'month');
  await expect(cards()).toHaveText(['Coming up', 'Waiting for a parent']);
  expect(
    sql(`select board_config -> 'layout' ->> 'calendar' from public.device
          where household_id = '${DEMO}' and name = '${BOARD}'`),
  ).toBe('month');
  // The household's is as the last test left it.
  expect(
    sql(
      `select board_layout ->> 'calendar' from public.household_settings where household_id = '${DEMO}'`,
    ),
  ).toBe('5');

  // Save again with "its own layout" still ticked: the board keeps the layout it has, rather than
  // starting again from the household's (found while writing the user guide).
  await admin
    .locator(`#layout-${id}`)
    .getByRole('form', { name: `Layout for ${BOARD}`, exact: true })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(admin.locator(`#layout-${id}`).getByRole('status')).toBeVisible();
  expect(
    sql(`select board_config -> 'layout' ->> 'calendar' from public.device
          where household_id = '${DEMO}' and name = '${BOARD}'`),
  ).toBe('month');
  await expect(board.locator('.fw-dash')).toHaveAttribute('data-span', 'month');
});
