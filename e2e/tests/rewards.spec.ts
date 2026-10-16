import { expect, test, type Page } from '../support/test';
import { addBoardForm, pairingCode, retireBoard } from '../support/board';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';

// [PTS-03][PTS-04] The rewards shop on the preview (WP-18, D-53), as Alex of the demo family with a
// paired board: a reward added with a photo; the board asks for it for Maya (asking twice is one
// request, asking beyond what she has is refused); Alex approves (one spend, which the board's points
// list names) and marks it given; a waiting request cancelled on the board; an approved one cancelled
// and refunded; Leo's seeded request turned down; the photo removed. Two requests at once are tested
// against the database in scripts/redemption-race.sh. Afterwards Leo's seeded request is waiting again;
// Maya's spend on the test reward stays (it was given; the ledger is append-only) and the reward
// stays archived under its own name.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Shop e2e';
const STAY_UP = '0de00000-0000-4000-8000-0000000e0003';
const LEOS_REQUEST = '0de00000-0000-4000-8000-0000000f0001';
// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const sql = (q: string) => query(db!, q);
const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const balance = (member: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${member}'`),
  );
/** What the board lets a child spend: the balance less requests waiting for a parent. */
const available = (member: string) =>
  balance(member) -
  Number(
    sql(`select coalesce(sum(cost_snapshot), 0) from public.redemption
          where member_id = '${member}' and status = 'requested'`),
  );
const status = (id: string) => sql(`select status from public.redemption where id = '${id}'`);
const ledger = (id: string) =>
  sql(`select coalesce(string_agg(entry_type || ' ' || amount, ',' order by created_at), '')
         from public.points_ledger where redemption_id = '${id}'`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
const title = `E2E prize ${Date.now() % 100000}`;
let itemId = '';
let cost = 0;

const ask = (id: string, member: string, item: string) =>
  board.request.post('/api/redemptions', { data: { id, member_id: member, item_id: item } });

test.beforeAll(async ({ browser }) => {
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage();
  await signIn(admin);
  await admin.goto('/admin/devices');
  const form = await addBoardForm(admin);
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = await pairingCode(admin);
  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  // Leo's seeded request waiting again, as the seed left it.
  sql(`update public.redemption set status = 'requested', decided_at = null, decided_by = null, note = null
        where id = '${LEOS_REQUEST}' and status = 'denied'`);
  await retireBoard(board, BOARD);
  await admin?.context().close();
});

test('[PTS-03][PTS-04][US-1103][US-1104][US-1105] a reward with a photo: added, asked for on the board, approved, given; then its photo removed and the reward archived', async () => {
  // One story in four steps: about 12 server round trips (two saves with a photo, three asks, an
  // approve, a board refetch, mark given, remove photo, archive), up to about 40 s; 3x that.
  test.setTimeout(120_000);
  await test.step('a parent adds a reward with a photo; it is in the shop, the photo kept privately', async () => {
    // Maya can afford one, not two.
    const maya = memberId('Maya');
    const can = available(maya);
    expect(
      can,
      `Maya has ${balance(maya)} points, ${can} not held by waiting requests`,
    ).toBeGreaterThan(0);
    cost = Math.floor(can / 2) + 1;
    await admin.goto('/admin/rewards/new');
    const form = admin.getByRole('form', { name: 'Add a reward', exact: true });
    await form.getByLabel('Name', { exact: true }).fill(title);
    await form.getByLabel('Cost in points', { exact: true }).fill(String(cost));
    await form.getByLabel('Photo (optional)').setInputFiles({
      name: 'prize.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await form.getByRole('button', { name: 'Add reward', exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText(`Saved ${title}.`);
    await expect(admin.getByRole('list', { name: 'The shop', exact: true })).toContainText(title);

    const row = sql(`select id || ' ' || image_path from public.reward_catalog_item
                    where household_id = '${DEMO}' and title = '${title}'`);
    const [id, path] = row.split(' ') as [string, string];
    itemId = id;
    expect(path).toMatch(new RegExp(`^${DEMO}/${itemId}/[0-9a-f-]+\\.png$`));
    expect(
      sql(`select count(*) from storage.objects where bucket_id = 'rewards' and name = '${path}'`),
    ).toBe('1');

    await admin.getByRole('link', { name: `Edit ${title}`, exact: true }).click();
    const photo = admin.getByRole('img', { name: `Photo of ${title}` });
    await expect(photo).toBeVisible();
    const src = await photo.getAttribute('src');
    const res = await admin.request.get(src!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  await test.step('the board asks for it for Maya: once, however often sent; not beyond what she has', async () => {
    const maya = memberId('Maya');
    const id = crypto.randomUUID();
    let res = await ask(id, maya, itemId);
    expect(res.status()).toBe(200);
    expect((await res.json()).redemption).toMatchObject({
      status: 'requested',
      cost,
      duplicate: false,
    });
    res = await ask(id, maya, itemId);
    expect((await res.json()).redemption).toMatchObject({ status: 'requested', duplicate: true });
    res = await ask(crypto.randomUUID(), maya, itemId);
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_enough_points' });
    expect(
      sql(
        `select requested_by_type || ':' || cost_snapshot from public.redemption where id = '${id}'`,
      ),
    ).toBe(`device:${cost}`);
    expect((await board.request.post('/api/redemptions', { form: { id } })).status()).toBe(415);
  });

  await test.step('a parent approves: the points are spent once, the board says on what; then it is given', async () => {
    const maya = memberId('Maya');
    const before = balance(maya);
    const id = sql(
      `select id from public.redemption where catalog_item_id = '${itemId}' and status = 'requested'`,
    );
    await admin.goto('/admin/rewards');
    await expect(admin.getByRole('list', { name: 'Asked for', exact: true })).toContainText(
      `Maya: ${title}`,
    );
    await admin.getByRole('button', { name: `Approve ${title} for Maya`, exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText('Approved. The points are spent.');
    expect(status(id)).toBe('approved');
    expect(ledger(id)).toBe(`spend -${cost}`);
    expect(balance(maya)).toBe(before - cost);

    await board
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: 'Maya', exact: true })
      .click();
    await expect(board.getByRole('list', { name: 'Points', exact: true })).toContainText(title);

    await admin.getByRole('button', { name: `Mark ${title} given to Maya`, exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText('Marked as given.');
    expect(status(id)).toBe('fulfilled');
  });

  await test.step('the photo can be removed, and the reward archived', async () => {
    const path = sql(`select image_path from public.reward_catalog_item where id = '${itemId}'`);
    await admin.goto(`/admin/rewards/${itemId}`);
    await admin.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText(
      'The photo is removed; the icon shows instead.',
    );
    expect(
      sql(
        `select coalesce(image_path, 'none') from public.reward_catalog_item where id = '${itemId}'`,
      ),
    ).toBe('none');
    expect(
      sql(`select count(*) from storage.objects where bucket_id = 'rewards' and name = '${path}'`),
    ).toBe('0');
    await admin.getByRole('button', { name: `Archive ${title}`, exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText('Archived. It’s out of the shop.');
    await expect(admin.getByRole('list', { name: 'The shop', exact: true })).not.toContainText(
      title,
    );
  });
});

test('[PTS-04][US-1104] a waiting request cancelled on the board spends nothing; an approved one cancelled is refunded', async () => {
  const leo = memberId('Leo');
  const price = Number(
    sql(`select cost_points from public.reward_catalog_item where id = '${STAY_UP}'`),
  );
  expect(
    available(leo),
    `Leo needs ${price} points not held by waiting requests (balance ${balance(leo)})`,
  ).toBeGreaterThanOrEqual(price);
  const waiting = crypto.randomUUID();
  expect((await ask(waiting, leo, STAY_UP)).status()).toBe(200);
  const res = await board.request.post('/api/redemptions/cancel', { data: { id: waiting } });
  expect(res.status()).toBe(200);
  expect(status(waiting)).toBe('cancelled');
  expect(ledger(waiting)).toBe('');

  const approved = crypto.randomUUID();
  expect((await ask(approved, leo, STAY_UP)).status()).toBe(200);
  await admin.goto('/admin/rewards');
  // This request's own buttons: another Stay up request of Leo's would have buttons of the same name.
  await admin
    .getByRole('button', { name: 'Approve Stay up 30 minutes late for Leo', exact: true })
    .and(admin.locator(`[value="approve:${approved}"]`))
    .click();
  await expect(admin.getByRole('status')).toHaveText('Approved. The points are spent.');
  // The board can't cancel it once approved.
  expect(
    (await board.request.post('/api/redemptions/cancel', { data: { id: approved } })).status(),
  ).toBe(403);
  await admin
    .getByRole('button', { name: 'Cancel Stay up 30 minutes late for Leo and refund', exact: true })
    .and(admin.locator(`[value="cancel:${approved}"]`))
    .click();
  await expect(admin.getByRole('status')).toHaveText('Cancelled. Any points spent on it are back.');
  expect(ledger(approved)).toBe(`spend -${price},refund ${price}`);
});

test('[US-1105] Leo’s seeded request turned down: nothing spent', async () => {
  expect(status(LEOS_REQUEST), 'Leo’s seeded request, before it is turned down').toBe('requested');
  await admin.goto('/admin/rewards');
  await admin
    .getByRole('button', { name: 'Not this time: Pick the dinner for Leo', exact: true })
    .click();
  await expect(admin.getByRole('status')).toHaveText('Not this time. Nothing was spent.');
  expect(status(LEOS_REQUEST)).toBe('denied');
  expect(ledger(LEOS_REQUEST)).toBe('');
});
