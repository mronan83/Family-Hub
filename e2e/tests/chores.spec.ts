import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13] The family list on the preview, as the demo family
// (D-37): the seeded list, entering a family's list on a phone, tags, time of day, archive, and
// private items that the other parent never sees. The database is read with psql to confirm what
// was saved.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const SEEDED_CHORES = '0de00000-0000-4000-8000-0000000c%';
const SEEDED_TAGS = '0de00000-0000-4000-8000-0000000a%';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

/** A date in the demo family's time zone, `days` from today, as "YYYY-MM-DD". */
function demoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

const TODAY = `(now() at time zone 'America/New_York')::date`;

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

async function signIn(page: Page, who: 'Alex' | 'Sam') {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: `Sign in as ${who}` }).click();
  await page.waitForURL(/\/admin/);
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Chores' })
    .click();
  await expect(page.getByRole('heading', { name: 'Chores and tasks', level: 1 })).toBeVisible();
}

const list = (page: Page) => page.getByRole('list', { name: 'Chores and tasks' });

/** Picks an option in a picker whose radio is visually hidden (the icon grid, tag colors). */
async function pick(form: Locator, name: string) {
  const label = form.locator('label', {
    has: form.page().getByRole('radio', { name, exact: true }),
  });
  if (!(await label.isVisible())) await form.getByText('More icons').click();
  await label.click();
}

interface Entry {
  title: string;
  people: string[];
  icon: string;
  time?: string;
  weekdays?: string[];
  onDate?: string;
}

async function enter(form: Locator, e: Entry) {
  await form.getByLabel('Name', { exact: true }).fill(e.title);
  for (const p of e.people) await form.getByRole('checkbox', { name: p, exact: true }).check();
  if (e.weekdays) {
    await form.getByLabel('Some days', { exact: true }).check();
    const days = form.getByRole('group', { name: 'Days of the week' });
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await days.getByRole('checkbox', { name: d }).setChecked(e.weekdays.includes(d));
    }
  }
  if (e.onDate) await form.getByLabel('Due date').fill(e.onDate);
  if (e.time) await form.getByLabel('Due time').fill(e.time);
  await pick(form, e.icon);
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  // A retry starts from the seeded list (supabase/seed.sql).
  sql(`delete from public.chore where household_id = '${DEMO}' and id::text not like '${SEEDED_CHORES}';
       delete from public.tag where household_id = '${DEMO}' and id::text not like '${SEEDED_TAGS}';
       update public.tag set archived_at = null, name = case id::text
           when '0de00000-0000-4000-8000-0000000a0001' then 'Morning'
           when '0de00000-0000-4000-8000-0000000a0002' then 'Kitchen'
           when '0de00000-0000-4000-8000-0000000a0003' then 'Bedroom'
           else 'School' end
        where household_id = '${DEMO}';
       update public.chore set archived_at = null where household_id = '${DEMO}';`);
});

test('[CHR-01][CHR-13] Alex sees the family list, but not Sam’s private gift', async ({ page }) => {
  await signIn(page, 'Alex');
  for (const title of [
    'Make bed',
    'Homework',
    'Feed the dog',
    'Pay the school trip fee',
    'Book the dentist',
  ]) {
    await expect(list(page)).toContainText(title);
  }
  await expect(list(page)).not.toContainText('Buy anniversary gift');
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Feed the dog' })).toContainText(
    'Chore · Every day · 5:00 pm · 5 points',
  );
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Feed the dog' })).toContainText(
    'Maya and Alex',
  );
  await expectContrastOk(page);

  const gift = sql(
    `select id from public.chore where household_id = '${DEMO}' and title = 'Buy anniversary gift'`,
  );
  const response = await page.goto(`/admin/chores/${gift}`);
  expect(response?.status()).toBe(404);
});

test('[CHR-13] Sam sees the gift they’re responsible for, marked private', async ({ page }) => {
  await signIn(page, 'Sam');
  const gift = list(page).getByRole('listitem').filter({ hasText: 'Buy anniversary gift' });
  await expect(gift).toContainText('Private');
  await expect(gift).toContainText('Task · Due');
  await expectContrastOk(page);
});

test('[CHR-01][CHR-09][CHR-11] a parent enters the family’s list on a phone in under five minutes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const started = Date.now();
  await signIn(page, 'Alex');
  await page.getByRole('link', { name: 'Add a chore' }).click();
  let form = page.getByRole('form', { name: 'Add an item' });
  await expectContrastOk(page);

  const chores: Entry[] = [
    { title: 'Unload the dishwasher', people: ['Maya'], icon: 'dishes', time: '18:00' },
    { title: 'Water the plants', people: ['Leo'], icon: 'plant', weekdays: ['Sat'] },
    { title: 'Tidy toys', people: ['Leo'], icon: 'toys', time: '19:00' },
    {
      title: 'Pack school bag',
      people: ['Maya'],
      icon: 'pack',
      time: '07:15',
      weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    },
    { title: 'Practice piano', people: ['Maya'], icon: 'music', time: '16:30' },
    { title: 'Put shoes away', people: ['Maya', 'Leo'], icon: 'shoes' },
  ];
  for (const c of chores) {
    await enter(form, c);
    await form.getByRole('button', { name: 'Save and add another' }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved ${c.title}. Add the next one.`);
    form = page.getByRole('form', { name: 'Add an item' });
  }

  // The adults' tasks: switching to Task makes it a one-off with no points.
  await form.getByLabel('Task', { exact: true }).check();
  await expect(form.getByRole('textbox', { name: /^Points/ })).toHaveValue('0');
  await enter(form, {
    title: 'Renew car insurance',
    people: ['Alex'],
    icon: 'calendar',
    onDate: demoDate(5),
  });
  await form.getByRole('button', { name: 'Save and add another' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Renew car insurance. Add the next one.');
  form = page.getByRole('form', { name: 'Add an item' });
  await expect(form.getByLabel('Task', { exact: true })).toBeChecked();
  await enter(form, {
    title: 'Order school uniform',
    people: ['Sam'],
    icon: 'backpack',
    onDate: demoDate(2),
  });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Order school uniform.');

  const seconds = Math.round((Date.now() - started) / 1000);
  report(
    `WP-08: the family list (six chores and two adult tasks) entered on a 390 px phone screen in ${seconds} s (target under 300 s).`,
  );
  expect(seconds).toBeLessThan(300);

  expect(
    sql(`select string_agg(c.title || ':' || c.kind || ':' || c.points || ':' || coalesce(left(c.due_time::text, 5), '-')
                           || ':' || (c.schedule ->> 'freq') || ':' || c.icon || ':' || c.assignment || ':'
                           || (select string_agg(m.display_name, '+' order by m.display_name)
                                 from public.chore_assignee a join public.member m on m.id = a.member_id
                                where a.chore_id = c.id), ',' order by c.title)
           from public.chore c
          where c.household_id = '${DEMO}' and c.id::text not like '${SEEDED_CHORES}'`),
  ).toBe(
    [
      'Order school uniform:task:0:-:once:backpack:shared:Sam',
      'Pack school bag:chore:5:07:15:weekly:chore-pack:each:Maya',
      'Practice piano:chore:5:16:30:daily:chore-music:each:Maya',
      'Put shoes away:chore:5:-:daily:chore-shoes:each:Leo+Maya',
      'Renew car insurance:task:0:-:once:calendar:shared:Alex',
      'Tidy toys:chore:5:19:00:daily:chore-toys:each:Leo',
      'Unload the dishwasher:chore:5:18:00:daily:chore-dishes:each:Maya',
      'Water the plants:chore:5:-:weekly:chore-plant:each:Leo',
    ].join(','),
  );
  expect(
    sql(
      `select schedule::text from public.chore where household_id = '${DEMO}' and title = 'Pack school bag'`,
    ),
  ).toBe('{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}');
  expect(
    sql(
      `select schedule ->> 'on_date' from public.chore where household_id = '${DEMO}' and title = 'Order school uniform'`,
    ),
  ).toBe(demoDate(2));
});

test('[CHR-03][CHR-09] a new item has its next two weeks planned, for the people it’s for', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Tidy toys' })).toContainText(
    'Next: Today',
  );
  await page.getByRole('link', { name: 'Edit Tidy toys' }).click();
  const comingUp = page.getByRole('list', { name: 'Coming up' });
  await expect(comingUp.getByRole('listitem')).toHaveCount(15);
  await expect(comingUp.getByRole('listitem').first()).toContainText('Today');
  await expect(comingUp.getByRole('listitem').nth(1)).toContainText('Tomorrow');
  await expect(comingUp.getByRole('listitem').first()).toContainText('Leo');
  expect(
    sql(`select count(*) || ':' || count(distinct o.due_date) || ':' || bool_or(o.due_date = ${TODAY}::date)::text
           from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${DEMO}' and c.title = 'Tidy toys'
            and o.due_date between ${TODAY} and ${TODAY} + 14`),
  ).toBe('15:15:true');

  // Saturdays only: the plan follows the schedule.
  await page.goto('/admin/chores');
  await page.getByRole('link', { name: 'Edit Water the plants' }).click();
  const saturdays = Number(
    sql(
      `select count(*) from generate_series(${TODAY}, ${TODAY} + 14, interval '1 day') d where extract(isodow from d) = 6`,
    ),
  );
  await expect(page.getByRole('list', { name: 'Coming up' }).getByRole('listitem')).toHaveCount(
    saturdays,
  );
});

test('[CHR-12] a task entered after its date is open and shows as overdue', async ({ page }) => {
  await signIn(page, 'Alex');
  await page.getByRole('link', { name: 'Add a task' }).click();
  const form = page.getByRole('form', { name: 'Add an item' });
  await enter(form, {
    title: 'Return the library books',
    people: ['Alex'],
    icon: 'read',
    onDate: demoDate(-3),
  });
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Return the library books.');
  await expect(
    list(page).getByRole('listitem').filter({ hasText: 'Return the library books' }),
  ).toContainText('Overdue since');
  expect(
    sql(`select o.due_date::text || ':' || o.status from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${DEMO}' and c.title = 'Return the library books'`),
  ).toBe(`${demoDate(-3)}:scheduled`);
});

test('[CHR-11] the list filters by time of day, person and kind', async ({ page }) => {
  await signIn(page, 'Alex');
  const filters = page.getByRole('form', { name: 'Filter the list' });
  await filters.getByLabel('Time of day').selectOption('Morning');
  await filters.getByRole('button', { name: 'Filter' }).click();
  // Chores by due time: 7:15, 7:30, 7:45.
  await expect(list(page).getByRole('listitem')).toHaveText([
    /Pack school bag/,
    /Make bed/,
    /Brush teeth/,
  ]);

  await page.goto('/admin/chores');
  await filters.getByLabel('Person').selectOption('Sam');
  await filters.getByLabel('Kind').selectOption('Tasks');
  await filters.getByRole('button', { name: 'Filter' }).click();
  // Sam's private gift is not Alex's to see.
  await expect(list(page).getByRole('listitem')).toHaveText([
    /Book the dentist/,
    /Order school uniform/,
  ]);
});

test('[CHR-10] a household tag: apply, filter, rename and archive (US-312)', async ({ page }) => {
  await signIn(page, 'Alex');
  await page.getByRole('link', { name: 'Tags', exact: true }).click();
  const add = page.getByRole('form', { name: 'Add a tag' });
  await add.getByLabel('Name').fill('Tidy-up');
  await pick(add, 'Green');
  await pick(add, 'toys');
  await add.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Tidy-up.');
  await expectContrastOk(page);

  for (const title of ['Tidy toys', 'Put shoes away', 'Make bed']) {
    await page.goto('/admin/chores');
    await page.getByRole('link', { name: `Edit ${title}` }).click();
    const form = page.getByRole('form', { name: 'Edit item' });
    await form.getByRole('checkbox', { name: 'Tidy-up' }).check();
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved ${title}.`);
  }

  const filters = page.getByRole('form', { name: 'Filter the list' });
  await filters.getByLabel('Tag').selectOption('Tidy-up');
  await filters.getByRole('button', { name: 'Filter' }).click();
  await expect(list(page).getByRole('listitem')).toHaveText([
    /Make bed/,
    /Tidy toys/,
    /Put shoes away/,
  ]);
  const filtered = page.url();

  // Renaming keeps the same three: items and filters hold the tag's id.
  await page.goto('/admin/tags');
  const row = page
    .getByRole('list', { name: 'Tags' })
    .getByRole('listitem')
    .filter({ hasText: 'Tidy-up' });
  await row.getByText('Edit Tidy-up').click();
  const edit = row.getByRole('form', { name: 'Edit Tidy-up' });
  await edit.getByLabel('Name').fill('Tidy-up time');
  await edit.getByRole('button', { name: 'Save tag' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Tidy-up time.');
  await page.goto(filtered);
  await expect(list(page).getByRole('listitem')).toHaveText([
    /Make bed/,
    /Tidy toys/,
    /Put shoes away/,
  ]);
  await expect(list(page)).toContainText('Tidy-up time');

  // Archived: no longer offered on an item, but the items keep it for goals and history.
  await page.goto('/admin/tags');
  const renamed = page
    .getByRole('list', { name: 'Tags' })
    .getByRole('listitem')
    .filter({ hasText: 'Tidy-up time' });
  await renamed.getByText('Edit Tidy-up time').click();
  await renamed.getByRole('button', { name: 'Archive Tidy-up time' }).click();
  await expect(page.getByRole('list', { name: 'Archived tags' })).toContainText('Tidy-up time');
  await page.goto('/admin/chores');
  await page.getByRole('link', { name: 'Edit Tidy toys' }).click();
  await expect(
    page.getByRole('form', { name: 'Edit item' }).getByRole('checkbox', { name: 'Tidy-up time' }),
  ).toHaveCount(0);
  await expect(page.getByText('Also tagged Tidy-up time (archived)')).toBeVisible();
  expect(
    sql(`select count(*) from public.chore_tag ct join public.tag t on t.id = ct.tag_id
          where t.household_id = '${DEMO}' and t.name = 'Tidy-up time'`),
  ).toBe('3');
});

test('[CHR-13] a private task stays with its creator, and reaches the other parent only if it’s theirs', async ({
  browser,
}) => {
  const alex = await (await browser.newContext()).newPage();
  await signIn(alex, 'Alex');
  for (const [title, who] of [
    ['Plan the birthday surprise', 'Alex'],
    ['Pick up the cake', 'Sam'],
  ] as const) {
    await alex.getByRole('link', { name: 'Add a task' }).click();
    const form = alex.getByRole('form', { name: 'Add an item' });
    await enter(form, { title, people: [who], icon: 'gift', onDate: demoDate(4) });
    await form.getByRole('switch', { name: 'Private' }).check();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(alex.getByRole('status')).toHaveText(`Saved ${title}.`);
    await expect(list(alex).getByRole('listitem').filter({ hasText: title })).toContainText(
      'Private',
    );
  }

  const sam = await (await browser.newContext()).newPage();
  await signIn(sam, 'Sam');
  await expect(list(sam)).toContainText('Pick up the cake');
  await expect(list(sam)).not.toContainText('Plan the birthday surprise');
  const surprise = sql(
    `select id from public.chore where household_id = '${DEMO}' and title = 'Plan the birthday surprise'`,
  );
  expect((await sam.goto(`/admin/chores/${surprise}`))?.status()).toBe(404);

  // Sam can't make a family item private: only its creator (Alex) is offered the switch.
  await sam.goto('/admin/chores');
  await sam.getByRole('link', { name: 'Edit Make bed' }).click();
  await expect(sam.getByRole('switch', { name: 'Private' })).toHaveCount(0);
  await expect(
    sam.getByText('Only the person who created this item can make it private.'),
  ).toBeVisible();
});

test('[CHR-01] an item is archived and restored, never deleted', async ({ page }) => {
  await signIn(page, 'Alex');
  await page.getByRole('link', { name: 'Edit Practice piano' }).click();
  await page.getByRole('button', { name: 'Archive Practice piano' }).click();
  // Each action redirects when it has saved; wait for that before reading or moving on.
  await page.waitForURL(/\/admin\/chores$/);
  await expect(list(page)).not.toContainText('Practice piano');

  const filters = page.getByRole('form', { name: 'Filter the list' });
  await filters.getByLabel('Show').selectOption('Archived');
  await filters.getByRole('button', { name: 'Filter' }).click();
  await expect(list(page).getByRole('listitem')).toHaveText([/Practice piano/]);
  await page.getByRole('link', { name: 'Edit Practice piano' }).click();
  await page.getByRole('button', { name: 'Restore Practice piano' }).click();
  await page.waitForURL(/\/admin\/chores\?status=archived$/);
  await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
  await page.goto('/admin/chores');
  await expect(list(page)).toContainText('Practice piano');
  expect(
    sql(`select count(*) from public.audit_log where household_id = '${DEMO}' and entity_type = 'chore' and action = 'update'
          and diff ? 'archived_at' and chore_id = (select id from public.chore where household_id = '${DEMO}' and title = 'Practice piano')`),
  ).toBe('2');
});

test('[CHR-07][CHR-18] an item’s page shows its last seven days: each child’s own bed, and the days each missed', async ({
  page,
}) => {
  // The demo family's seeded week (supabase/seed.sql): each makes their own bed (D-47); Leo missed
  // yesterday and Maya three days ago.
  await signIn(page, 'Alex');
  await page.goto('/admin/chores/0de00000-0000-4000-8000-0000000c0001');
  const week = page.getByRole('list', { name: 'Last 7 days', exact: true });
  await expect(week.getByRole('listitem')).toHaveCount(7);
  const yesterday = week.getByRole('listitem').first();
  await expect(yesterday).toContainText('Yesterday');
  await expect(yesterday).toContainText('Maya: done');
  await expect(yesterday).toContainText('Leo: missed');
  await expect(week.getByRole('listitem').nth(2)).toContainText('Maya: missed');
  await expect(week.getByRole('listitem').nth(2)).toContainText('Leo: done');
  expect(
    sql(`select string_agg(m.display_name || '=' || o.status, ',' order by o.due_date desc, m.display_name)
           from public.chore_occurrence o join public.member m on m.id = o.member_id
          where o.chore_id = '0de00000-0000-4000-8000-0000000c0001' and o.due_date in (${TODAY} - 1, ${TODAY} - 3)`),
  ).toBe('Leo=missed,Maya=completed,Leo=completed,Maya=missed');
  await expectContrastOk(page);
});

test('[CHR-18] several people: everyone does their own by default for a chore; switching to any one of them makes one a day', async ({
  page,
}) => {
  // Put shoes away (Maya and Leo) was entered above, as a chore: each their own.
  const perDay = () =>
    sql(`select count(*) || ':' || count(distinct o.due_date) from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${DEMO}' and c.title = 'Put shoes away' and o.due_date between ${TODAY} and ${TODAY} + 14`);
  expect(perDay()).toBe('30:15');
  await signIn(page, 'Alex');
  await expect(
    list(page).getByRole('listitem').filter({ hasText: 'Put shoes away' }),
  ).toContainText('each their own');
  await page.getByRole('link', { name: 'Edit Put shoes away' }).click();
  await expect(
    page.getByRole('list', { name: 'Coming up' }).getByRole('listitem').first(),
  ).toContainText('each their own');
  const form = page.getByRole('form', { name: 'Edit item' });
  await expect(form.getByRole('radio', { name: 'Everyone does their own' })).toBeChecked();
  await form.getByRole('radio', { name: 'Any one of them' }).check();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Put shoes away.');
  expect(perDay()).toBe('15:15');
  await expect(
    list(page).getByRole('listitem').filter({ hasText: 'Put shoes away' }),
  ).not.toContainText('each their own');

  // With one person the question is not asked.
  await page.getByRole('link', { name: 'Edit Tidy toys' }).click();
  await expect(
    page.getByRole('form', { name: 'Edit item' }).getByRole('radio', { name: 'Any one of them' }),
  ).toHaveCount(0);
});
