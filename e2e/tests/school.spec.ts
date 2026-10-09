import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [SCH-01][SCH-02][SCH-03] School years on the preview, as the demo family (D-37): the seeded year and
// next year's, today's day type for each member, the timeline, days off, overlapping defaults, and a
// child who follows another school's calendar. Dates come from the database, so the spec works on
// any day of the year. The database is read with psql to confirm what was saved.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const SEEDED_YEARS = '0de00000-0000-4000-8000-0000000b%';
const NAMES: Record<string, string> = {
  school_day: 'School day',
  no_school: 'Day off school',
  break: 'Break',
  weekend: 'Weekend',
  summer: 'Summer',
};

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const TODAY = `(now() at time zone 'America/New_York')::date`;
const member = (name: string) =>
  `(select id from public.member where household_id = '${DEMO}' and display_name = '${name}')`;
const dayType = (name: string, date: string) =>
  sql(`select public.resolve_day_type(${member(name)}, '${date}')`);

/** The next school day after tomorrow in a demo default year, and that year. */
function nextSchoolDay(): { yearId: string; date: string } {
  const [yearId, date] =
    sql(`select y.id, d.day from public.school_year y, public.school_year_days(y.id) d
     where y.household_id = '${DEMO}' and y.is_default and y.archived_at is null
       and d.day > ${TODAY} + 1 and d.day_type = 'school_day' order by d.day limit 1`).split('|');
  return { yearId: yearId!, date: date! };
}

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
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'School' })
    .click();
  await expect(page.getByRole('heading', { name: 'School year', level: 1 })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  // A retry starts from the seeded school years (supabase/seed.sql).
  sql(`delete from public.school_year where household_id = '${DEMO}' and id::text not like '${SEEDED_YEARS}';
       delete from public.school_closure where household_id = '${DEMO}' and name = 'Test snow day';
       delete from public.member_school_profile where household_id = '${DEMO}';
       update public.school_year set archived_at = null where household_id = '${DEMO}';`);
});

test('[SCH-01][SCH-02] the demo family’s school years, and what kind of day today is for each member', async ({
  page,
}) => {
  await signIn(page);
  const years = page.getByRole('list', { name: 'School years', exact: true });
  for (const name of sql(
    `select string_agg(name, '|' order by start_date) from public.school_year where household_id = '${DEMO}'`,
  ).split('|')) {
    await expect(years.getByRole('listitem').filter({ hasText: name })).toContainText('Default');
  }
  const today = page.getByRole('list', { name: 'Today for each member' });
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) {
    const type = sql(`select public.resolve_day_type(${member(name)}, ${TODAY})`);
    await expect(today.getByRole('listitem').filter({ hasText: name })).toContainText(NAMES[type]!);
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

test('[SCH-01][SCH-02] a snow day added for a coming school day makes it a day off; removing it undoes that', async ({
  page,
}) => {
  const { yearId, date } = nextSchoolDay();
  expect(dayType('Maya', date)).toBe('school_day');
  await signIn(page);
  await page.goto(`/admin/school/${yearId}`);
  const form = page.getByRole('form', { name: 'Add a day off' });
  await form.getByLabel('Name').fill('Test snow day');
  await form.getByLabel('Kind').selectOption('Snow day');
  await form.getByLabel('From').fill(date);
  await form.getByRole('button', { name: 'Add day off' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Test snow day.');
  await expect(page.getByRole('list', { name: 'Breaks and days off' })).toContainText(
    'Test snow day',
  );
  expect(dayType('Maya', date)).toBe('no_school');
  expect(dayType('Alex', date)).toBe('no_school');

  await page.getByRole('button', { name: 'Remove Test snow day' }).click();
  await page.waitForURL(new RegExp(`/admin/school/${yearId}$`));
  await expect(page.getByRole('list', { name: 'Breaks and days off' })).not.toContainText(
    'Test snow day',
  );
  expect(dayType('Maya', date)).toBe('school_day');
});

test('[SCH-01] two default school years may not overlap; one that isn’t the default may', async ({
  page,
}) => {
  const { date } = nextSchoolDay();
  const end = sql(`select ('${date}'::date + 30)::text`);
  await signIn(page);
  const form = page.getByRole('form', { name: 'Add a school year' });
  await form.getByLabel('Name', { exact: true }).fill('Summer camp');
  await form.getByLabel('First day').fill(date);
  await form.getByLabel('Last day').fill(end);
  await expect(form.getByRole('switch', { name: 'Default' })).toBeChecked();
  await form.getByRole('button', { name: 'Add school year' }).click();
  await expect(form.getByRole('status')).toContainText(
    'Another default school year covers some of these dates',
  );
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Summer camp');

  await form.getByRole('switch', { name: 'Default' }).uncheck();
  await form.getByRole('button', { name: 'Add school year' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Summer camp.');
  await expect(page.getByRole('heading', { name: 'Summer camp', level: 1 })).toBeVisible();
  expect(
    sql(
      `select count(*) from public.school_year where household_id = '${DEMO}' and archived_at is null`,
    ),
  ).toBe('3');
});

test('[SCH-02] a child at another school follows its calendar; archiving it puts them back on the default', async ({
  page,
}) => {
  const { date } = nextSchoolDay();
  const camp = sql(
    `select id from public.school_year where household_id = '${DEMO}' and name = 'Summer camp'`,
  );
  await signIn(page);
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

  await page.getByRole('button', { name: 'Archive Summer camp' }).click();
  await page.waitForURL(/\/admin\/school$/);
  await expect(page.getByRole('list', { name: 'Archived school years' })).toContainText(
    'Summer camp',
  );
  expect(dayType('Leo', date)).toBe('school_day');
});
