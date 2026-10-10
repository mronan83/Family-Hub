import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';

// [CHR-05][CHR-06][CHR-08][CHR-14] A parent's day on the preview (WP-12, D-52), as Alex of the demo
// family: "Not actually done" on four of five check-offs is one batch, the board shows them open again
// and exactly four reversals post, and Undo puts them back; late credit and skipping; the approval
// switch and queue; My tasks with quick add, which reaches the board. Everything it changes it puts
// back, so the specs after it find today as the seed left it. The database is read with psql.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Den e2e';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const BRUSH_TEETH = '0de00000-0000-4000-8000-0000000c0002';
const FEED_THE_DOG = '0de00000-0000-4000-8000-0000000c0003';
const SET_THE_TABLE = '0de00000-0000-4000-8000-0000000c0004';
const TODAY = `(now() at time zone 'America/New_York')::date`;

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const occ = (chore: string, member: string | null, day = TODAY) =>
  sql(`select id from public.chore_occurrence where chore_id = '${chore}' and due_date = ${day}
         and ${member ? `member_id = '${member}'` : 'member_id is null'}`);
const status = (id: string) => sql(`select status from public.chore_occurrence where id = '${id}'`);
/** As the database itself (the seed's way): a child's check-off, or a parent's uncheck. */
const systemEvent = (id: string, type: string, doneBy: string[] = []) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${id}', '${type}', array[${doneBy.map((d) => `'${d}'`).join(',')}]::uuid[], now())`);

const ITEMS = `('${MAKE_BED}', '${BRUSH_TEETH}', '${FEED_THE_DOG}', '${SET_THE_TABLE}')`;

/**
 * Today's and tomorrow's items this spec touches, put back as the seed left them, approval off:
 * open again, then each one's approval flag as the switch now has it (one that waited for a parent
 * keeps its flag when the switch goes off, D-22, so a failed run can't leave the next spec's
 * check-offs waiting).
 */
function putBack() {
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       select gen_random_uuid(), o.id, 'admin_uncomplete', now()
         from public.chore_occurrence o
        where o.household_id = '${DEMO}' and o.due_date between ${TODAY} and ${TODAY} + 1
          and o.status <> 'scheduled' and o.chore_id in ${ITEMS};
       update public.household_settings set approval_mode = 'off' where household_id = '${DEMO}';
       update public.chore_occurrence o set requires_approval_snapshot = private.chore_requires_approval(o.chore_id)
        where o.household_id = '${DEMO}' and o.due_date between ${TODAY} and ${TODAY} + 1
          and o.chore_id in ${ITEMS}
          and o.requires_approval_snapshot is distinct from private.chore_requires_approval(o.chore_id);
       update public.chore set archived_at = now()
        where household_id = '${DEMO}' and title like 'Pick up the dry cleaning e2e%' and archived_at is null;`);
}

async function asAlex(page: Page, path: string) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
  await page.goto(path);
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
let started = '';

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  putBack();
  started = sql(`select now()`);
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage();
  await asAlex(admin, '/admin/devices');
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
  putBack();
  await retireBoard(board, BOARD);
});

const everyone = () => board.getByRole('region', { name: 'Everyone today' });
const column = (name: string) =>
  everyone().locator('section', { has: board.getByRole('heading', { name, level: 2 }) });
/** The board's Chores screen (a column each), opened again if the board went back to Home (90 s
 * untouched, D-66). */
async function chores() {
  if (await everyone().isVisible()) return;
  await board
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Chores', exact: true })
    .click();
  await expect(everyone()).toBeVisible();
}

test('[CHR-08][PTS-01] four of five check-offs unchecked in one action: one batch, open again on the board, four reversals; Undo puts them back', async () => {
  const [maya, leo] = [memberId('Maya'), memberId('Leo')];
  const four = [
    occ(MAKE_BED, maya),
    occ(MAKE_BED, leo),
    occ(BRUSH_TEETH, maya),
    occ(BRUSH_TEETH, leo),
  ];
  const table = occ(SET_THE_TABLE, null);
  // The children check off five items.
  systemEvent(four[0]!, 'complete', [maya]);
  systemEvent(four[1]!, 'complete', [leo]);
  systemEvent(four[2]!, 'complete', [maya]);
  systemEvent(four[3]!, 'complete', [leo]);
  systemEvent(table, 'complete', [leo]);
  await chores();
  await expect(
    column('Leo').getByRole('listitem').filter({ hasText: 'Set the table' }),
  ).toContainText('Done!');

  await admin.goto('/admin/today');
  const day = admin.getByRole('region', { name: 'Today' });
  for (const name of [
    'Select Make bed (Maya)',
    'Select Make bed (Leo)',
    'Select Brush teeth (Maya)',
    'Select Brush teeth (Leo)',
  ]) {
    await day.getByRole('checkbox', { name, exact: true }).check();
  }
  await day.getByRole('button', { name: 'Not actually done', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText(
    'Unchecked 4 items. Their points are taken back.',
  );

  const ids = four.map((id) => `'${id}'`).join(',');
  expect(
    sql(`select count(*) || ':' || count(distinct batch_id) || ':' || min(actor_type)
           from public.chore_completion_event
          where occurrence_id in (${ids}) and event_type = 'admin_uncomplete' and recorded_at >= '${started}'`),
  ).toBe('4:1:admin');
  expect(four.map(status)).toEqual(['scheduled', 'scheduled', 'scheduled', 'scheduled']);
  expect(status(table)).toBe('completed');
  expect(
    sql(`select count(*) from public.points_ledger
          where occurrence_id in (${ids}, '${table}') and entry_type = 'reversal' and created_at >= '${started}'`),
  ).toBe('4');
  // The child sees them open again, with nothing telling them off.
  await chores();
  for (const [name, title] of [
    ['Maya', 'Make bed'],
    ['Maya', 'Brush teeth'],
    ['Leo', 'Make bed'],
    ['Leo', 'Brush teeth'],
  ] as const) {
    await expect(
      column(name).getByRole('button', { name: `Check off ${title}`, exact: true }),
    ).toBeVisible();
  }

  await admin.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Put back 4 items, with their points.');
  expect(four.map(status)).toEqual(['approved', 'approved', 'approved', 'approved']);
  expect(
    sql(`select count(*) from public.points_ledger
          where occurrence_id in (${ids}) and entry_type = 'earn' and created_at >= '${started}'`),
  ).toBe('8');
});

test('[CHR-06] late credit for yesterday, then unchecked again; a day ahead skipped and put back', async () => {
  const leo = memberId('Leo');
  // The seed's Leo missed his bed yesterday.
  const yesterday = occ(MAKE_BED, leo, `${TODAY} - 1`);
  expect(status(yesterday)).toBe('missed');
  await admin.goto('/admin/today');
  await admin.getByRole('link', { name: 'Day before', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Yesterday', level: 1 })).toBeVisible();
  await admin.getByRole('button', { name: 'Mark Make bed (Leo) done', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Marked Make bed (Leo) done.');
  expect(status(yesterday)).toBe('approved');
  await admin.getByRole('button', { name: 'Uncheck Make bed (Leo)', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Unchecked Make bed (Leo).');
  // Its day is closed, so it is missed again, as the seed had it.
  expect(status(yesterday)).toBe('missed');

  const tomorrow = occ(SET_THE_TABLE, null, `${TODAY} + 1`);
  await admin.goto('/admin/today');
  await admin.getByRole('link', { name: 'Day after', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Tomorrow', level: 1 })).toBeVisible();
  // A routine can't be done ahead of its day, only skipped.
  await expect(admin.getByRole('button', { name: 'Mark Set the table done' })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Skip Set the table', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Skipped Set the table.');
  expect(status(tomorrow)).toBe('skipped');
  await admin.getByRole('button', { name: 'Put Set the table back', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Set the table is back on the list.');
  expect(status(tomorrow)).toBe('scheduled');
});

test('[CHR-05][D-22] with approval on, a child’s check-off waits for a parent: approved, or sent back to try again', async () => {
  const [maya, leo] = [memberId('Maya'), memberId('Leo')];
  const dog = occ(FEED_THE_DOG, null);
  const table = occ(SET_THE_TABLE, null);
  // Open again before switching: switching changes only what's still to do (D-22).
  systemEvent(table, 'admin_uncomplete');

  await admin.goto('/admin');
  const form = admin.getByRole('form', { name: 'Check-offs', exact: true });
  await form.getByLabel('It waits for a parent to approve it').check();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Check-offs now wait for a parent.');
  expect(
    sql(`select approval_mode from public.household_settings where household_id = '${DEMO}'`),
  ).toBe('on');

  systemEvent(dog, 'complete', [maya]);
  systemEvent(table, 'complete', [leo]);
  expect([status(dog), status(table)]).toEqual(['pending_approval', 'pending_approval']);

  await admin.goto('/admin/today');
  const waiting = admin.getByRole('list', { name: 'Waiting for you' });
  await waiting.getByRole('button', { name: 'Approve Feed the dog', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Approved Feed the dog.');
  expect(status(dog)).toBe('approved');
  expect(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger
          where occurrence_id = '${dog}' and member_id = '${maya}'`),
  ).toBe('5');

  await admin
    .getByRole('list', { name: 'Waiting for you' })
    .getByRole('button', { name: 'Send Set the table back', exact: true })
    .click();
  await expect(admin.getByRole('status')).toContainText('Sent Set the table back.');
  expect(status(table)).toBe('rejected');
  // Open on the board again, to try again.
  await chores();
  await expect(
    column('Leo').getByRole('button', { name: 'Check off Set the table', exact: true }),
  ).toBeVisible();

  await admin.goto('/admin');
  await form.getByLabel('It counts straight away; a parent can uncheck it later').check();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('status')).toContainText('Check-offs now count straight away.');
});

test('[CHR-14][US-316] My tasks: quick add makes a task for me today, on the board at once; done credits me', async () => {
  const alex = memberId('Alex');
  const title = `Pick up the dry cleaning e2e ${Date.now() % 100000}`;
  await admin.goto('/admin/my');
  await expect(admin.getByRole('list', { name: 'Today' })).toContainText('Feed the dog');
  const add = admin.getByRole('form', { name: 'Quick add', exact: true });
  await add.getByLabel('Add a task for today').fill(title);
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(`Added ${title} for today.`);
  expect(
    sql(`select c.kind || ':' || c.visibility || ':' || o.due_date::text || ':' || array_to_string(array_agg(a.member_id), ',')
           from public.chore c
           join public.chore_occurrence o on o.chore_id = c.id
           join public.chore_occurrence_assignee a on a.occurrence_id = o.id
          where c.household_id = '${DEMO}' and c.title = '${title}'
          group by c.kind, c.visibility, o.due_date`),
  ).toBe(`task:family:${sql(`select ${TODAY}`)}:${alex}`);
  await chores();
  await expect(
    column('Alex').getByRole('button', { name: `Check off ${title}`, exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  await admin.getByRole('button', { name: `Mark ${title} done`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(`Marked ${title} done.`);
  expect(
    sql(`select o.status || ':' || array_to_string(o.done_by, ',')
           from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${DEMO}' and c.title = '${title}'`),
  ).toBe(`approved:${alex}`);
});
