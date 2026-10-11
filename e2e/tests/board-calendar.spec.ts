import { expect, test, type Page } from '@playwright/test';
import { runCalendarSync, type Fetcher } from '../../apps/web/lib/calendar/sync';
import { retireBoard } from '../support/board';
import { serviceRpc, sql as query } from '../support/db';

// [CAL-04][CAL-05][US-507] Calendars on a board, on the preview at the reference panel's 3840×2160
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

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
let today = '';

const day = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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
  await runCalendarSync(serviceRpc(db!) as unknown as Parameters<typeof runCalendarSync>[0], DEMO, {
    fetch: serve,
  });
}

function cleanUp() {
  // Each calendar's link goes from Vault with it (trg_calendar_source_secrets).
  sql(`delete from public.calendar_source where household_id = '${DEMO}' and name like '% e2e'`);
}

const todayColumn = () => board.locator('.fw-bcal__col[data-today]');
/** The board's calendar, opened again if the board went back to Home (90 s untouched). */
async function boardCalendar() {
  if (await board.locator('#cal-title').isVisible()) return;
  await board
    .getByRole('list', { name: 'Family', exact: true })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await expect(board.locator('#cal-title')).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in, connecting and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  cleanUp();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  today = sql(`select private.household_today('${DEMO}')`);
  const maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  await connect('School e2e', 'school-e2e', 'member-3', maya, 'Picture day e2e', true);
  await connect('Family e2e', 'family-e2e', 'member-6', null, 'Swim e2e', false);

  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext({ hasTouch: true })).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  await retireBoard(board, BOARD);
  cleanUp();
});

test('[CAL-04][CAL-05] a new board shows the calendars set to show on the boards', async () => {
  await boardCalendar();
  await expect(todayColumn().locator('.fw-bcal__event[data-calendar="School e2e"]')).toContainText(
    'Picture day e2e',
  );
  await expect(todayColumn().locator('.fw-bcal__event[data-calendar="Family e2e"]')).toContainText(
    '5:00 pm',
  );
  // School is Maya's calendar: her avatar beside its event.
  await expect(
    todayColumn()
      .locator('.fw-bcal__event[data-calendar="School e2e"]')
      .getByRole('img', { name: 'Maya' }),
  ).toBeVisible();
});

test('[CAL-05][US-507] unticking School for this board takes its events off it within 3 seconds', async () => {
  await admin.goto('/admin/devices');
  const choice = admin.locator('details', {
    has: admin.locator('summary', { hasText: `Calendars on ${BOARD}:` }),
  });
  await choice.locator('summary').click();
  const form = choice.getByRole('form', { name: `Calendars on ${BOARD}` });
  await expect(form.getByRole('checkbox', { name: 'School e2e' })).toBeChecked();
  await form.getByRole('checkbox', { name: 'School e2e' }).uncheck();
  await boardCalendar();
  await expect(todayColumn()).toContainText('Picture day e2e');
  const saved = Date.now();
  await form.getByRole('button', { name: 'Save calendars' }).click();
  await expect(todayColumn()).not.toContainText('Picture day e2e', { timeout: 3_000 });
  console.log(`[CAL-05] School left the board ${Date.now() - saved} ms after Save`);
  await expect(todayColumn()).toContainText('Swim e2e');
  await expect(admin.getByText(`Saved the calendars on ${BOARD}.`, { exact: false })).toBeVisible();
});

test('[US-507] ticked again, School is back in its own color, with its person', async () => {
  const choice = admin.locator('details', {
    has: admin.locator('summary', { hasText: `Calendars on ${BOARD}:` }),
  });
  await choice.locator('summary').click();
  const form = choice.getByRole('form', { name: `Calendars on ${BOARD}` });
  await form.getByRole('checkbox', { name: 'School e2e' }).check();
  await boardCalendar();
  await form.getByRole('button', { name: 'Save calendars' }).click();
  const school = todayColumn().locator('.fw-bcal__event[data-calendar="School e2e"]');
  await expect(school).toContainText('Picture day e2e', { timeout: 3_000 });
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
  await expect(school.getByRole('img', { name: 'Maya' })).toBeVisible();
});

test('[US-507] a calendar connected later stays off a board with its own choice', async () => {
  await connect('Sports e2e', 'sports-e2e', 'member-5', null, 'Match e2e', true);
  // Sports shows on the boards by default; this board chose its own, so not here.
  expect(
    sql(
      `select show_on_board from public.calendar_source where household_id = '${DEMO}' and name = 'Sports e2e'`,
    ),
  ).toBe('t');
  await board.reload();
  await boardCalendar();
  await expect(todayColumn()).toContainText('Picture day e2e');
  await expect(todayColumn()).not.toContainText('Match e2e');
});
