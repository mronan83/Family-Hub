import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { householdToday } from '../support/day';
import { openSetting } from '../support/settings';

// [SCH-01][SCH-02][SCH-03] School years on the preview, as the demo family (D-37): the seeded year and
// next year's, today's day type for each member, the timeline, days off, overlapping defaults, and a
// child who follows another school's calendar. Dates come from the database, so the spec works on
// any day of the year. The database is read with psql to confirm what was saved. What the spec adds
// (a snow day, a non-default year with its break and its follower) is removed at the end, by name.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const RUN = Math.random().toString(36).slice(2, 6);
const SNOW = `Snow day e2e ${RUN}`;
const CAMP = `Summer camp e2e ${RUN}`;
const NAMES: Record<string, string> = {
  school_day: 'School day',
  no_school: 'Day off school',
  break: 'Break',
  weekend: 'Weekend',
  summer: 'Summer',
};

const sql = (q: string) => query(db!, q);

const member = (name: string) =>
  `(select id from public.member where household_id = '${DEMO}' and display_name = '${name}')`;
const dayType = (name: string, date: string) =>
  sql(`select public.resolve_day_type(${member(name)}, '${date}')`);

/** The next school day after tomorrow in a demo default year, and that year. */
function nextSchoolDay(today: string): { yearId: string; date: string } {
  const [yearId, date] =
    sql(`select y.id, d.day from public.school_year y, public.school_year_days(y.id) d
     where y.household_id = '${DEMO}' and y.is_default and y.archived_at is null
       and d.day > '${today}'::date + 1 and d.day_type = 'school_day' order by d.day limit 1`).split(
      '|',
    );
  return { yearId: yearId!, date: date! };
}

/** Takes away what this spec adds; the camp year's break and follower go with it. */
const tidy = () =>
  sql(`delete from public.school_closure where household_id = '${DEMO}' and name = '${SNOW}';
       delete from public.school_year where household_id = '${DEMO}' and name = '${CAMP}';`);

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex' }).click();
  await page.waitForURL(/\/admin/);
  await openSetting(page, 'School');
  await expect(page.getByRole('heading', { name: 'School year', level: 1 })).toBeVisible();
}

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

// The family's day, read once for the file, and the next school day after tomorrow from it.
let today = '';
let next = { yearId: '', date: '' };

test.beforeAll(() => {
  today = householdToday(db!);
  next = nextSchoolDay(today);
});

test.afterAll(() => {
  tidy();
});

test('[SCH-01][SCH-02] the demo family’s school years, and what kind of day today is for each member', async ({
  page,
}) => {
  await signIn(page);
  const years = page.getByRole('list', { name: 'School years', exact: true });
  for (const name of sql(
    `select string_agg(name, '|' order by start_date) from public.school_year
      where household_id = '${DEMO}' and is_default and archived_at is null`,
  ).split('|')) {
    await expect(years.getByRole('listitem').filter({ hasText: name })).toContainText('Default');
  }
  const forEach = page.getByRole('list', { name: 'Today for each member' });
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) {
    const type = dayType(name, today);
    await expect(forEach.getByRole('listitem').filter({ hasText: name })).toContainText(
      NAMES[type]!,
    );
  }
  await expectContrastOk(page);
});

test('[SCH-01] a school year’s timeline counts its school days, breaks and days off', async ({
  page,
}) => {
  await signIn(page);
  const year = sql(
    `select name from public.school_year where id = '0de00000-0000-4000-8000-0000000b0001'`,
  );
  await page.getByRole('link', { name: `Open ${year}` }).click();
  await expect(page.getByRole('heading', { name: year, level: 1 })).toBeVisible();
  const counts = Object.fromEntries(
    sql(
      `select day_type || '=' || count(*) from public.school_year_days('0de00000-0000-4000-8000-0000000b0001') group by day_type`,
    )
      .split('\n')
      .map((l) => l.split('=')),
  );
  await expect(page.getByTestId('day-counts')).toContainText(`${counts.school_day} school days`);
  await expect(page.getByTestId('day-counts')).toContainText(`${counts.break} break days`);
  const closures = page.getByRole('list', { name: 'Breaks and days off' });
  for (const name of [
    'Teacher planning day',
    'Thanksgiving break',
    'Winter break',
    'Spring break',
    'Memorial Day',
  ]) {
    await expect(closures).toContainText(name);
  }
  await expect(closures.getByRole('listitem').filter({ hasText: 'Winter break' })).toContainText(
    'Break ·',
  );
  await expectContrastOk(page);
});

test('[SCH-01][SCH-02][SCH-03] a snow day added for a coming school day makes it a day off and takes its school-day chores off; removing it undoes that', async ({
  page,
}) => {
  const { yearId, date } = next;
  expect(dayType('Maya', date)).toBe('school_day');
  // Homework (school days only) is planned up to the horizon the last planning reached (14 days from
  // then; previews run no jobs): the last day the daily bed is planned for. Past it, nothing to check.
  const planned =
    sql(`select '${date}'::date <= max(due_date) from public.chore_occurrence
          where chore_id = '${MAKE_BED}'`) === 't';
  const homework = () =>
    sql(
      `select count(*) from public.chore_occurrence where chore_id = '0de00000-0000-4000-8000-0000000c0005' and due_date = '${date}'`,
    );
  if (planned) expect(homework()).toBe('1');
  await signIn(page);
  await page.goto(`/admin/school/${yearId}`);
  const form = page.getByRole('form', { name: 'Add a day off' });
  await form.getByLabel('Name').fill(SNOW);
  await form.getByLabel('Kind').selectOption('Snow day');
  await form.getByLabel('From').fill(date);
  await form.getByRole('button', { name: 'Add day off' }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved ${SNOW}.`);
  await expect(page.getByRole('list', { name: 'Breaks and days off' })).toContainText(SNOW);
  expect(dayType('Maya', date)).toBe('no_school');
  expect(dayType('Alex', date)).toBe('no_school');
  if (planned) expect(homework()).toBe('0');

  // Removing re-renders the year's page with no status line: the day off leaving the list is the
  // sign the server has removed it.
  await page.getByRole('button', { name: `Remove ${SNOW}` }).click();
  await expect(page.getByRole('list', { name: 'Breaks and days off' })).not.toContainText(SNOW);
  expect(dayType('Maya', date)).toBe('school_day');
  if (planned) expect(homework()).toBe('1');
});

test('[SCH-01][SCH-02] two default school years may not overlap; one that isn’t the default may, and a child who follows it gets its calendar until it is archived', async ({
  page,
}) => {
  // Four saves and an archive, each a server action that a preview can take several seconds to
  // answer (more than 30 s together seen on #37), plus two sign-ins: up to about 60 s; 3x that.
  test.setTimeout(180_000);
  const { date } = next;
  const end = sql(`select ('${date}'::date + 30)::text`);
  const years = () =>
    Number(
      sql(
        `select count(*) from public.school_year where household_id = '${DEMO}' and archived_at is null`,
      ),
    );
  await test.step('two default school years may not overlap; one that isn’t the default may', async () => {
    const before = years();
    await signIn(page);
    const form = page.getByRole('form', { name: 'Add a school year' });
    await form.getByLabel('Name', { exact: true }).fill(CAMP);
    await form.getByLabel('First day').fill(date);
    await form.getByLabel('Last day').fill(end);
    await expect(form.getByRole('switch', { name: 'Default' })).toBeChecked();
    await form.getByRole('button', { name: 'Add school year' }).click();
    await expect(form.getByRole('status')).toContainText(
      'Another default school year covers some of these dates',
    );
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue(CAMP);

    await form.getByRole('switch', { name: 'Default' }).uncheck();
    await form.getByRole('button', { name: 'Add school year' }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved ${CAMP}.`);
    await expect(page.getByRole('heading', { name: CAMP, level: 1 })).toBeVisible();
    expect(years()).toBe(before + 1);
  });

  await test.step('a child at another school follows its calendar; archiving it puts them back on the default', async () => {
    const camp = sql(
      `select id from public.school_year where household_id = '${DEMO}' and name = '${CAMP}'`,
    );
    // Still signed in from the step before: /sign-in would send a signed-in parent on to Home.
    await page.goto(`/admin/school/${camp}`);
    const closure = page.getByRole('form', { name: 'Add a day off' });
    await closure.getByLabel('Name').fill('Camp break');
    await closure.getByLabel('Kind').selectOption('Break');
    await closure.getByLabel('From').fill(date);
    await closure.getByRole('button', { name: 'Add day off' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved Camp break.');

    const who = page.getByRole('form', { name: 'Who follows this school year' });
    await who.getByRole('checkbox', { name: 'Leo', exact: true }).check();
    await who.getByRole('button', { name: 'Save who follows it' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved who follows this school year.');
    expect(dayType('Leo', date)).toBe('break');
    expect(dayType('Maya', date)).toBe('school_day');

    await page.getByRole('button', { name: `Archive ${CAMP}` }).click();
    await page.waitForURL(/\/admin\/school$/);
    await expect(page.getByRole('list', { name: 'Archived school years' })).toContainText(CAMP);
    expect(dayType('Leo', date)).toBe('school_day');
  });
});
