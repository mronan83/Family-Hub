import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { retireBoard } from '../support/board';

// [DEV-06][DEV-08][NFR-01][US-205] A board offline on the preview (WP-13), paired to the demo family:
// it goes offline, checks off three of Maya's items, reloads with no network (its page from the
// service worker, its outbox from IndexedDB), and a parent unchecks one meanwhile. When the network
// returns exactly three events arrive, and the parent's later uncheck wins (D-20). Then a day passes
// offline (Playwright's clock): opened again, the board shows its last day and says how old it is.
// The real 24-hour soak runs on the Pi (WP-24). Everything it checks off it puts back.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Porch e2e';
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
const todayOf = (chore: string, member?: string) =>
  sql(`select id from public.chore_occurrence
        where chore_id = '${chore}' and due_date = ${TODAY}
          and ${member ? `member_id = '${member}'` : 'member_id is null'}`);
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

let code = '';
let board: Page;
const health = (page: Page) => page.locator('[data-health]');
const checkOff = (page: Page, title: string) =>
  page.getByRole('button', { name: `Check off ${title}`, exact: true });

async function asMaya(page: Page) {
  await page
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Maya', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible();
}

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
  code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  await admin.close();

  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  // The service worker takes the page from here, keeping it and its files for a reload offline.
  await board.evaluate(() => navigator.serviceWorker.ready);
  await board.reload();
  expect(await board.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  putBack();
  await retireBoard(board, BOARD);
});

test('[DEV-06][NFR-01][US-205] offline: three check-offs, a reload with no network, exactly three events; a parent’s later uncheck wins', async () => {
  const maya = memberId('Maya');
  const items = {
    bed: todayOf(MAKE_BED, maya),
    teeth: todayOf(BRUSH_TEETH, maya),
    dog: todayOf(FEED_THE_DOG),
  };
  const started = sql('select now()');
  const context = board.context();
  await asMaya(board);
  await context.setOffline(true);
  await expect(health(board).first()).toHaveText('Offline: your check-offs are saved');
  for (const title of ['Make bed', 'Brush teeth', 'Feed the dog']) {
    await checkOff(board, title).click();
    await expect(checkOff(board, title)).toHaveCount(0);
  }
  await expect(board.locator('[data-provisional]')).toContainText('Not saved yet');

  // Reloaded with no network: the page is the worker's copy, the check-offs still showing.
  await board.reload();
  await asMaya(board);
  for (const title of ['Make bed', 'Brush teeth', 'Feed the dog']) {
    await expect(checkOff(board, title)).toHaveCount(0);
  }
  // Nothing has reached the database. If something has, say what, who sent it and when, and how
  // the board saw its network, so the failure says what happened.
  const early = sql(`select coalesce(string_agg(e.event_type || ' by ' || e.actor_type || ' ' ||
          coalesce((select d.name from public.device d where d.id = e.actor_id), e.actor_id::text, '?') ||
          ' at ' || to_char(e.recorded_at, 'HH24:MI:SS.MS'), '; ' order by e.recorded_at), '')
     from public.chore_completion_event e
    where e.occurrence_id in ('${items.bed}', '${items.teeth}', '${items.dog}')
      and e.recorded_at >= '${started}'`);
  if (early) {
    const seen = await board.evaluate(() => ({
      online: navigator.onLine,
      worker: Boolean(navigator.serviceWorker?.controller),
    }));
    throw new Error(
      `reached the database while the board was offline: ${early} (the board saw itself ${seen.online ? 'online' : 'offline'}; its service worker ${seen.worker ? 'in control' : 'not in control'})`,
    );
  }

  // Meanwhile a parent unchecks Brush teeth (later than the board's tap).
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       values (gen_random_uuid(), '${items.teeth}', 'admin_uncomplete', now())`);

  await context.setOffline(false);
  const boardEvents = () =>
    sql(`select count(*) from public.chore_completion_event e
          where e.occurrence_id in ('${items.bed}', '${items.teeth}', '${items.dog}')
            and e.recorded_at >= '${started}' and e.actor_type = 'device'
            and e.actor_id = (select id from public.device where household_id = '${DEMO}' and name = '${BOARD}')`);
  await expect.poll(boardEvents, { timeout: 30_000 }).toBe('3');
  // The later event by time wins: Brush teeth stays open; the others are done.
  expect([status(items.bed), status(items.teeth), status(items.dog)]).toEqual([
    'completed',
    'scheduled',
    'completed',
  ]);
  await expect(checkOff(board, 'Brush teeth')).toBeVisible();
  await expect(checkOff(board, 'Make bed')).toHaveCount(0);
  await expect(health(board)).toHaveCount(0);
  await expect(board.locator('[data-provisional]')).toHaveCount(0);

  // Sent once: a reload online sends nothing more.
  await board.reload();
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  expect(boardEvents()).toBe('3');
});

test('[NFR-01][DEV-08][US-205] opened after a day offline, the board shows its last day and says how old it is', async () => {
  // The same board in a page whose clock can run ahead.
  const page = await board.context().newPage();
  await page.clock.install();
  await page.goto('/board');
  await expect(page.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  await page.context().setOffline(true);
  await page.clock.fastForward('24:00:00');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  await expect(health(page)).toHaveText([
    'Offline: your check-offs are saved',
    'Updated 1 day ago',
  ]);
  // Its last day: everyone's column, with Maya's bed done as the database had it.
  const maya = page
    .getByRole('region', { name: 'Everyone today' })
    .locator('section', { has: page.getByRole('heading', { name: 'Maya', level: 2 }) });
  await expect(maya.getByRole('heading', { name: 'Make bed' })).toBeVisible();
  await expect(maya.getByRole('button', { name: 'Check off Make bed', exact: true })).toHaveCount(
    0,
  );
  await page.context().setOffline(false);
  await page.close();
});
