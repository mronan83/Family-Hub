import { expect, test, type Page } from '../support/test';
import { runCalendarSync, type Fetcher } from '../../apps/web/lib/calendar/sync';
import { serviceRpc, sql as query } from '../support/db';
import { openSetting } from '../support/settings';
import { addDays, householdToday } from '../support/day';

// [CAL-01][CAL-02][CAL-03][CAL-06][CAL-07] Calendar sync on the preview (WP-22, D-63), as Alex of the
// demo family. Alex adds a calendar by its link on Calendars: the link goes to Vault and nowhere
// else, and the preview syncs it at once with that link. The link is made up (.invalid can never
// resolve), so that first sync fails and says so. Then the calendar_sync job's own code
// (lib/calendar/sync.ts) runs here on the e2e runner against the shared database, as the job does
// (previews hold no job secret), with its fetch answering a made-up calendar built around today; its
// clock (the database's, which stamps each sync) runs a quarter of an hour ahead per round, as the
// job's calls do. A broken link keeps the last good events; a working one again is OK. Removing the
// calendar takes its events and its link. These are the steps of one story, so they are one test.
// Production's jobs leave the demo family alone (D-62), so nothing else syncs it meanwhile.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const NAME = 'Family e2e';
const LINK = 'https://calendar.familywise.invalid/family-e2e.ics';
// What only the link holds (the demo sign-ins' addresses end in familywise.invalid too).
const LINK_PATH = 'calendar.familywise.invalid/family-e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let calendarId = '';
let today = '';

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
const day = (n: number) => addDays(today, n);
const ics = (n: number) => day(n).replace(/-/g, '');

/**
 * A made-up family calendar around the demo family's today: swimming at 5 pm weekly from six days ago
 * (the one in eight days moved to the day after, at 6 pm), and a two-day field trip from tomorrow with
 * a place that must not be kept. The first swim is a day inside the job's window (today − 7), so it
 * stays in even when the job's clock, a few minutes ahead, is already on the household's next day.
 */
function familyCalendar(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyWise//e2e made-up//EN',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    'UID:swim-e2e@familywise.test',
    'DTSTAMP:20261001T000000Z',
    `DTSTART;TZID=America/New_York:${ics(-6)}T170000`,
    `DTEND;TZID=America/New_York:${ics(-6)}T180000`,
    'RRULE:FREQ=WEEKLY;COUNT=6',
    'SUMMARY:Swim e2e',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:swim-e2e@familywise.test',
    'DTSTAMP:20261001T000000Z',
    `RECURRENCE-ID;TZID=America/New_York:${ics(8)}T170000`,
    `DTSTART;TZID=America/New_York:${ics(9)}T180000`,
    `DTEND;TZID=America/New_York:${ics(9)}T190000`,
    'SUMMARY:Swim e2e',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:trip-e2e@familywise.test',
    'DTSTAMP:20261001T000000Z',
    `DTSTART;VALUE=DATE:${ics(1)}`,
    `DTEND;VALUE=DATE:${ics(3)}`,
    'SUMMARY:Field trip e2e',
    'LOCATION:12 Made-up Street',
    'DESCRIPTION:Bring the made-up form',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const answering =
  (status: number, body = familyCalendar()): Fetcher =>
  async (url) => {
    expect(url).toBe(LINK);
    return status === 200
      ? new Response(body, { headers: { etag: '"e2e"' } })
      : new Response('Not here', { status, statusText: 'Not Found' });
  };
/**
 * The job's run for the demo family, `minutes` ahead of the database's clock (which stamped the last
 * sync), so the calendar is due again whatever the runner's own clock says.
 */
const runJob = (minutes: number, fetcher: Fetcher) =>
  runCalendarSync(serviceRpc(db!) as unknown as Parameters<typeof runCalendarSync>[0], DEMO, {
    fetch: fetcher,
    now: new Date(
      Number(sql(`select (extract(epoch from now()) * 1000)::bigint`)) + minutes * 60_000,
    ),
  });

function cleanUp() {
  // This spec's calendar only. Its Vault secret goes with it (trg_calendar_source_secrets).
  sql(`delete from public.calendar_source where household_id = '${DEMO}' and name = '${NAME}'`);
}

async function asAlexOnCalendars(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
  await openSetting(page, 'Calendars');
  await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();
}
async function onCalendars(page: Page) {
  await page.goto('/admin/calendars');
  await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();
}
const row = (page: Page) =>
  page.getByRole('list', { name: 'Calendars', exact: true }).getByRole('listitem').filter({
    hasText: NAME,
  });

test.beforeAll(() => {
  cleanUp();
  today = householdToday(db!);
});
test.afterAll(() => cleanUp());

test('[CAL-01][US-501][CAL-02][CAL-07][CAL-06][US-505] a calendar added by its link is synced, keeps its events while broken, is OK again, and is removed', async ({
  page,
}) => {
  // [D-105] One story in five steps: a sign-in, an add whose first sync may wait out the 15 s fetch
  // timeout, three job runs (each a few psql round trips), five page loads and about 15 SQL checks.
  // About 60 s on a slow preview, so three times that.
  test.setTimeout(180_000);

  await test.step('[CAL-01][US-501] Alex adds a calendar by its link: it goes to Vault only, and is synced at once', async () => {
    await asAlexOnCalendars(page);
    const form = page.getByRole('form', { name: 'Add a calendar' });
    await form.getByLabel('Name').fill(NAME);
    await form.getByLabel('Public link').fill(LINK.replace('https://', 'webcal://'));
    await form.getByText('Green', { exact: true }).click();
    await form.getByRole('combobox', { name: 'Whose calendar (optional)' }).selectOption('Alex');
    await form.getByRole('button', { name: 'Add calendar' }).click();
    await page.waitForURL(/did=added_failed/);
    // The preview tried the link at once; a made-up one can't be reached, and the page says so.
    await expect(page.getByText(`Added ${NAME}, but it didn’t sync.`)).toBeVisible();
    await expect(row(page)).toContainText('Can’t sync');
    await expect(row(page)).toContainText('Couldn’t reach the link.');
    await expect(row(page)).toContainText('Alex’s');
    await expect(page.locator('main')).not.toContainText(LINK_PATH);

    calendarId = sql(
      `select id from public.calendar_source where household_id = '${DEMO}' and name = '${NAME}'`,
    );
    expect(
      sql(`select d.decrypted_secret from vault.decrypted_secrets d
             join public.calendar_source s on s.url_secret_id = d.id where s.id = '${calendarId}'`),
    ).toBe(LINK);
    expect(
      sql(`select (select count(*) from public.calendar_source s where to_jsonb(s)::text like '%${LINK_PATH}%')
                + (select count(*) from public.audit_log a where a.diff::text like '%${LINK_PATH}%')`),
    ).toBe('0');
  });

  await test.step('[CAL-02][CAL-07] the sync job stores its events: the series at 5 pm, the trip on its own dates', async () => {
    expect(await runJob(13, answering(200)), 'the job’s run (the only calendar due)').toEqual({
      due: 1,
      synced: 1,
      unchanged: 0,
      failed: 0,
    });
    expect(
      sql(`select local_start_date || '..' || local_end_date from public.calendar_event_instance
            where source_id = '${calendarId}' and title = 'Field trip e2e'`),
    ).toBe(`${day(1)}..${day(2)}`);
    expect(
      sql(`select string_agg(to_char(instance_start at time zone 'America/New_York', 'HH24:MI')
                             || case when changed then ' moved' else '' end, ', ' order by instance_start)
             from public.calendar_event_instance where source_id = '${calendarId}' and title = 'Swim e2e'`),
    ).toBe('17:00, 17:00, 18:00 moved, 17:00, 17:00, 17:00');
    // [CAL-10][NFR-05] Only what the board shows is kept: where an event is, and none of its notes.
    expect(
      sql(`select string_agg(distinct location, ', ') from public.calendar_event_instance
            where source_id = '${calendarId}' and title = 'Field trip e2e'`),
    ).toBe('12 Made-up Street');
    expect(
      sql(
        `select count(*) from public.calendar_event where source_id = '${calendarId}' and to_jsonb(calendar_event)::text like '%made-up form%'`,
      ),
    ).toBe('0');

    await onCalendars(page);
    await expect(row(page)).toContainText('Synced');
    const coming = page.getByRole('list', { name: `Coming up on ${NAME}` });
    await expect(coming).toContainText('All day Field trip e2e');
    await expect(coming).toContainText('6:00 pm Swim e2e · moved');
    await expect(coming).toContainText(/5:00 pm Swim e2e/);
    // [CAL-03] Events are read-only: nothing on the page adds or changes one.
    await expect(page.getByRole('button', { name: /event/i })).toHaveCount(0);
  });

  await test.step('[CAL-06][US-505] a broken link keeps the last good events and says what to do, here and on Health', async () => {
    const before = sql(
      `select count(*) from public.calendar_event_instance where source_id = '${calendarId}'`,
    );
    expect(await runJob(26, answering(404))).toMatchObject({ due: 1, failed: 1 });
    expect(
      sql(`select count(*) from public.calendar_event_instance where source_id = '${calendarId}'`),
    ).toBe(before);

    await onCalendars(page);
    await expect(row(page)).toContainText('Can’t sync');
    await expect(row(page)).toContainText(
      'The link answered 404 (Not Found): the calendar may no longer be public.',
    );
    await expect(row(page)).toContainText('the board keeps showing its events.');
    await expect(page.getByRole('list', { name: `Coming up on ${NAME}` })).toContainText(
      'Field trip e2e',
    );

    await openSetting(page, 'Health');
    await expect(page.getByText(`A calendar can’t sync: ${NAME}.`, { exact: false })).toBeVisible();
  });

  await test.step('[US-505] when the link works again, the next sync makes it OK', async () => {
    // The same file as the last good sync, so nothing is stored again (unless the household's day
    // turned meanwhile, which expands it again; unit tests and pgTAP pin the skip itself).
    const run = await runJob(39, answering(200));
    expect(run).toMatchObject({ due: 1, failed: 0 });
    expect(run.unchanged + run.synced).toBe(1);
    await onCalendars(page);
    await expect(row(page)).toContainText('Synced');
    await expect(row(page)).not.toContainText('Can’t sync');
  });

  await test.step('[CAL-01] removing the calendar takes its events and its link', async () => {
    const remove = row(page).locator('details', {
      has: page.locator('summary', { hasText: `Remove ${NAME}` }),
    });
    await remove.locator('summary').click();
    await remove.getByRole('button', { name: `Remove ${NAME}` }).click();
    await page.waitForURL(/did=removed/);
    await expect(page.getByText(`Removed ${NAME}. It stays in Apple Calendar.`)).toBeVisible();
    expect(
      sql(`select (select count(*) from public.calendar_source where id = '${calendarId}')
                + (select count(*) from public.calendar_event_instance where source_id = '${calendarId}')
                + (select count(*) from vault.secrets where name = 'familywise_calendar_${calendarId}')`),
    ).toBe('0');
  });
});
