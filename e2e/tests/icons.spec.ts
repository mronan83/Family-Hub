import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [CHR-01][CHR-10][ACC-04] The larger icon set and the sixteen colors on the preview (WP-46, D-70).
// The done-when: on a phone, Alex finds the fish icon by searching, saves a chore for Leo with it, and
// the paired board shows the chore with that icon. Alex adds a tag in Navy with a Lucide icon, and
// gives Leo initials in the new Magenta, which the board's avatar takes. Everything is put back at
// the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Icons e2e';
const CHORE = 'Feed the fish';
const TAG = 'Aquarium';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
let leo = { color: 'member-4', avatar: 'frog' };

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

/** Takes away what a run of this spec made; history it gathered stays, archived (D-46). */
function tidy() {
  sql(`delete from public.chore c where c.household_id = '${DEMO}' and c.title = '${CHORE}'
          and not exists (select from public.chore_occurrence o
                            join public.chore_completion_event e on e.occurrence_id = o.id
                           where o.chore_id = c.id);
       update public.chore set archived_at = now(), title = title || ' (old)'
        where household_id = '${DEMO}' and title = '${CHORE}';
       delete from public.chore_tag ct using public.tag t
        where ct.tag_id = t.id and t.household_id = '${DEMO}' and t.name = '${TAG}';
       delete from public.tag where household_id = '${DEMO}' and name = '${TAG}';`);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  tidy();
  const [color, avatar] = sql(
    `select color || '|' || coalesce(avatar_key, '') from public.member
      where household_id = '${DEMO}' and display_name = 'Leo'`,
  ).split('|');
  leo = { color: color!, avatar: avatar! };
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
  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  tidy();
  sql(
    `update public.member set color = '${leo.color}', avatar_key = nullif('${leo.avatar}', '')
      where household_id = '${DEMO}' and display_name = 'Leo'`,
  );
  await retireBoard(board, BOARD);
});

test('[CHR-01][D-70] done-when: a chore saved with an icon found by search shows on the board with it', async () => {
  await admin.goto('/admin/chores');
  await admin.getByRole('link', { name: 'Add a chore' }).click();
  const form = admin.getByRole('form', { name: 'Add an item' });
  await form.getByLabel('Name', { exact: true }).fill(CHORE);
  await form.getByRole('checkbox', { name: 'Leo', exact: true }).check();
  await form.getByRole('searchbox', { name: 'Find an icon' }).fill('fish');
  await form
    .locator('label', { has: admin.getByRole('radio', { name: 'fish', exact: true }) })
    .click();
  await expect(form.getByRole('group', { name: 'Icon', exact: true })).toContainText(
    'Chosen: fish',
  );
  const saved = Date.now();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(`Saved ${CHORE}.`);
  expect(
    sql(`select icon from public.chore where household_id = '${DEMO}' and title = '${CHORE}'`),
  ).toBe('fish');

  const row = board.locator('.fw-dash__row').filter({ hasText: CHORE });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.locator('svg[data-icon="fish"]')).toBeVisible();
  report(`WP-46: a chore with a Lucide icon reached the board in ${Date.now() - saved} ms`);
});

test('[CHR-10][D-70] a tag takes a new color and a Lucide icon', async () => {
  await admin.goto('/admin/tags');
  const form = admin.getByRole('form', { name: 'Add a tag' });
  await form.getByLabel('Name', { exact: true }).fill(TAG);
  await form
    .locator('label', { has: admin.getByRole('radio', { name: 'Navy', exact: true }) })
    .click();
  const icons = form.getByRole('group', { name: 'Icon (optional)' });
  await icons
    .getByRole('group', { name: 'Icon groups' })
    .getByRole('button', { name: 'Pets and garden' })
    .click();
  await icons
    .locator('label', { has: admin.getByRole('radio', { name: 'turtle', exact: true }) })
    .click();
  await form.getByRole('button', { name: 'Add tag', exact: true }).click();
  await expect(admin.getByText(TAG, { exact: true }).first()).toBeVisible();
  expect(
    sql(
      `select color || ':' || icon from public.tag where household_id = '${DEMO}' and name = '${TAG}'`,
    ),
  ).toBe('member-11:turtle');
});

test('[ACC-04][D-70] a member takes one of the new colors, and the board shows it', async () => {
  await admin.goto('/admin/members');
  await admin.getByRole('link', { name: 'Edit Leo', exact: true }).click();
  await admin
    .locator('label', { has: admin.getByRole('radio', { name: 'Initials', exact: true }) })
    .click();
  await admin
    .locator('label', { has: admin.getByRole('radio', { name: 'Magenta', exact: true }) })
    .click();
  await admin.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect
    .poll(() =>
      sql(`select color || ':' || coalesce(avatar_key, 'initials') from public.member
            where household_id = '${DEMO}' and display_name = 'Leo'`),
    )
    .toBe('member-14:initials');
  // Leo's button in the board's people bar now carries "L" on Magenta.
  const avatar = board
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: /Leo/ })
    .locator('.fw-avatar--initials');
  await expect(avatar).toHaveText('L', { timeout: 10_000 });
  expect(await avatar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(162, 28, 175)',
  );
});
