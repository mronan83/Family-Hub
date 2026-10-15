import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { sql } from './db';

const DEMO = '0de00000-0000-4000-8000-000000000001';

/**
 * Retires a board a spec paired, once the spec is done with it. Its browser context closes, so it
 * stops listening and sending, and its device is removed, so anything it left queued can't reach the
 * demo family. Files run one after another in one browser, so without this every board stays live
 * for the rest of the run: since WP-20 any of them can take a goal's celebration ("whichever board
 * shows it first"), and any can replay a check-off from its outbox in the middle of another spec.
 */
export async function retireBoard(board: Page | undefined, name: string): Promise<void> {
  await board
    ?.context()
    .close()
    .catch(() => {});
  const db = process.env.SUPABASE_DB_URL;
  if (!db) return;
  sql(
    db,
    `delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${name}';
     delete from public.device where household_id = '${DEMO}' and name = '${name}';`,
  );
}

/**
 * [DEV-01] The pairing code the admin's Boards page shows once "Get a pairing code" was pressed, read
 * when all eight digits are there (a read before the server answers would get an empty code).
 */
export async function pairingCode(admin: Page): Promise<string> {
  const code = admin.getByTestId('pairing-code');
  await expect(code).toHaveText(/\d{4}\D?\d{4}/);
  return ((await code.textContent()) ?? '').replace(/\D/g, '');
}

/**
 * [DEV-01][D-105] A board of the demo family for one spec, as the board specs pair it: any board of
 * this name left by an earlier run removed, Alex signed in on Boards, a pairing code asked for and read
 * once all eight digits are there, and a board in a context of its own paired with it and streaming
 * changes ("Live"). Returns the admin page, still on Boards (close it when it is not needed), and the
 * board. The caller retires the board in afterAll (retireBoard).
 *
 * Measured on the preview: sign-in, a cold Boards page, the pairing code's server action and the pair
 * take 10 to 40 s; the beforeAll that calls this gives it 120 s.
 */
export async function pairBoard(
  browser: Browser,
  name: string,
  {
    admin: adminOptions,
    board: boardOptions,
  }: { admin?: BrowserContextOptions; board?: BrowserContextOptions } = {},
): Promise<{ admin: Page; board: Page }> {
  const db = process.env.SUPABASE_DB_URL!;
  sql(
    db,
    `delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${name}';
     delete from public.device where household_id = '${DEMO}' and name = '${name}';`,
  );
  const admin = await browser.newPage(adminOptions);
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(name);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = await pairingCode(admin);

  const board = await (await browser.newContext(boardOptions)).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  // Changes stream before the specs rely on the board reading again (devices.spec: up to about 20 s
  // after a quiet spell).
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  return { admin, board };
}
