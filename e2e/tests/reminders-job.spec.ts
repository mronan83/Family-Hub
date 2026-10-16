import { expect, test, type Page } from '../support/test';
import { runReminders, webPushSender } from '../../apps/web/lib/reminders';
import { serviceRpc, sql as query } from '../support/db';
import { browserKeys, decryptPush, mockPushService, vapidKeys } from '../support/push';
import { addDays, householdToday } from '../support/day';
import { signIn } from '../support/session';

// [CHR-15][CHR-16][CHR-17][CHR-20] The reminders job against a mocked push service (WP-40, D-58;
// WP-63, D-88): the job's own code (lib/reminders.ts) runs here on the e2e runner against the shared
// database and real web push encryption, with its clock passed in, since previews hold no job secret
// and no VAPID private key. Alex of the demo family turns reminders on with one phone (and an old
// laptop the push service says is gone). The approval alert runs on today's clock, first, before
// quiet hours are set; the rest run two days ahead, so production's own reminders job (every 5
// minutes) never reaches these. Each test starts from the same set-up (reminders on, both devices, no
// item of this spec's left), so none depends on another. What is made here is approved, archived or
// removed before each test and at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const TAG = 'rmd-e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

const vapid = { ...vapidKeys(), subject: 'https://familywise.invalid' };
const phone = browserKeys();
const laptop = browserKeys();
const PHONE = `https://push.familywise.invalid/${TAG}-phone`;
const LAPTOP = `https://push.familywise.invalid/${TAG}-laptop`;
let alex = '';
let day = '';
let push = mockPushService();

/** The household-local time on the test's day (two days ahead; `next` the day after). */
const at = (time: string, next = false) =>
  new Date(
    1000 *
      Number(
        sql(`select extract(epoch from (('${day}'::date + ${next ? 1 : 0}) + '${time}'::time)
                                        at time zone h.timezone)::bigint
               from public.household h where h.id = '${DEMO}'`),
      ),
  );
const run = (time: string, next = false) => {
  push = mockPushService((endpoint) => (endpoint === LAPTOP ? 410 : 201));
  return runReminders(
    serviceRpc(db!) as unknown as Parameters<typeof runReminders>[0],
    DEMO,
    at(time, next),
    webPushSender(vapid, push.transport),
  );
};
/** What reached the phone, decrypted: "title | body" per message. */
const phoneSaw = () =>
  push.received
    .filter((m) => m.endpoint === PHONE)
    .map((m) => {
      const p = JSON.parse(decryptPush(m.body!, phone.ecdh, phone.authBytes));
      return `${p.title} | ${p.body}`;
    });
/**
 * A task for Alex on the test's day, made as the item editor makes it, with its bell on for him
 * (his default is off here, so the demo family's own items never remind him during the test).
 */
function task(title: string, due: string, opts: { private?: boolean } = {}) {
  const id = sql(`select public.save_chore('${DEMO}', null,
    jsonb_build_object('title', '${title} ${TAG}', 'kind', 'task',
                       'schedule', jsonb_build_object('freq', 'once', 'on_date', '${day}'),
                       'due_time', '${due}', 'start_date', '${day}',
                       'visibility', '${opts.private ? 'private' : 'family'}'),
    array['${alex}'::uuid])`);
  sql(`update public.chore_assignee set remind = true where chore_id = '${id}'`);
  return id;
}
const occurrence = (chore: string) =>
  sql(`select id from public.chore_occurrence where chore_id = '${chore}'`);

/**
 * [CHR-20] Maya checks off an item today that needs a parent's OK (no points, so approving it at the
 * end changes no balance), as the board records it.
 */
function checkOff(title: string) {
  const maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  const id = sql(`select public.save_chore('${DEMO}', null,
    jsonb_build_object('title', '${title} ${TAG}', 'kind', 'chore', 'points', 0, 'approval', 'required',
                       'schedule', jsonb_build_object('freq', 'once', 'on_date', private.household_today('${DEMO}')),
                       'start_date', private.household_today('${DEMO}')),
    array['${maya}'::uuid])`);
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${occurrence(id)}', 'complete', array['${maya}'::uuid], now())`);
  expect(sql(`select status from public.chore_occurrence where chore_id = '${id}'`)).toBe(
    'pending_approval',
  );
  return id;
}
/** What reached the phone, decrypted. */
const phonePayloads = () =>
  push.received
    .filter((m) => m.endpoint === PHONE)
    .map((m) => JSON.parse(decryptPush(m.body!, phone.ecdh, phone.authBytes)));
// Both devices accept, so the old laptop is still there for the 410 in the next test.
const runNow = () => {
  push = mockPushService(() => 201);
  return runReminders(
    serviceRpc(db!) as unknown as Parameters<typeof runReminders>[0],
    DEMO,
    // The database's clock, which stamped the check-offs.
    new Date(Number(sql(`select (extract(epoch from now()) * 1000)::bigint`))),
    webPushSender(vapid, push.transport),
  );
};

// Items with completion events can't be deleted (events are append-only): a check-off still waiting
// is approved (no points, so no balance changes) so nothing is left waiting for other tests, then
// they are archived, which takes them off every list and stops their reminders.
function cleanUp() {
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       select gen_random_uuid(), o.id, 'approve', now()
         from public.chore_occurrence o join public.chore c on c.id = o.chore_id
        where c.household_id = '${DEMO}' and c.title like '% ${TAG}' and c.archived_at is null
          and o.status = 'pending_approval';
       update public.chore set archived_at = now()
        where household_id = '${DEMO}' and title like '% ${TAG}' and archived_at is null;
       delete from public.push_subscription where endpoint like 'https://push.familywise.invalid/${TAG}-%';
       delete from public.reminder_preference where member_id = (select id from public.member
         where household_id = '${DEMO}' and display_name = 'Alex');`);
}

let user = '';
test.beforeAll(() => {
  alex = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`,
  );
  user = sql(`select user_id from public.member where id = '${alex}'`);
  day = addDays(householdToday(db!), 2);
});

// [D-110] Each test's own start: Alex's reminders on (no quiet hours), his phone and his old laptop
// subscribed and enabled, and no item of this spec's left from a test before.
test.beforeEach(() => {
  cleanUp();
  sql(`insert into public.reminder_preference (member_id, household_id, enabled, default_on, morning_time)
       values ('${alex}', '${DEMO}', true, false, '08:00');
       insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label)
       values ('${DEMO}', '${alex}', '${user}', '${PHONE}', '${phone.p256dh}', '${phone.auth}', 'iPhone · Safari'),
              ('${DEMO}', '${alex}', '${user}', '${LAPTOP}', '${laptop.p256dh}', '${laptop.auth}', 'Old laptop');`);
});

/** [CHR-20] How many of Maya's check-offs an approvals alert counts ("Maya: 3 check-offs and …"). */
function mayasCheckOffs(title: string): number {
  const m = /(?:^|· )Maya: (\d+) check-offs?/.exec(title);
  return m ? Number(m[1]) : 0;
}

test.afterAll(() => cleanUp());

test('[CHR-20][US-322] a check-off waiting for a parent: exactly one push, and its link opens Today', async ({
  page,
}: {
  page: Page;
}) => {
  checkOff('Read for 20 minutes');
  // Alex turned reminders on (and with them Approvals) before it: one alert, counting everything that
  // waits for Alex (D-119), Maya's check-offs among it (the demo family may have more waiting).
  expect(await runNow()).toMatchObject({ approvals: 1, sent: 1, delivered: 2, gone: 0 });
  const [alert] = phonePayloads();
  expect(phonePayloads()).toHaveLength(1);
  const first = mayasCheckOffs(alert.title);
  expect(first, `Maya's check-offs in "${alert.title}"`).toBeGreaterThanOrEqual(1);
  expect(alert).toEqual({
    title: alert.title,
    body: 'Open Today to approve',
    url: '/admin/today',
    tag: 'approval',
    renotify: true,
  });

  // A second check-off: one more alert, replacing the first on the lock screen and counting one more.
  checkOff('Practice piano');
  expect(await runNow()).toMatchObject({ approvals: 1, sent: 1 });
  const [second] = phonePayloads();
  expect(phonePayloads()).toHaveLength(1);
  expect(mayasCheckOffs(second.title), `Maya's check-offs in "${second.title}"`).toBe(first + 1);
  expect(`${second.body} | ${second.tag}`).toBe('Open Today to approve | approval');
  // A replay sends nothing.
  expect(await runNow()).toMatchObject({ approvals: 0, sent: 0 });
  expect(push.received).toEqual([]);

  // Tapping it opens Today, with both waiting there.
  await signIn(page);
  await page.goto(alert.url);
  const waiting = page.getByRole('list', { name: 'Waiting for you' });
  await expect(waiting.getByText(`Read for 20 minutes ${TAG}`)).toBeVisible();
  await expect(waiting.getByText(`Practice piano ${TAG}`)).toBeVisible();
  // Both are put back by cleanUp(), after this test and on its failure too: approved (no points), so
  // nothing is left waiting for other tests.
});

test('[CHR-16][US-318] a task due in 15 minutes: exactly one push, encrypted, opening it in My tasks', async () => {
  const plumber = task('Call the plumber', '15:00');
  const stats = await run('14:45');
  expect(stats).toMatchObject({ sent: 1, delivered: 1, gone: 1 });
  expect(phoneSaw()).toEqual([`Call the plumber ${TAG} | Due at 3:00 pm`]);
  const payload = JSON.parse(
    decryptPush(
      push.received.find((m) => m.endpoint === PHONE)!.body!,
      phone.ecdh,
      phone.authBytes,
    ),
  );
  expect(payload.url).toBe(`/admin/my#item-${occurrence(plumber)}`);
  // The push service said the laptop is gone (410): it is deleted.
  expect(sql(`select count(*) from public.push_subscription where endpoint = '${LAPTOP}'`)).toBe(
    '0',
  );
  // A replay sends nothing.
  expect(await run('14:50')).toMatchObject({ planned: 0, sent: 0 });
  expect(push.received).toEqual([]);
});

test('[CHR-16] completing it first: nothing is sent', async () => {
  const cleaner = task('Pay the window cleaner', '16:00');
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
       values (gen_random_uuid(), '${occurrence(cleaner)}', 'admin_complete', array['${alex}'::uuid], now())`);
  expect(await run('15:45')).toMatchObject({ planned: 0, sent: 0 });
  expect(push.received).toEqual([]);
});

test('[CHR-15][CHR-16] switched off for the item, the device or the person: nothing is sent', async () => {
  const bins = task('Take out the bins', '17:00');
  sql(`update public.chore_assignee set remind = false where chore_id = '${bins}'`);
  expect(await run('16:45')).toMatchObject({ planned: 0, sent: 0 });

  const gate = task('Fix the gate', '18:00');
  // Every one of Alex's devices off (this test's own two, from beforeEach).
  sql(
    `update public.push_subscription set enabled = false where endpoint in ('${PHONE}', '${LAPTOP}')`,
  );
  expect(await run('17:45')).toMatchObject({ planned: 1, sent: 0 });
  expect(
    sql(`select status || ':' || detail from public.reminder_delivery
          where dedupe_key = 'due:${occurrence(gate)}:${alex}'`),
  ).toBe('skipped:no_device');
  sql(
    `update public.push_subscription set enabled = true where endpoint in ('${PHONE}', '${LAPTOP}')`,
  );

  // Off for the person: nothing is planned while they are off (turned back on, the last two hours
  // catch up; this one's time is long past by then).
  task('Book the dentist', '19:00');
  sql(`update public.reminder_preference set enabled = false where member_id = '${alex}'`);
  expect(await run('18:45')).toMatchObject({ planned: 0, sent: 0 });
  expect(push.received).toEqual([]);
});

test('[CHR-17][US-319] quiet hours hold a reminder and release it once; a private title stays off the lock screen', async () => {
  sql(`update public.reminder_preference set enabled = true, quiet_start = '21:00', quiet_end = '07:00'
        where member_id = '${alex}'`);
  const present = task('Wrap the present', '22:30', { private: true });
  sql(`update public.chore set remind_lead_minutes = 0 where id = '${present}'`);
  expect(await run('22:30')).toMatchObject({ planned: 1, sent: 0 });
  expect(await run('23:30')).toMatchObject({ sent: 0 });
  expect(await run('06:55', true)).toMatchObject({ sent: 0 });
  expect(await run('07:00', true)).toMatchObject({ sent: 1, delivered: 1 });
  // Its title stays out of the message itself, not only off the screen.
  expect(phoneSaw()).toEqual(['Private task | Was due yesterday at 10:30 pm']);
  expect(
    decryptPush(push.received[0]!.body!, phone.ecdh, phone.authBytes).toLowerCase(),
  ).not.toContain('present');
  expect(await run('07:05', true)).toMatchObject({ sent: 0 });
});
