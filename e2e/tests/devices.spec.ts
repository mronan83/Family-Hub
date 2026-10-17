import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '../support/test';
import { addBoardForm, boardFold, pairingCode, retireBoard } from '../support/board';
import { householdToday } from '../support/day';
import { networkSwitch, type NetworkSwitch } from '../support/network';
import { signIn } from '../support/session';
import { slowReads } from '../../scripts/e2e-infra.mjs';

// [DEV-01][DEV-02][DEV-03][DEV-05] A board on the preview (WP-05, WP-06, SPIKE-01, D-40): Alex gets
// a code, a second browser pairs with it and reads the demo family, admin changes reach it within
// the 3-second budget, it catches up after the network drops, follows the theme Alex sets, signs
// itself in again after its session is lost, and stops reading the moment Alex disconnects it.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Kitchen e2e';
/** The board the pairing test pairs on its own, and the one that listens while BOARD is disconnected. */
const SECOND = 'Hall e2e';
const CONTROL = 'Porch e2e';
const BOARDS = `('${BOARD}', '${SECOND}', '${CONTROL}')`;
const FEED_THE_DOG = '0de00000-0000-4000-8000-0000000c0003';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

async function alexOnBoards(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await signIn(page);
  await page.goto('/admin/devices');
  await expect(page.getByRole('heading', { name: 'Boards', level: 1, exact: true })).toBeVisible();
  return page;
}

async function newCode(admin: Page, name = BOARD): Promise<string> {
  await admin.goto('/admin/devices');
  const form = await addBoardForm(admin);
  await form.getByLabel('Board name', { exact: true }).fill(name);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = await pairingCode(admin);
  expect(code).toMatch(/^\d{8}$/);
  return code;
}

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Nearest-rank percentile. */
function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]!;
}

/** A line for the DEV-05 latency report: the e2e workflow prints it to the log and the run summary. */
function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

async function pair(board: Page, code: string) {
  await board.goto('/board');
  await expect(board).toHaveURL(/\/board\/pair/);
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
}

/** A board of its own for one test: paired, and showing the family. */
async function pairedBoard(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await pair(page, await newCode(admin, name));
  await expect(page).toHaveURL(/\/board$/);
  return page;
}

/** The time a server answered a POST to `path` on the admin page, so a budget starts there (D-110). */
function answered(path: string): Promise<number | null> {
  return admin
    .waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path)
    .then(
      () => Date.now(),
      () => null,
    );
}

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let code = '';
let admin: Page;
let board: Page;
let net: NetworkSwitch;
let today = '';

// The seeded names, put back before a retry and after the run.
const RESET_NAMES = `update public.member set display_name = 'Maya' where household_id = '${DEMO}' and display_name like 'Maya%';
     update public.member set display_name = 'Leo' where household_id = '${DEMO}' and display_name like 'Leo%';`;

/** Today's Feed the dog open again, as the seed has it: before the check-off tests and after the file. */
function reopenFeedTheDog() {
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       select gen_random_uuid(), o.id, 'admin_uncomplete', now() from public.chore_occurrence o
        where o.chore_id = '${FEED_THE_DOG}' and o.due_date = '${today}' and o.status <> 'scheduled'`);
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  today = householdToday(db!);
  // A retry starts with none of this file's boards and the seeded member names (their sign-ins go
  // at the next demo family reset).
  sql(`${RESET_NAMES}
       delete from public.device_pairing where household_id = '${DEMO}' and device_name in ${BOARDS};
       delete from public.device where household_id = '${DEMO}' and name in ${BOARDS};`);
  reopenFeedTheDog();
  admin = await alexOnBoards(browser);
  // The board every other test uses, paired once here. Its network goes through a switch
  // (support/network), so the catch-up test can cut it below the browser, Realtime's socket too.
  code = await newCode(admin);
  net = await networkSwitch();
  board = await (await browser.newContext({ proxy: { server: net.server } })).newPage();
  await pair(board, code);
  await expect(board).toHaveURL(/\/board$/);
});

test.afterAll(async () => {
  try {
    sql(RESET_NAMES);
    reopenFeedTheDog();
  } finally {
    await admin?.context().close();
    await retireBoard(board, BOARD);
    await net?.close();
  }
});

test('[DEV-01][DEV-02] an admin gets an 8-digit code for a named board; a second browser pairs with it and reads the family', async ({
  browser,
}) => {
  // Its own board: the one beforeAll paired is the other tests'.
  const second = await (await browser.newContext()).newPage();
  try {
    let secondCode = '';
    await test.step('[DEV-01] an admin gets an 8-digit code for a named board', async () => {
      secondCode = await newCode(admin, SECOND);
      expect(
        sql(`select device_name || ':' || (expires_at - created_at)::text from public.device_pairing
              where household_id = '${DEMO}' and device_name = '${SECOND}' and consumed_at is null
              order by created_at desc limit 1`),
      ).toBe(`${SECOND}:00:10:00`);
    });
    await test.step('[DEV-01][DEV-02] a second browser pairs with the code and reads the family', async () => {
      await pair(second, secondCode);
      await expect(second).toHaveURL(/\/board$/);
      await expect(
        second.getByRole('heading', { name: 'Demo family', level: 1, exact: true }),
      ).toBeVisible();
      const family = second.getByRole('list', { name: 'Family', exact: true });
      for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) await expect(family).toContainText(name);
      expect(
        sql(`select d.status || ':' || (u.raw_app_meta_data ->> 'role') || ':' || (d.last_seen_at is not null)
               from public.device d join auth.users u on u.id = d.auth_user_id
              where d.household_id = '${DEMO}' and d.name = '${SECOND}'`),
      ).toBe('active:device:true');
      expect(
        sql(`select string_agg(a.actor_type || ':' || a.action || ':' || (a.diff ->> 'status'), ',' order by a.id)
               from public.audit_log a
              where a.household_id = '${DEMO}' and a.entity_type = 'device'
                and a.entity_id = (select id from public.device where household_id = '${DEMO}' and name = '${SECOND}')`),
      ).toBe('system:insert:active');
    });
  } finally {
    await retireBoard(second, SECOND);
  }
});

// [CHR-04][CHR-09][NFR-06] Check-offs from the board (WP-10): POST /api/completions with the board's
// own session. Feed the dog is shared by Maya and Alex.
const todayOf = (chore: string) =>
  sql(
    `select id from public.chore_occurrence where chore_id = '${chore}' and due_date = '${today}'`,
  );
/** The database's clock, for an event's occurred_at: its own today, whatever the runner's clock says. */
const now = () => sql(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
const memberId = (name: string) =>
  sql(
    `select id from public.member where household_id = '${DEMO}' and display_name like '${name}%'`,
  );
const post = (events: object[]) => board.request.post('/api/completions', { data: { events } });

test('[CHR-04][CHR-09][PTS-01] the board checks off a shared chore; a replay records nothing new; undo reopens it', async () => {
  reopenFeedTheDog();
  const occurrence = todayOf(FEED_THE_DOG);
  const maya = memberId('Maya');
  const check = {
    id: crypto.randomUUID(),
    occurrence_id: occurrence,
    event_type: 'complete',
    occurred_at: now(),
    done_by: [maya],
  };
  let res = await post([check]);
  expect(res.status()).toBe(200);
  expect((await res.json()).results[0]).toMatchObject({
    result: 'recorded',
    occurrence: { status: 'completed', done_by: [maya] },
  });
  res = await post([check]);
  expect((await res.json()).results[0]).toMatchObject({ result: 'duplicate' });
  expect(
    sql(`select count(*) || ':' || min(e.actor_type) || ':' || bool_and(d.name = '${BOARD}')
           from public.chore_completion_event e join public.device d on d.id = e.actor_id
          where e.id = '${check.id}'`),
  ).toBe('1:device:true');
  // [PTS-01] Maya earns the chore's 5 points, once (WP-16).
  const held = () =>
    sql(`select coalesce(sum(amount), 0) from public.points_ledger
          where occurrence_id = '${occurrence}' and member_id = '${maya}'`);
  expect(held()).toBe('5');

  // Alex sees it on the item: today is done by Maya.
  await admin.goto(`/admin/chores/${FEED_THE_DOG}`);
  await expect(
    admin.getByRole('list', { name: 'Coming up', exact: true }).getByRole('listitem').first(),
  ).toContainText('Done by Maya');

  res = await post([
    {
      id: crypto.randomUUID(),
      occurrence_id: occurrence,
      event_type: 'undo',
      occurred_at: now(),
    },
  ]);
  expect((await res.json()).results[0]).toMatchObject({
    result: 'recorded',
    occurrence: { status: 'scheduled', done_by: [] },
  });
  // [PTS-01] and gives them back.
  expect(held()).toBe('0');
});

test('[CHR-04][CHR-06] the board cannot approve; a removed occurrence is gone; the rest of the batch is recorded', async () => {
  reopenFeedTheDog();
  const occurrence = todayOf(FEED_THE_DOG);
  const at = now();
  const res = await post([
    {
      id: crypto.randomUUID(),
      occurrence_id: occurrence,
      event_type: 'approve',
      occurred_at: at,
      done_by: [memberId('Maya')],
    },
    {
      id: crypto.randomUUID(),
      occurrence_id: crypto.randomUUID(),
      event_type: 'complete',
      occurred_at: at,
      done_by: [memberId('Maya')],
    },
    {
      id: crypto.randomUUID(),
      occurrence_id: occurrence,
      event_type: 'complete',
      occurred_at: at,
      done_by: [memberId('Alex')],
    },
  ]);
  expect(res.status()).toBe(200);
  expect(
    (await res.json()).results.map(
      (r: { result: string; reason: string | null }) => `${r.result}:${r.reason}`,
    ),
  ).toEqual(['refused:not_allowed', 'gone:occurrence_gone', 'recorded:null']);
  // Not JSON, or not signed in: refused before the database.
  expect((await board.request.post('/api/completions', { form: { events: '[]' } })).status()).toBe(
    415,
  );
  expect((await post([{ id: 'nope' }])).status()).toBe(400);
  // Alex's check-off is taken back, so the specs after this one find Feed the dog open.
  reopenFeedTheDog();
});

test('[DEV-05] a change in the household reaches the board live (Realtime under RLS)', async () => {
  // Live means changes stream: the board waits for the server to confirm the subscription, which
  // can take up to about 20 seconds after a quiet spell.
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  sql(
    `update public.member set display_name = 'Maya R' where household_id = '${DEMO}' and display_name like 'Maya%'`,
  );
  // The budget is measured in the next test (DEV-05, p95 under 3 s).
  await expect(board.getByRole('list', { name: 'Family', exact: true })).toContainText('Maya R');
});

test('[DEV-05][NFR-14-p] a rename in the admin app reaches the board within 3 seconds (p95 of 20)', async () => {
  // [D-110] A sample takes about 5 s (a page load, a save, the board); the worst that still reports
  // is about 30 s (a 20 s miss after about 10 s of slow page load and save): 20 of them is 600 s.
  test.setTimeout(600_000);
  const leo = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name like 'Leo%'`,
  );
  const family = board.getByRole('list', { name: 'Family', exact: true });
  const live = board.getByRole('status');
  // Steady state before measuring: the board is live and Realtime has delivered a change.
  await expect(live).toHaveText('Live', { timeout: 30_000 });
  sql(`update public.member set display_name = 'Leo 0' where id = '${leo}'`);
  await expect(family).toContainText('Leo 0');
  const samples: number[] = [];
  const reads: (number | null)[] = [];
  // When an attribute of the board's status was marked, from the save; "never" if not since it.
  const sinceSave = async (name: string, from: number) => {
    const t = Number((await live.getAttribute(name)) ?? 0);
    return t >= from ? `+${t - from} ms` : 'never';
  };
  // The board's read still out when a wait ended, timed so far; else the last one back since the
  // save; else null.
  const stillOut = async (from: number) => {
    const n = async (name: string) => Number((await live.getAttribute(name)) ?? 0);
    const since = await n('data-reading-since');
    if (since > 0) return Date.now() - since;
    return (await n('data-read-from')) >= from
      ? (await n('data-read-to')) - (await n('data-read-from'))
      : null;
  };
  for (let i = 1; i <= 20; i++) {
    const name = `Leo ${i}`;
    const opened = Date.now();
    await admin.goto(`/admin/members/${leo}`);
    const form = admin.getByRole('form', { name: 'Edit member', exact: true });
    // The field's name includes its help text, so match by substring (as members.spec does).
    await form.getByLabel('Name').fill(name);
    const heard = await live.getAttribute('data-events');
    const confirmed = answered(`/admin/members/${leo}`);
    const clicked = Date.now();
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    // Timed in the board's own page, checked every 50 ms, from the moment the server confirmed the
    // save (D-110), so a slow save is reported as a slow save, not as a slow board. A sample that
    // never shows counts as 15 s, and measuring goes on, so a slow run still reports. With it, the
    // board's read of its snapshot that drew the name (or the one still out when the wait ended),
    // the evidence D-129 reads for a late change.
    const seen = board
      .waitForFunction(
        (want) => {
          const shown = [
            ...document.querySelectorAll('[aria-label="Family"] .fw-today__person-name'),
          ].some((el) => el.textContent === want);
          const live = document.querySelector('.fw-live');
          const n = (name: string) => Number(live?.getAttribute(name) ?? 0);
          return shown && { at: Date.now(), read: n('data-read-to') - n('data-read-from') || null };
        },
        name,
        { polling: 50, timeout: 20_000 },
      )
      .then(
        async (handle) => (await handle.jsonValue()) as { at: number; read: number | null },
        () => null,
      );
    const saved = await confirmed;
    const got = await seen;
    const from = saved ?? clicked;
    const shown = got === null ? 15_000 : Math.max(0, got.at - from);
    samples.push(shown);
    // Never shown: the read still out, timed so far; else the last read back since the save; else
    // none of its own to time.
    const read = got ? got.read : await stillOut(from);
    reads.push(read);
    await admin.waitForURL(/\/admin\/members\?saved=/);
    report(
      `[DEV-05] #${i}: board ${got === null ? 'never (counted 15000)' : shown} ms after the save was confirmed (admin page ${clicked - opened} ms, save ${saved === null ? 'not seen, timed from the click' : `${saved - clicked} ms`}, changes heard ${heard} → ${await live.getAttribute('data-events')}, the last at ${await sinceSave('data-heard-at', from)}, the board's read ${read === null ? 'not timed' : `${read} ms`})`,
    );
  }
  const p95 = percentile(samples, 95);
  const summary = `p50 ${percentile(samples, 50)} ms, p95 ${p95} ms, max ${Math.max(...samples)} ms; samples ${samples.join(', ')}`;
  test.info().annotations.push({ type: 'DEV-05 latency', description: summary });
  report(`[DEV-05] admin rename to board: ${summary}`);
  // [NFR-14-p][D-129] A miss while the board's read of every late change took over 2 s is the test
  // database slow, and re-runs once (scripts/e2e-run.mjs); the budget stays 3 s.
  if (p95 >= 3_000) {
    const evidence = slowReads(
      reads.filter((_, i) => samples[i]! >= 3_000),
      "board's reads of its late changes",
    );
    if (evidence) test.info().annotations.push({ type: 'infra', description: evidence });
  }
  expect(p95, `p95 of 20; the board's reads ${reads.join(', ')} ms`).toBeLessThan(3_000);
});

test('[DEV-05] after the network drops and comes back, the board catches up on its own', async () => {
  const status = board.getByRole('status');
  const context = board.context();
  await expect(status).toHaveText('Live', { timeout: 30_000 });
  // Cut below the browser (support/network): Playwright's offline mode can leave Realtime's open
  // socket up, and the change would then arrive live instead of by catching up.
  try {
    net.set(false);
    await context.setOffline(true);
    await expect(status).toHaveText('Reconnecting…');
    sql(
      `update public.member set display_name = 'Leo again' where household_id = '${DEMO}' and display_name like 'Leo%'`,
    );
  } finally {
    net.set(true);
    await context.setOffline(false);
  }
  await expect(board.getByRole('list', { name: 'Family', exact: true })).toContainText('Leo again');
  await expect(status).toHaveText('Live', { timeout: 30_000 });
});

test('[DEV-05] an admin holds the board on Evening or Day; it switches at once and stays legible', async () => {
  const html = board.locator('html');
  // Live first, so the theme arrives as a change, not by the read a (re)connect makes.
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
  const from = sql(
    `select coalesce(max(id), 0) from public.audit_log where household_id = '${DEMO}'`,
  );
  for (const [label, theme] of [
    ['Always Evening', 'evening'],
    ['Always Day', 'day'],
  ] as const) {
    // A fresh load each time, so no earlier save is still settling on the admin page.
    await admin.goto('/admin/devices');
    // [DEV-09][D-118] The board's fold opened (WP-91), its theme under Display.
    const form = (await boardFold(admin, BOARD)).getByRole('form', {
      name: `Theme for ${BOARD}`,
      exact: true,
    });
    await form.getByLabel(`Theme for ${BOARD}`, { exact: true }).selectOption({ label });
    const confirmed = answered('/admin/devices');
    const clicked = Date.now();
    await form.getByRole('button', { name: 'Set theme', exact: true }).click();
    // The 5 s start once the server confirmed the save (D-110): the save's own time is reported.
    const saved = await confirmed;
    report(
      `[DEV-05] theme ${theme}: save ${saved === null ? 'not seen, timed from the click' : `${saved - clicked} ms`}`,
    );
    await expect(html, `the board on ${theme} within 5 s of the saved theme`).toHaveAttribute(
      'data-theme',
      theme,
      { timeout: 5_000 },
    );
    await expectContrastOk(board);
  }
  await admin.goto('/admin/devices');
  const form = (await boardFold(admin, BOARD)).getByRole('form', {
    name: `Theme for ${BOARD}`,
    exact: true,
  });
  await form
    .getByLabel(`Theme for ${BOARD}`, { exact: true })
    .selectOption({ label: 'Automatic, by time of day' });
  await form.getByRole('button', { name: 'Set theme', exact: true }).click();
  await expect
    .poll(() =>
      sql(`select coalesce(board_config ->> 'theme', 'auto') from public.device
            where household_id = '${DEMO}' and name = '${BOARD}'`),
    )
    .toBe('auto');
  // Each save is in the board's history, by an admin.
  expect(
    sql(`select string_agg(a.actor_type || ':' || a.action || ':' ||
                           coalesce(a.diff -> 'status' ->> 'to', a.diff -> 'board_config' -> 'to' ->> 'theme', a.diff ->> 'status', '?'),
                           ',' order by a.id)
           from public.audit_log a
          where a.household_id = '${DEMO}' and a.entity_type = 'device' and a.id > ${from}
            and a.entity_id = (select id from public.device where household_id = '${DEMO}' and name = '${BOARD}')`),
  ).toBe('admin:update:evening,admin:update:day,admin:update:auto');
});

test('[DEV-02] a board whose session is lost signs itself in again', async () => {
  await board.context().clearCookies({ name: /^sb-/ });
  await board.goto('/board');
  await expect(board).toHaveURL(/\/board$/);
  await expect(
    board.getByRole('heading', { name: 'Demo family', level: 1, exact: true }),
  ).toBeVisible();
});

test('[DEV-01] a used code is refused', async ({ browser }) => {
  const other = await (await browser.newContext()).newPage();
  await pair(other, code);
  await expect(other.getByRole('status')).toContainText('That code didn’t match.');
  await other.context().close();
});

test('[DEV-02] a board cannot open the admin app', async () => {
  // Sent with the board's cookies, without navigating its page away from the board.
  const res = await board.context().request.get('/admin', { maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test('[DEV-03] the admin sees the board, renames it and disconnects it; the board loses access at once', async ({
  browser,
}) => {
  // It disconnects the board the file shares, so it runs last. A second board of its own (CONTROL)
  // listens throughout: what it hears proves a change was sent, so the disconnected board's silence
  // means something, with no fixed wait.
  const control = await pairedBoard(browser, CONTROL);
  try {
    const controlFamily = control.getByRole('list', { name: 'Family', exact: true });
    await expect(control.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
    const from = sql(
      `select coalesce(max(id), 0) from public.audit_log where household_id = '${DEMO}'`,
    );
    await admin.goto('/admin/devices');
    const boards = admin.getByRole('list', { name: 'Paired boards', exact: true });
    await expect(boards).toContainText(BOARD);
    // [DEV-09][D-118] Folded, its header says when it was last seen (WP-91).
    await expect(boards).toContainText(/seen (just now|\d+ min ago|\d+ h ago)/);
    const fold = await boardFold(admin, BOARD);

    // Disconnecting asks first (06 §6): nothing happens until "Yes, disconnect".
    await fold.getByText(`Disconnect ${BOARD}`, { exact: true }).click();
    await admin.getByRole('button', { name: `Yes, disconnect ${BOARD}`, exact: true }).click();
    // Disconnected opens on it (D-120).
    await expect(
      admin.getByRole('list', { name: 'Disconnected boards', exact: true }),
    ).toContainText(BOARD);

    // Realtime stops: a change made now never reaches the disconnected board (RLS, SPIKE-01).
    await expect(board).toHaveURL(/\/board$/);
    const live = board.getByRole('status');
    await expect(live).toHaveText('Live');
    // Settled first: a change made after the disconnect reaches the control board, so anything sent
    // before it (the disconnect's own row change among them) has reached the board too.
    sql(
      `update public.member set display_name = 'Leo P' where household_id = '${DEMO}' and display_name like 'Leo%'`,
    );
    await expect(controlFamily).toContainText('Leo P');
    const heard = (await live.getAttribute('data-events')) ?? '0';
    sql(
      `update public.member set display_name = 'Maya Q' where household_id = '${DEMO}' and display_name like 'Maya%'`,
    );
    // The control board hears it, so it was sent; the disconnected board heard nothing.
    await expect(controlFamily).toContainText('Maya Q');
    // Read once, not waited on: the control has shown the change was sent and has arrived.
    expect(
      await live.getAttribute('data-events'),
      'changes the disconnected board heard after Leo P (control board showed Maya Q)',
    ).toBe(heard);
    expect(
      await board.getByRole('list', { name: 'Family', exact: true }).textContent(),
      "the disconnected board's Family list",
    ).not.toContain('Maya Q');

    // Its next load is refused, and it cannot sign itself in again.
    await board.goto('/board');
    await expect(board).toHaveURL(/\/board\/pair\?disconnected=1$/);
    await expect(board.getByRole('status')).toContainText('This board was disconnected.');
    expect(
      sql(`select d.status || ':' || (u.banned_until = 'infinity')
           from public.device d join auth.users u on u.id = d.auth_user_id
          where d.household_id = '${DEMO}' and d.name = '${BOARD}'`),
    ).toBe('revoked:true');
    expect(
      sql(`select string_agg(a.actor_type || ':' || a.action || ':' ||
                           coalesce(a.diff -> 'status' ->> 'to', a.diff -> 'board_config' -> 'to' ->> 'theme', a.diff ->> 'status'),
                           ',' order by a.id)
           from public.audit_log a
          where a.household_id = '${DEMO}' and a.entity_type = 'device'
            and a.id > ${from}
            -- Only the board paired in this run: a retry pairs a new one, and earlier rows stay.
            and a.entity_id = (select id from public.device where household_id = '${DEMO}' and name = '${BOARD}')`),
    ).toBe('admin:update:revoked');
  } finally {
    await retireBoard(control, CONTROL);
  }
});
