import { expect, test, type Locator, type Page } from '../support/test';
import { runCalendarSync, type Fetcher } from '../../apps/web/lib/calendar/sync';
import { boardFold, pairBoard, retireBoard } from '../support/board';
import { serviceRpc, sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';

// [CAL-04][CAL-05][CAL-10][US-507][US-509] Calendars on a board, on the preview at the reference panel's 3840×2160
// (WP-23, D-65). Two made-up calendars of the demo family (School, Maya's, and Family) are connected
// as Alex would, and the calendar_sync job's own code fills them on the e2e runner from made-up files
// around today (previews hold no job secret). A board paired here shows both on its calendar. The
// done-when: Alex unticks School for this board on Boards, and its events leave the board within 3
// seconds; ticked again, they come back in School's color. A calendar connected afterwards stays off
// this board, which now has its own choice. Everything made here is removed at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Calendar e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
let today = '';

const day = (n: number) => addDays(today, n);
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'DTSTART:20070311T020000',
  'TZNAME:EDT',
  'TZOFFSETTO:-0400',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'DTSTART:20071104T020000',
  'TZNAME:EST',
  'TZOFFSETTO:-0500',
  'END:STANDARD',
  'END:VTIMEZONE',
];
/** A made-up calendar with one event today: all-day, or at 5 pm New York time. */
function calendarFile(uid: string, title: string, allDay: boolean): string {
  const date = day(0).replace(/-/g, '');
  const next = day(1).replace(/-/g, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyWise//e2e made-up//EN',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${uid}@familywise.test`,
    'DTSTAMP:20261001T000000Z',
    ...(allDay
      ? [`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next}`]
      : [
          `DTSTART;TZID=America/New_York:${date}T170000`,
          `DTEND;TZID=America/New_York:${date}T180000`,
          'LOCATION:Community pool e2e',
        ]),
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
const FILES: Record<string, string> = {};
const serve: Fetcher = async (url) =>
  new Response(FILES[url] ?? 'gone', { status: FILES[url] ? 200 : 404 });

/** Connects a calendar as Alex (the link to Vault), then syncs it as the job would. */
async function connect(
  name: string,
  slug: string,
  color: string,
  member: string | null,
  event: string,
  allDay: boolean,
) {
  const link = `https://calendar.familywise.invalid/${slug}.ics`;
  FILES[link] = calendarFile(slug, event, allDay);
  const alex = sql(
    `select user_id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`,
  );
  sql(`select set_config('request.jwt.claims', '{"sub":"${alex}","role":"authenticated"}', false);
       select public.save_calendar_source('${DEMO}', null, '${name}', '${link}', '${color}',
         ${member ? `'${member}'` : 'null'}, true)`);
  await runCalendarSync(ownCalendars as unknown as Parameters<typeof runCalendarSync>[0], DEMO, {
    fetch: serve,
  });
}
/**
 * The job's database access as the service role, syncing only this spec's calendars: another
 * calendar of the demo family is left alone (its link is not one of these files, so a sync would
 * mark it failing).
 */
const ownCalendars = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    const answer = await serviceRpc(db!).rpc(name, args);
    if (name === 'calendar_sources_due' && Array.isArray(answer.data)) {
      answer.data = (answer.data as { url: string | null }[]).filter(
        (s) => s.url !== null && s.url in FILES,
      );
    }
    return answer;
  },
};

/** The calendars this spec connects, and only these are removed. */
const CALENDARS = ['School e2e', 'Family e2e', 'Sports e2e'];
function cleanUp() {
  // Each calendar's link goes from Vault with it (trg_calendar_source_secrets).
  sql(`delete from public.calendar_source where household_id = '${DEMO}'
         and name in (${CALENDARS.map((c) => `'${c}'`).join(', ')})`);
}

/** The week on the board's calendar: today's events in it, all day across the top or by the hour (D-82). */
const week = () => board.locator('.fw-tgrid');
/**
 * The board's calendar, tapped open each time: the tap also starts the board's 90 s idle again, so it
 * does not go back to Home during a measurement that follows.
 */
async function boardCalendar() {
  await board
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await expect(board.locator('#cal-title')).toBeVisible();
}

/**
 * [CAL-05][WP-70] Milliseconds from `saved` until the week shows `text` (or, `gone`, no longer does),
 * in `selector`'s elements, timed in the board's own page every 50 ms as DEV-05 is, for up to 10 s so
 * a late change says how late. Playwright's own wait backs off to a look every 500 ms: its last look
 * within 3 s came at about 2.8 s, and the time it gave was up to half a second after the change.
 */
async function untilOnBoard(selector: string, text: string, gone: boolean, saved: number) {
  return board
    .waitForFunction(
      ({ selector, text, gone }) => {
        // Gone counts only while the week is on screen (the board may go back to Home).
        if (!document.querySelector('.fw-tgrid')) return false;
        const has = [...document.querySelectorAll(selector)].some((el) =>
          el.textContent?.includes(text),
        );
        return has !== gone && Date.now();
      },
      { selector, text, gone },
      { polling: 50, timeout: 10_000 },
    )
    .then(
      async (handle) => ((await handle.jsonValue()) as number) - saved,
      () => Infinity,
    );
}

/**
 * [CAL-05][D-110] Presses Save calendars and waits for the server's answer to the save. The 3 s
 * budget runs from that answer (`saved`): the save's own time (`saved - pressed`) is reported apart,
 * so a slow save reads as a slow save, not as a slow board.
 */
async function save(button: Locator) {
  const answer = admin.waitForResponse(
    (r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined,
  );
  const pressed = Date.now();
  await button.click();
  await answer;
  return { pressed, saved: Date.now() };
}

/**
 * [CAL-05][WP-70] What the board did after Save, in ms from it: the last change it heard, its last
 * read's start and return, and reads that failed; and when the database had School's choice.
 */
async function boardStages(pressed: number, saved: number, heard: string | null) {
  const status = board.getByRole('status');
  const at = async (name: string) => {
    const t = Number((await status.getAttribute(name)) ?? 0);
    return t > 0 ? `${t - saved >= 0 ? '+' : ''}${t - saved} ms` : 'never';
  };
  const stored = sql(`select coalesce(string_agg(dc.visible::text || ' at ' ||
           to_char(dc.updated_at, 'HH24:MI:SS.MS'), ', '), 'nothing')
      from public.device_calendar dc join public.calendar_source s on s.id = dc.calendar_source_id
     where s.name = 'School e2e'`);
  return (
    `Save pressed at ${new Date(pressed).toISOString().slice(11, 23)} UTC, the save answered ${saved - pressed} ms later (times below from then); ` +
    `changes heard ${heard} → ${await status.getAttribute('data-events')}, the last at ${await at('data-heard-at')}; ` +
    `last read from ${await at('data-read-from')} to ${await at('data-read-to')}, ` +
    `${(await status.getAttribute('data-read-failed')) ?? 0} failed; ` +
    `School on this board in the database: ${stored}`
  );
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Connecting two calendars (a psql process per call of the job's code), signing in and pairing a
  // board take 15 to 40 s on a cold preview.
  testInfo.setTimeout(120_000);
  cleanUp();
  today = householdToday(db!);
  const maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  await connect('School e2e', 'school-e2e', 'member-3', maya, 'Picture day e2e', true);
  await connect('Family e2e', 'family-e2e', 'member-6', null, 'Swim e2e', false);
  ({ admin, board } = await pairBoard(browser, BOARD, { board: { hasTouch: true } }));
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
  cleanUp();
});

test('[CAL-04][CAL-05][CAL-10][US-509] a new board shows the calendars set to show on the boards; an event shows in full, with where it is', async () => {
  await boardCalendar();
  // School's all-day event across the top, Family's at 5 pm in today's hours (D-82).
  await expect(week().locator('.fw-tgrid__bar[data-calendar="School e2e"]')).toContainText(
    'Picture day e2e',
  );
  const swim = board.locator(
    '.fw-bcal__col[data-today] .fw-tgrid__event[data-calendar="Family e2e"]',
  );
  await expect(swim).toHaveAccessibleName(/^Swim e2e, .*, 5:00 – 6:00 pm, Family e2e$/);
  // School is Maya's calendar: its event says so.
  await expect(week().locator('.fw-tgrid__bar[data-calendar="School e2e"]')).toHaveAccessibleName(
    /^Picture day e2e, .*, all day, Maya$/,
  );
  // [CAL-10] A tap shows the swim in full: the place the sync stored with it.
  await swim.tap();
  const sheet = board.getByRole('dialog', { name: 'Swim e2e' });
  await expect(sheet.locator('dd')).toHaveText([
    /, 5:00 – 6:00 pm$/,
    'Community pool e2e',
    'Family e2e',
    'Everyone',
  ]);
  await sheet.getByRole('button', { name: 'Close' }).tap();
  await expect(sheet).toBeHidden();
});

// One story on this board's own calendar choice: School unticked, ticked again, then a calendar
// connected later. Two measured saves, two admin page loads, a sync and a reload: 20 to 50 s.
test('[CAL-05][US-507] this board’s own calendars: School unticked leaves it within 3 seconds; ticked again it is back in its color; a calendar connected later stays off', async () => {
  test.setTimeout(150_000);
  await admin.goto('/admin/devices');
  // [DEV-09][D-118] The board's fold opened (WP-91), its calendars inside.
  const choice = await boardFold(admin, BOARD);
  const form = choice.getByRole('form', { name: `Calendars on ${BOARD}` });
  const saveButton = form.getByRole('button', { name: 'Save calendars' });

  await test.step('[CAL-05][US-507] unticking School for this board takes its events off it within 3 seconds', async () => {
    await expect(form.getByRole('checkbox', { name: 'School e2e' })).toBeChecked();
    await form.getByRole('checkbox', { name: 'School e2e' }).uncheck();
    await boardCalendar();
    await expect(week()).toContainText('Picture day e2e');
    const heard = await board.getByRole('status').getAttribute('data-events');
    const { pressed, saved } = await save(saveButton);
    const ms = await untilOnBoard('.fw-tgrid', 'Picture day e2e', true, saved);
    // Say what the board did (WP-65, WP-70): when it heard the change, read and drew it, so a slow
    // save, Realtime, read or screen can be told apart.
    const stages = await boardStages(pressed, saved, heard);
    console.log(`[CAL-05] School left the board ${ms} ms after the save (${stages})`);
    expect(
      ms,
      `[CAL-05] School left the board ${ms} ms after the save, over 3 s: ${stages}`,
    ).toBeLessThanOrEqual(3_000);
    await expect(week()).toContainText('Swim e2e');
    await expect(
      admin.getByText(`Saved the calendars on ${BOARD}.`, { exact: false }),
    ).toBeVisible();
  });

  await test.step('[US-507] ticked again, School is back in its own color, with its person', async () => {
    // The form stays open after its save; opened again only if it closed.
    if ((await choice.getAttribute('open')) === null) await choice.locator('summary').click();
    await form.getByRole('checkbox', { name: 'School e2e' }).check();
    await boardCalendar();
    const heard = await board.getByRole('status').getAttribute('data-events');
    const { pressed, saved } = await save(saveButton);
    // [WP-70] Timed as CAL-05 is, and saying what the board did when it is late.
    const bar = '.fw-tgrid__bar[data-calendar="School e2e"]';
    const ms = await untilOnBoard(bar, 'Picture day e2e', false, saved);
    const stages = await boardStages(pressed, saved, heard);
    console.log(`[US-507] School back on the board ${ms} ms after the save (${stages})`);
    expect(
      ms,
      `[US-507] School back on the board ${ms} ms after the save, over 3 s: ${stages}`,
    ).toBeLessThanOrEqual(3_000);
    const school = week().locator(bar);
    await expect(school).toContainText('Picture day e2e');
    // The browser gives a custom property's value with var() resolved: School's color is member-3's,
    // as a line (D-70): the color itself by day, its lighter shade in the Evening theme.
    const color = await school.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        cal: style.getPropertyValue('--cal').trim(),
        own: style.getPropertyValue('--member-3-line').trim(),
      };
    });
    expect(color.cal).not.toBe('');
    expect(color.cal).toBe(color.own);
    await expect(school).toHaveAccessibleName(/, Maya$/);
  });

  await test.step('[US-507] a calendar connected later stays off a board with its own choice', async () => {
    await connect('Sports e2e', 'sports-e2e', 'member-5', null, 'Match e2e', true);
    // Sports shows on the boards by default; this board chose its own, so not here.
    expect(
      sql(
        `select show_on_board from public.calendar_source where household_id = '${DEMO}' and name = 'Sports e2e'`,
      ),
    ).toBe('t');
    await board.reload();
    await boardCalendar();
    await expect(week()).toContainText('Picture day e2e');
    await expect(week()).not.toContainText('Match e2e');
  });
});
