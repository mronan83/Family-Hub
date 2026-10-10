import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';

// [BRD-01][BRD-03][BRD-07][CHR-04][NFR-03][US-305] The board's Today on the preview (WP-11, D-50): a
// board paired to the demo family shows everyone's day, checks items off by click and by touch, counts
// a rapid double tap once and moves the balance once, undoes with a second tap, asks who did a shared
// item, and shows a check-off made elsewhere live. Everything it checks off it puts back, so the specs
// after it find today as the seed left it. The database is read with psql to confirm what was posted.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Hall e2e';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const BRUSH_TEETH = '0de00000-0000-4000-8000-0000000c0002';
const FEED_THE_DOG = '0de00000-0000-4000-8000-0000000c0003';
const TODAY = `(now() at time zone 'America/New_York')::date`;

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
/** Today's occurrence of a chore: a person's own (D-47), or the shared one. */
const todayOf = (chore: string, member?: string) =>
  sql(`select id from public.chore_occurrence
        where chore_id = '${chore}' and due_date = ${TODAY}
          and ${member ? `member_id = '${member}'` : 'member_id is null'}`);
const held = (occurrence: string, member: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger
          where occurrence_id = '${occurrence}' and member_id = '${member}'`),
  );
const earns = (occurrence: string, member: string) =>
  Number(
    sql(`select count(*) from public.points_ledger
          where occurrence_id = '${occurrence}' and member_id = '${member}' and entry_type = 'earn'`),
  );
/** This board's events on an occurrence, oldest first: "complete,undo". */
const boardEvents = (occurrence: string) =>
  sql(`select coalesce(string_agg(e.event_type, ',' order by e.recorded_at, e.occurred_at), '')
         from public.chore_completion_event e
        where e.occurrence_id = '${occurrence}' and e.actor_type = 'device'
          and e.actor_id = (select id from public.device where household_id = '${DEMO}' and name = '${BOARD}')`);
const status = (occurrence: string) =>
  sql(`select status from public.chore_occurrence where id = '${occurrence}'`);

/** Today's items this spec checks off, put back as the seed left them (a parent's uncheck). */
function putBack() {
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       select gen_random_uuid(), o.id, 'admin_uncomplete', now()
         from public.chore_occurrence o
        where o.household_id = '${DEMO}' and o.due_date = ${TODAY} and o.status <> 'scheduled'
          and o.chore_id in ('${MAKE_BED}', '${BRUSH_TEETH}', '${FEED_THE_DOG}')`);
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let board: Page;
const people = () => board.getByRole('list', { name: 'Family', exact: true });
const everyone = () => board.getByRole('region', { name: 'Everyone today' });
const column = (name: string) =>
  everyone().locator('section', { has: board.getByRole('heading', { name, level: 2 }) });
const tile = (scope: Locator, title: string) =>
  scope.locator('li.fw-today__tile', { has: board.getByRole('heading', { name: title }) });
const chip = (scope: Locator) => scope.locator('[data-balance]').first();
const chipValue = async (scope: Locator) => Number(await chip(scope).getAttribute('data-balance'));
/** Waits for the board to read the snapshot again (after Realtime hears its own change). */
async function nextRead(fetchedAt: string | null) {
  await expect(board.locator('main')).not.toHaveAttribute('data-fetched-at', fetchedAt ?? '');
}
const fetchedAt = () => board.locator('main').getAttribute('data-fetched-at');

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  // A retry starts from today as the seed left it, with no board of this name.
  putBack();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  const admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  expect(code).toMatch(/^\d{8}$/);
  await admin.close();

  // A touch panel that also takes clicks, like the kitchen board.
  board = await (await browser.newContext({ hasTouch: true })).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  // Changes stream before the tests rely on the board reading again (see devices.spec: up to about
  // 20 seconds after a quiet spell).
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  putBack();
  await retireBoard(board, BOARD);
});

test("[BRD-01][BRD-07] the board opens on everyone's day: a column each, today's items by part of day", async () => {
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) {
    await expect(everyone().getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  const maya = column('Maya');
  await expect(maya.getByRole('heading', { level: 3 }).first()).toHaveText('Morning');
  await expect(maya.getByRole('heading', { name: 'Evening', level: 3 })).toBeVisible();
  for (const title of ['Make bed', 'Brush teeth', 'Feed the dog']) {
    await expect(
      maya.getByRole('button', { name: `Check off ${title}`, exact: true }),
    ).toBeVisible();
  }
  // Leo makes his own bed (D-47); the dog is Maya's and Alex's, not his.
  await expect(tile(column('Leo'), 'Make bed')).toBeVisible();
  await expect(tile(column('Leo'), 'Feed the dog')).toHaveCount(0);
  await expect(tile(column('Alex'), 'Feed the dog')).toBeVisible();
  // [PTS-02] Each child's balance is the database's.
  expect(await chipValue(maya)).toBe(
    Number(
      sql(
        `select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${memberId('Maya')}'`,
      ),
    ),
  );
});

test('[CHR-04][PTS-01] a click checks off Maya’s own Make bed: Done! at once, one event from this board, 5 points once', async () => {
  await people().getByRole('button', { name: 'Maya', exact: true }).click();
  const me = board.getByRole('region', { name: 'Maya', exact: true });
  await expect(me.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
  const maya = memberId('Maya');
  const bed = todayOf(MAKE_BED, maya);
  const before = await chipValue(me);
  const read = await fetchedAt();

  await me.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
  await expect(tile(me, 'Make bed')).toContainText('Done!', { timeout: 1_000 });
  await expect(chip(me)).toHaveAttribute('data-balance', String(before + 5), { timeout: 1_000 });

  await expect.poll(() => boardEvents(bed)).toBe('complete');
  expect(status(bed)).toBe('completed');
  expect(held(bed, maya)).toBe(5);
  // The board reads again when Realtime brings its own change back; the balance stays where it is.
  await nextRead(read);
  await expect(chip(me)).toHaveAttribute('data-balance', String(before + 5));
  await expect(tile(me, 'Make bed')).toContainText('Done!');
});

test('[CHR-04][NFR-03] a rapid double tap by touch is one check-off, and the balance moves once', async () => {
  const me = board.getByRole('region', { name: 'Maya', exact: true });
  const maya = memberId('Maya');
  const teeth = todayOf(BRUSH_TEETH, maya);
  const before = await chipValue(me);
  const earnedBefore = earns(teeth, maya);
  const read = await fetchedAt();

  const box = (await me
    .getByRole('button', { name: 'Check off Brush teeth', exact: true })
    .boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await board.touchscreen.tap(x, y);
  await board.touchscreen.tap(x, y);
  await expect(tile(me, 'Brush teeth')).toContainText('Done!', { timeout: 1_000 });

  await expect.poll(() => boardEvents(teeth)).toBe('complete');
  await nextRead(read);
  // Given time to arrive, still one event, one earn, and the balance moved by 2 once.
  await board.waitForTimeout(2_000);
  expect(boardEvents(teeth)).toBe('complete');
  expect(earns(teeth, maya)).toBe(earnedBefore + 1);
  expect(held(teeth, maya)).toBe(2);
  await expect(chip(me)).toHaveAttribute('data-balance', String(before + 2));
});

test('[US-305][PTS-01] undo needs a second tap, then puts each back and gives its points back', async () => {
  const me = board.getByRole('region', { name: 'Maya', exact: true });
  const maya = memberId('Maya');
  const before = await chipValue(me);
  for (const [chore, title] of [
    [MAKE_BED, 'Make bed'],
    [BRUSH_TEETH, 'Brush teeth'],
  ] as const) {
    const occurrence = todayOf(chore, maya);
    await me.getByRole('button', { name: `Undo ${title}`, exact: true }).click();
    // One tap only arms it: nothing is sent.
    await expect(
      me.getByRole('button', { name: `Tap again to undo ${title}`, exact: true }),
    ).toBeVisible();
    expect(boardEvents(occurrence)).toBe('complete');
    await me.getByRole('button', { name: `Tap again to undo ${title}`, exact: true }).click();
    await expect(me.getByRole('button', { name: `Check off ${title}`, exact: true })).toBeVisible({
      timeout: 1_000,
    });
    await expect.poll(() => boardEvents(occurrence)).toBe('complete,undo');
    expect(status(occurrence)).toBe('scheduled');
    expect(held(occurrence, maya)).toBe(0);
  }
  await expect(chip(me)).toHaveAttribute('data-balance', String(before - 7));
});

test('[BRD-07][US-1006][CHR-09] who did it: the shared Feed the dog asks; Maya and Alex are both credited, only Maya earns', async () => {
  await people().getByRole('button', { name: 'Everyone', exact: true }).click();
  const [maya, alex] = [memberId('Maya'), memberId('Alex')];
  const dog = todayOf(FEED_THE_DOG);
  await column('Alex').getByRole('button', { name: 'Check off Feed the dog', exact: true }).click();
  const picker = board.getByRole('dialog', { name: 'Who did Feed the dog?' });
  // The item's people first, the column's person already picked.
  await expect(picker.getByRole('button').first()).toHaveText(/Maya|Alex/);
  await expect(picker.getByRole('button', { name: 'Alex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'Maya', exact: true }).click();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(tile(column('Maya'), 'Feed the dog')).toContainText(
    /Done! · by (Maya and Alex|Alex and Maya)/,
    { timeout: 1_000 },
  );

  await expect.poll(() => boardEvents(dog)).toBe('complete');
  expect(
    sql(`select array_to_string(done_by, ',') from public.chore_occurrence where id = '${dog}'`),
  ).toBe([maya, alex].sort().join(','));
  expect(held(dog, maya)).toBe(5);
  expect(held(dog, alex)).toBe(0);
  const { violations } = await new AxeBuilder({ page: board })
    .withRules(['color-contrast'])
    .analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );

  // Put it back from Alex's column.
  const alexColumn = column('Alex');
  await alexColumn.getByRole('button', { name: 'Undo Feed the dog', exact: true }).click();
  await alexColumn
    .getByRole('button', { name: 'Tap again to undo Feed the dog', exact: true })
    .click();
  await expect.poll(() => status(dog)).toBe('scheduled');
  expect(held(dog, maya)).toBe(0);
});

test('[DEV-05][BRD-01] a check-off made elsewhere reaches the board live, with its points', async () => {
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  const leo = memberId('Leo');
  const bed = todayOf(MAKE_BED, leo);
  const leoColumn = column('Leo');
  const before = await chipValue(leoColumn);
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${bed}', 'complete', array['${leo}'::uuid], now())`);
  await expect(tile(leoColumn, 'Make bed')).toContainText('Done!');
  await expect(chip(leoColumn)).toHaveAttribute('data-balance', String(before + 5));
  putBack();
  await expect(
    leoColumn.getByRole('button', { name: 'Check off Make bed', exact: true }),
  ).toBeVisible();
  await expect(chip(leoColumn)).toHaveAttribute('data-balance', String(before));
});
