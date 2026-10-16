import { expect, test, type Page } from '../support/test';
import { boardFold, pairBoard, retireBoard } from '../support/board';
import { sql as query } from '../support/db';

// [DEV-07][US-207] Sleep and wake per board on the preview (WP-34, D-116, D-117). Alex sets
// a board paired here to sleep now on Boards (set times from two hours ago to two hours ahead, on the
// household's own clock, read from the database), and the board goes black; a touch on a check-off
// wakes it and checks nothing off. Then, the board closed and last seen two days ago, Home lists it
// only as each choice says: Always yes; Only while awake no, as it is asleep; Never no. The board is
// retired at the end; it is this spec's own.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Sleep e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board takes 10 to 40 s on a cold preview (pairBoard).
  testInfo.setTimeout(120_000);
  ({ admin, board } = await pairBoard(browser, BOARD, {
    board: { viewport: { width: 1920, height: 1080 }, hasTouch: true },
  }));
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
});

/** The household's clock now, moved by whole hours: 'HH:MM'. */
const clock = (hours: number) =>
  sql(
    `select to_char((now() at time zone timezone) + interval '${hours} hours', 'HH24:MI')
       from public.household where id = '${DEMO}'`,
  );
const deviceId = () =>
  sql(`select id from public.device where household_id = '${DEMO}' and name = '${BOARD}'`);
/** Check-offs this board has sent (its outbox posts them as completion events). */
const sent = () =>
  Number(
    sql(`select count(*) from public.chore_completion_event
          where actor_type = 'device' and actor_id = '${deviceId()}'`),
  );

test('[DEV-07][US-207] WP-34: a board set to sleep now goes black; the touch that wakes it checks nothing off; Home lists it as its choice says', async () => {
  // Not yet measured (a new spec, D-110): saving, Realtime and the board's next look (every 15 s)
  // take seconds; three Home loads on a cold preview up to about 10 s each. The nightly run's
  // summary gives the time to set this from.
  test.setTimeout(240_000);
  await test.step('Alex sets the board to sleep now, missed only while awake', async () => {
    await admin.goto('/admin/devices');
    // [DEV-09][D-118] The board's fold opened (WP-91), its sleep and wake inside.
    const fold = await boardFold(admin, BOARD);
    const form = fold.getByRole('form', { name: `Sleep and wake for ${BOARD}`, exact: true });
    await form.getByRole('radio', { name: /^Only while awake/ }).check();
    await form.getByRole('checkbox', { name: `${BOARD} sleeps and wakes at set times` }).check();
    for (const night of ['school', 'weekend']) {
      await form.locator(`input[name=${night}_sleep]`).fill(clock(-2));
      await form.locator(`input[name=${night}_wake]`).fill(clock(2));
    }
    await form.getByRole('button', { name: 'Save sleep and wake' }).click();
    await expect(admin.getByText(`Saved sleep and wake for ${BOARD}.`)).toBeVisible();
    // Back open after the save, its header saying it is asleep now.
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator(':scope > summary')).toContainText(/Asleep · wakes at /);
    expect(
      sql(
        `select board_config -> 'sleep' ->> 'missed' from public.device where id = '${deviceId()}'`,
      ),
    ).toBe('awake');
  });

  await test.step('the board goes black', async () => {
    await expect(
      board.getByRole('button', { name: `${BOARD} is asleep. Touch to wake it.` }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(board.locator('main.fw-board')).toHaveAttribute('data-asleep', 'true');
  });

  await test.step('a touch on a check-off wakes it and checks nothing off', async () => {
    const check = board
      .locator('.fw-dash__list')
      .getByRole('button', { name: /^Check off / })
      .first();
    const name = await check.getAttribute('aria-label');
    const box = await check.boundingBox();
    expect(box, 'a check-off is on the board').not.toBeNull();
    const before = sent();
    await board.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(board.locator('.fw-sleep')).toHaveCount(0);
    await expect(board.locator('main.fw-board')).toHaveAttribute('data-asleep', 'false');
    // To show the touch sent nothing: the check-off is as it was, and the board's next press does
    // reach the screen (Calendar opens).
    await expect(board.getByRole('button', { name: name!, exact: true })).toBeVisible();
    await board
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: 'Calendar', exact: true })
      .tap();
    await expect(board.locator('.fw-today__screen[data-screen="calendar"]')).toBeVisible();
    expect(sent(), 'the waking touch sent a check-off').toBe(before);
  });

  await test.step('Home lists the board, last seen two days ago, only as its choice says', async () => {
    // The board closed, so it can't report in; then last seen two days ago.
    await board.context().close();
    const id = deviceId();
    sql(`update public.device set last_seen_at = now() - interval '2 days' where id = '${id}'`);
    // Other boards of the demo family dark for a day, if any: Home counts them in the same line.
    const others = Number(
      sql(`select count(*) from public.device
            where household_id = '${DEMO}' and status = 'active' and id <> '${id}'
              and last_seen_at < now() - interval '1 day'
              and coalesce(board_config -> 'sleep' ->> 'missed', 'always') = 'always'`),
    );
    const line = (n: number) => (n > 1 ? `${n} boards haven’t been seen for a day` : null);
    const homeSays = async () => {
      await admin.goto('/admin');
      await expect(admin.getByRole('heading', { name: 'Needs you' })).toBeVisible();
      const heads = admin.getByRole('list', { name: 'Heads-up', exact: true });
      return (await heads.count()) ? ((await heads.textContent()) ?? '') : '';
    };
    const setMissed = (missed: string) =>
      sql(`update public.device
              set board_config = jsonb_set(board_config, '{sleep,missed}', '"${missed}"')
            where id = '${id}'`);

    // Only while awake, and asleep now: not listed.
    const asleep = await homeSays();
    expect(asleep).not.toContain(`${BOARD} hasn’t been seen`);
    if (line(others)) expect(asleep).toContain(line(others)!);

    setMissed('never');
    const never = await homeSays();
    expect(never).not.toContain(`${BOARD} hasn’t been seen`);
    if (line(others)) expect(never).toContain(line(others)!);

    // Always: listed, so the two above weren't left out for another reason.
    setMissed('always');
    const always = await homeSays();
    expect(always).toContain(
      others === 0 ? `${BOARD} hasn’t been seen for 2 days` : line(others + 1)!,
    );
  });
});
