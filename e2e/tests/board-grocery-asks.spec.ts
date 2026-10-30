import { expect, test, type Page } from '../support/test';
import { pairBoard, retireBoard } from '../support/board';
import { sql as query } from '../support/db';
import { ownHousehold } from '../support/household';

// [MEAL-22][MEAL-30][US-717][US-723] The board's Groceries on the preview (WP-107, D-149), at the
// reference panel's 1920×1080, with a board the spec pairs to its own made-up household (D-137). The
// done-when: Maya asks for a thing at the board, typed on its keyboard; it waits; Alex adds it on
// Groceries and it is on the list as "Maya asked". Then Sam ticks a thing off at the board, and takes
// another off and puts it back with Undo; the admin app's Got recently says Sam got it at that board.
// Every thing has a name of its own; what the spec added or asked is taken away again.
const family = ownHousehold('board-grocery-asks');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const BOARD = 'Asks e2e';
const sql = (q: string) => query(db!, q);
// Letters only: the board's keyboard has no digits.
const SUFFIX = Array.from(
  { length: 6 },
  () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');
const names = { ask: `Kiwi ${SUFFIX}`, tick: `Quince ${SUFFIX}`, off: `Leek ${SUFFIX}` };

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
const people = () => board.getByRole('list', { name: 'Family', exact: true });
const screen = () => board.getByRole('region', { name: /^Groceries/ });
const bar = () => screen().locator('.fw-bgroc__bar');
const status = (name: string) =>
  sql(`select status from public.grocery_item where household_id = '${HOUSEHOLD}' and name = '${name}'
        order by created_at desc limit 1`);

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board takes 10 to 40 s on a cold preview (pairBoard).
  testInfo.setTimeout(120_000);
  // Two things on the list for Sam, added by Alex as the admin app would (an "added" reason).
  for (const n of [names.tick, names.off]) {
    sql(`with i as (
           insert into public.grocery_item (household_id, list_id, name, name_key, category_id)
           select '${HOUSEHOLD}', l.id, '${n}', lower('${n}'),
                  (select c.id from public.grocery_category c where c.household_id = '${HOUSEHOLD}' and c.is_other)
             from public.grocery_list l where l.household_id = '${HOUSEHOLD}'
           returning id)
         insert into public.grocery_item_reason (household_id, item_id, kind)
         select '${HOUSEHOLD}', id, 'added' from i`);
  }
  ({ admin, board } = await pairBoard(browser, BOARD, { board: { hasTouch: true } }));
});

test.afterAll(async () => {
  sql(`delete from public.grocery_ask where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}';
       update public.grocery_item set status = 'removed', removed_at = now(), ticked_at = null
        where household_id = '${HOUSEHOLD}' and name like '%${SUFFIX}'`);
  await retireBoard(board, BOARD);
});

async function openGroceries() {
  await people()
    .getByRole('button', { name: /^Groceries/ })
    .click();
  await expect(screen()).toBeVisible();
}

test('[MEAL-22-j][US-717] Maya asks at the board; it waits; Alex adds it; it is on the list as hers', async () => {
  await test.step('Maya types it on the board’s keyboard and asks', async () => {
    await openGroceries();
    await screen().getByRole('button', { name: 'Ask for something' }).click();
    const dialog = board.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Maya', exact: true }).click();
    await dialog.getByRole('button', { name: /Something else/ }).click();
    const keys = dialog.getByRole('group', { name: 'Keyboard' });
    for (const ch of names.ask.toUpperCase()) {
      await keys.getByRole('button', { name: ch === ' ' ? 'space' : ch, exact: true }).click();
    }
    await expect(dialog.locator('.fw-bgroc__field')).toHaveText(names.ask);
    await dialog.getByRole('button', { name: 'Ask for it' }).click();
    await expect(bar()).toHaveText(`Asked for ${names.ask}, Maya. A grown-up will say OK.`);
    await expect(
      screen()
        .getByRole('region', { name: 'Asked for' })
        .getByRole('listitem')
        .filter({ hasText: names.ask }),
    ).toContainText('Waiting for a grown-up');
    expect(status(names.ask)).toBe('');
  });

  await test.step('Alex adds it on Groceries', async () => {
    await admin.goto('/admin/groceries');
    const asked = admin.locator('#asked');
    await expect(asked).toContainText(names.ask);
    await asked.getByRole('button', { name: `Add ${names.ask} to the list` }).click();
    await expect(admin.getByText('Added 1 ask to the list.')).toBeVisible();
    const row = admin
      .getByRole('region', { name: 'On the list' })
      .getByRole('listitem')
      .filter({ hasText: names.ask });
    await expect(row).toContainText('Maya asked');
    expect(status(names.ask)).toBe('open');
  });

  await test.step('the board says it is on the list', async () => {
    // [D-110] The board reads again once Realtime says so: up to about 20 s after a quiet spell
    // (devices.spec), so 3× that.
    await expect(
      screen()
        .getByRole('region', { name: 'Asked for' })
        .getByRole('listitem')
        .filter({ hasText: names.ask }),
    ).toContainText('On the list', { timeout: 60_000 });
  });
});

test('[MEAL-30-e][US-723] Sam ticks a thing off, takes another off and puts it back; Got recently says so', async () => {
  await openGroceries();
  await test.step('Got it, as Sam', async () => {
    await screen()
      .getByRole('button', { name: new RegExp(`^${names.tick}: got it`) })
      .click();
    const dialog = board.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Sam', exact: true }).click();
    await dialog.getByRole('button', { name: 'Got it' }).click();
    await expect(bar()).toHaveText(`Got ${names.tick}.`);
    await expect.poll(() => status(names.tick)).toBe('ticked');
    await expect(screen().getByRole('region', { name: 'Got today' })).toContainText(names.tick);
  });

  await test.step('take it off, then Undo', async () => {
    // Sam's face is still picked.
    await screen()
      .getByRole('button', { name: new RegExp(`^${names.off}: got it`) })
      .click();
    const dialog = board.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Sam', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Take it off the list' }).click();
    await expect(bar()).toContainText(`Took ${names.off} off the list.`);
    await expect.poll(() => status(names.off)).toBe('removed');
    await bar().getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => status(names.off)).toBe('open');
    await expect(
      screen().getByRole('button', { name: new RegExp(`^${names.off}: got it`) }),
    ).toBeVisible();
  });

  await test.step('Got recently says Sam got it at the board', async () => {
    await admin.goto('/admin/groceries?open=got');
    await expect(
      admin
        .getByRole('list', { name: 'Got recently' })
        .getByRole('listitem')
        .filter({ hasText: names.tick }),
    ).toContainText(`by Sam at the ${BOARD} board`);
  });
});
