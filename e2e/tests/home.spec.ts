import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { householdToday } from '../support/day';

// [NFR-17][US-109][ACC-08][US-110] Home at a glance and Family options on the preview (WP-57, D-84),
// as Alex in the demo family. The done-when: on a school day, one tap makes today a snow day (stored,
// with today's chores re-planned as a day off) and Undo makes it a school day again; on any other day
// Home says why there is no school. A new start day for the week waits for the next week (stored,
// and said on the page) while the week now running keeps its start, and Keep cancels it. What Home
// asks for matches the database. Everything this spec changes is put back at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const sql = (q: string) => query(db!, q);
/** The demo family's today, read once for the file ([D-105]), as an SQL date. */
let TODAY = '';

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;

function putBack() {
  if (!TODAY) return;
  sql(`delete from public.school_closure
        where household_id = '${DEMO}' and name = 'Snow day' and closure_type = 'snow_day'
          and start_date = ${TODAY} and end_date = ${TODAY};
       update public.household_settings set week_start_next = null, week_start_next_on = null
        where household_id = '${DEMO}';`);
}

test.beforeAll(async ({ browser }) => {
  TODAY = `'${householdToday(db!)}'::date`;
  putBack();
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
});

test.afterAll(async () => {
  putBack();
  await admin?.close();
});

test('[NFR-17][US-109] Home: what needs Alex matches the database, and the quick actions are there', async () => {
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  const waiting = Number(
    sql(`select count(*) from public.chore_occurrence
          where household_id = '${DEMO}' and status = 'pending_approval'`),
  );
  const needs = admin.getByRole('region', { name: 'Needs you' });
  if (waiting > 0) {
    await expect(needs).toContainText(`${waiting} check-off${waiting === 1 ? '' : 's'}`);
  } else {
    await expect(needs).not.toContainText('check-off');
  }
  const quick = admin.getByRole('list', { name: 'Quick actions' });
  for (const name of ['Add a chore', 'Add a task', 'Add a reward', 'Add a goal']) {
    await expect(quick.getByRole('link', { name })).toBeVisible();
  }
  await quick.getByRole('link', { name: 'Add a task' }).click();
  await expect(admin).toHaveURL(/\/admin\/chores\/new\?kind=task$/);
});

test('[NFR-17][SCH-01] the done-when: no school today in one tap, then Undo', async () => {
  const kind = sql(`select coalesce((select 'off' from public.school_closure c
                      join public.school_year y on y.id = c.school_year_id and y.archived_at is null
                     where c.household_id = '${DEMO}' and ${TODAY} between c.start_date and c.end_date
                       and ${TODAY} between y.start_date and y.end_date limit 1),
                     (select case when extract(isodow from ${TODAY}) in (6, 7) then 'weekend' else 'school' end
                        from public.school_year
                       where household_id = '${DEMO}' and archived_at is null
                         and ${TODAY} between start_date and end_date limit 1),
                     'none')`);
  await admin.goto('/admin');
  const more = admin.getByRole('list', { name: 'More quick actions' });
  if (kind !== 'school') {
    // Not a school day (the weekend, a day off, or summer): Home says so, and offers no snow day.
    await expect(more.getByRole('button', { name: 'No school today' })).toHaveCount(0);
    await expect(more).toContainText(
      kind === 'weekend'
        ? 'No school today: the weekend'
        : kind === 'off'
          ? 'No school today:'
          : 'No school year today',
    );
    return;
  }
  await more.getByRole('button', { name: 'No school today' }).click();
  await expect(admin.getByRole('status').first()).toContainText('No school today.');
  expect(
    sql(`select count(*) from public.school_closure
          where household_id = '${DEMO}' and closure_type = 'snow_day'
            and start_date = ${TODAY} and end_date = ${TODAY}`),
  ).toBe('1');
  await expect(more).toContainText('No school today: Snow day');

  await more.getByRole('button', { name: 'Undo' }).click();
  await expect(admin.getByRole('status').first()).toContainText('Today is a school day again.');
  expect(
    sql(`select count(*) from public.school_closure
          where household_id = '${DEMO}' and closure_type = 'snow_day'
            and start_date = ${TODAY} and end_date = ${TODAY}`),
  ).toBe('0');
  await expect(more.getByRole('button', { name: 'No school today' })).toBeVisible();
});

test('[ACC-08][US-110] the done-when: a new start day waits for the next week, and Keep cancels it', async () => {
  const start = Number(sql(`select week_start from public.household where id = '${DEMO}'`));
  const next = (start + 1) % 7;
  await admin.goto('/admin/settings');
  await admin
    .getByRole('list', { name: 'Settings', exact: true })
    .getByRole('link', { name: /^Family options/ })
    .click();
  await expect(admin.getByRole('heading', { name: 'Family options', level: 1 })).toBeVisible();

  const week = admin.getByRole('region', { name: 'The week' });
  await week.getByLabel('Start the week on').selectOption(String(next));
  await week.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('status').first()).toContainText(
    'The new start day begins with the next week.',
  );
  // Stored for the switch day the database works out; the week now running keeps its start.
  expect(
    sql(`select s.week_start_next || ',' ||
                (s.week_start_next_on = private.week_start_switch_day(${TODAY}, h.week_start, ${next}::smallint))::text
                || ',' || h.week_start
           from public.household_settings s join public.household h on h.id = s.household_id
          where h.id = '${DEMO}'`),
  ).toBe(`${next},true,${start}`);
  await expect(week).toContainText(/From \w+day, \w{3} \d+, it starts on/);

  await week.getByRole('button', { name: /^Keep/ }).click();
  await expect(admin.getByRole('status').first()).toContainText('The week keeps its start day.');
  expect(
    sql(`select coalesce(week_start_next::text, 'none') from public.household_settings
          where household_id = '${DEMO}'`),
  ).toBe('none');
  await expect(week).not.toContainText('From ');
});
