import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '../support/test';
import { openFromMenu } from '../support/settings';
import { foldOf, unfold } from '../support/fold';
import { addDays, householdToday } from '../support/day';
import { withSchoolDays } from '../support/school';
import { signIn as signInAs } from '../support/session';
import { ownHousehold } from '../support/household';

// [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13] The family list on the preview, as the demo family
// (D-37): the seeded list, entering a family's list on a phone, tags, time of day, archive, and
// private items that the other parent never sees. The database is read with psql to confirm what
// was saved.
const family = ownHousehold('chores');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const SEEDED_CHORES = family.own('0de00000-0000-4000-8000-0000000c%');
const SEEDED_TAGS = family.own('0de00000-0000-4000-8000-0000000a%');

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

// [D-110] The demo family's today, read once from the database in beforeAll (never the runner's
// clock), and every date of the file counted from it.
let today = '';
let TODAY = '';
/** A date in the demo family's time zone, `days` from today, as "YYYY-MM-DD". */
const demoDate = (days: number) => addDays(today, days);
/** A date as the list writes it: "Mon, Oct 12". */
const calendarDay = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

// [D-110] Each test makes its own items and takes them away after itself, pass or fail (afterEach):
// the ones it entered in the app (by title, made since it began) and any tag it added. Items a test
// needs but doesn't test entering are put straight into the database, with a suffix of this run.
const ALEX_USER = family.own('0de00000-0000-4000-8000-0000000000a1');
const RUN = Math.random().toString(36).slice(2, 6);
let since = '';
const made: string[] = [];
const quoted = (s: string) => `'${s.replace(/'/g, "''")}'`;

function removeMade() {
  const titles = made.map(quoted).join(', ');
  made.length = 0;
  // An item with history is never deleted (D-46): it is archived, out of the lists.
  if (titles)
    sql(`delete from public.chore c where c.household_id = '${HOUSEHOLD}' and c.title in (${titles})
            and c.created_at >= '${since}' and c.id::text not like '${SEEDED_CHORES}'
            and not exists (select from public.chore_occurrence o
                              join public.chore_completion_event e on e.occurrence_id = o.id
                             where o.chore_id = c.id);
         update public.chore set archived_at = now()
          where household_id = '${HOUSEHOLD}' and title in (${titles}) and created_at >= '${since}'
            and id::text not like '${SEEDED_CHORES}' and archived_at is null;`);
  sql(`delete from public.tag where household_id = '${HOUSEHOLD}' and created_at >= '${since}'
         and id::text not like '${SEEDED_TAGS}'`);
}

interface Fixture {
  title: string;
  people: string[];
  icon: string;
  kind?: 'chore' | 'task';
  time?: string;
  weekdays?: number[];
  onDate?: string;
  assignment?: 'each' | 'shared';
}

/** An item as the app saves it (Alex made it, starting today), straight into the database. */
function fixture(f: Fixture): string {
  made.push(f.title);
  const schedule = f.onDate
    ? { freq: 'once', on_date: f.onDate }
    : f.weekdays
      ? { freq: 'weekly', by_weekday: f.weekdays }
      : { freq: 'daily' };
  const kind = f.kind ?? 'chore';
  return sql(`with c as (
                insert into public.chore (household_id, title, icon, kind, points, schedule, due_time,
                                          created_by, start_date, assignment)
                values ('${HOUSEHOLD}', ${quoted(f.title)}, '${f.icon}', '${kind}', ${kind === 'task' ? 0 : 5},
                        '${JSON.stringify(schedule)}'::jsonb, ${f.time ? `'${f.time}'` : 'null'},
                        '${ALEX_USER}', ${TODAY}, '${f.assignment ?? (kind === 'task' ? 'shared' : 'each')}')
                returning id),
              a as (
                insert into public.chore_assignee (household_id, chore_id, member_id)
                select '${HOUSEHOLD}', c.id, m.id from c join public.member m
                    on m.household_id = '${HOUSEHOLD}' and m.display_name in (${f.people.map(quoted).join(', ')}))
              select id from c`);
}

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
  await signInAs(page, who);
  await openFromMenu(page, 'Chores');
  await expect(page.getByRole('heading', { name: 'Chores and tasks', level: 1 })).toBeVisible();
}

// [CHR-21] The list is four sections of two-line rows (WP-96): `list` is the page, `rowsOf` its
// rows, `row` one of them by its title, `openItem` taps its name; a row's ⋯ holds Edit, Duplicate
// and Archive.
const list = (page: Page) => page.getByRole('main');
const rowsOf = (page: Page) => page.locator('li.fw-row');
const row = (page: Page, title: string) => rowsOf(page).filter({ hasText: title });
const openItem = (page: Page, title: string) =>
  page.locator('a.fw-row__name').getByText(title, { exact: true }).click();
/** A row's ⋯, opened, and its menu. */
async function menuOf(page: Page, title: string): Promise<Locator> {
  await page.getByLabel(`More for ${title}`, { exact: true }).click();
  return row(page, title).locator('.fw-row__menu');
}

/**
 * Picks an option in a picker whose radio is visually hidden (the icon grid, tag colors). [NFR-16-g]
 * The icon picker is folded to the icon chosen (WP-100): it is opened by its header first, as a
 * parent taps it. The tag colors are never folded.
 */
async function pick(form: Locator, name: string) {
  const label = form.locator('label', {
    has: form.page().getByRole('radio', { name, exact: true }),
  });
  if (!(await label.isVisible()))
    await unfold(form.locator('details', { has: form.page().locator('.fw-iconpick') }));
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
  // By role: the Reminders choice "At the due time" also carries the words.
  if (e.time) await form.getByRole('textbox', { name: /^Due time/ }).fill(e.time);
  await pick(form, e.icon);
}

/**
 * Saves the form and waits for its banner, timing the save (WP-83): the click's server action, its
 * status and time, then the banner. A slow or refused save says which item and how long it took.
 */
async function save(page: Page, button: Locator, title: string, banner: string, times: string[]) {
  const started = Date.now();
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'],
    { timeout: 30_000 },
  );
  await button.click();
  const res = await answer;
  const ms = Date.now() - started;
  times.push(`${title} ${res.status()} in ${ms} ms`);
  expect(res.status(), `saving ${title}: answered ${res.status()} in ${ms} ms`).toBeLessThan(400);
  await expect(page.getByRole('status'), `saving ${title}: answered in ${ms} ms`).toHaveText(
    banner,
    { timeout: 15_000 },
  );
}
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  today = householdToday(db!);
  TODAY = `'${today}'::date`;
  // A retry starts from the seeded list (supabase/seed.sql). An item another spec made and checked
  // off has history, which is never deleted (D-46): it stays archived, out of the lists.
  sql(`delete from public.chore c where c.household_id = '${HOUSEHOLD}' and c.id::text not like '${SEEDED_CHORES}'
          and not exists (select from public.chore_occurrence o
                            join public.chore_completion_event e on e.occurrence_id = o.id
                           where o.chore_id = c.id);
       update public.chore set archived_at = now()
        where household_id = '${HOUSEHOLD}' and id::text not like '${SEEDED_CHORES}' and archived_at is null;
       delete from public.tag where household_id = '${HOUSEHOLD}' and id::text not like '${SEEDED_TAGS}';
       update public.tag set archived_at = null, name = case id::text
           when '${family.own('0de00000-0000-4000-8000-0000000a0001')}' then 'Morning'
           when '${family.own('0de00000-0000-4000-8000-0000000a0002')}' then 'Kitchen'
           when '${family.own('0de00000-0000-4000-8000-0000000a0003')}' then 'Bedroom'
           else 'School' end
        where household_id = '${HOUSEHOLD}';
       update public.chore set archived_at = null
        where household_id = '${HOUSEHOLD}' and id::text like '${SEEDED_CHORES}';`);
});

test.beforeEach(() => {
  since = sql('select now()');
  made.length = 0;
});

test.afterEach(() => removeMade());

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
  await expect(row(page, 'Feed the dog')).toContainText(
    'Chore Every day · 5:00 pm · Maya, Alex · +5',
  );
  await expectContrastOk(page);

  const gift = sql(
    `select id from public.chore where household_id = '${HOUSEHOLD}' and title = 'Buy anniversary gift'`,
  );
  const response = await page.goto(`/admin/chores/${gift}`);
  expect(response?.status()).toBe(404);
});

test('[CHR-13] Sam sees the gift they’re responsible for, marked private', async ({ page }) => {
  await signIn(page, 'Sam');
  const gift = row(page, 'Buy anniversary gift');
  await expect(gift).toContainText('Private');
  await expect(gift).toContainText('Task Due');
  await expectContrastOk(page);
});

test('[CHR-01][CHR-03][CHR-09][CHR-11][NFR-14-f] a parent enters the family’s list on a phone in under five minutes; each new item has its next two weeks planned', async ({
  page,
}) => {
  // [D-110] The 300 s entry budget is a requirement, so the limit sits above it (and the planning
  // checks after it): a slow entry is reported by the budget, not by the test running out.
  test.setTimeout(360_000);
  const times: string[] = [];
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
  made.push(...chores.map((c) => c.title), 'Renew car insurance', 'Order school uniform');
  for (const c of chores) {
    await enter(form, c);
    await save(
      page,
      form.getByRole('button', { name: 'Save and add another' }),
      c.title,
      `Saved ${c.title}. Add the next one.`,
      times,
    );
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
  await save(
    page,
    form.getByRole('button', { name: 'Save and add another' }),
    'Renew car insurance',
    'Saved Renew car insurance. Add the next one.',
    times,
  );
  form = page.getByRole('form', { name: 'Add an item' });
  await expect(form.getByLabel('Task', { exact: true })).toBeChecked();
  await enter(form, {
    title: 'Order school uniform',
    people: ['Sam'],
    icon: 'backpack',
    onDate: demoDate(2),
  });
  await save(
    page,
    form.getByRole('button', { name: 'Save', exact: true }),
    'Order school uniform',
    'Saved Order school uniform.',
    times,
  );

  const seconds = Math.round((Date.now() - started) / 1000);
  report(
    `WP-08: the family list (six chores and two adult tasks) entered on a 390 px phone screen in ${seconds} s (target under 300 s).`,
  );
  report(`WP-08 saves: ${times.join(', ')}`);
  expect(seconds).toBeLessThan(300);

  expect(
    sql(`select string_agg(c.title || ':' || c.kind || ':' || c.points || ':' || coalesce(left(c.due_time::text, 5), '-')
                           || ':' || (c.schedule ->> 'freq') || ':' || c.icon || ':' || c.assignment || ':'
                           || (select string_agg(m.display_name, '+' order by m.display_name)
                                 from public.chore_assignee a join public.member m on m.id = a.member_id
                                where a.chore_id = c.id), ',' order by c.title)
           from public.chore c
          where c.household_id = '${HOUSEHOLD}' and c.id::text not like '${SEEDED_CHORES}'
            and c.archived_at is null and c.created_at >= '${since}'`),
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
      `select schedule::text from public.chore where household_id = '${HOUSEHOLD}' and title = 'Pack school bag' and archived_at is null`,
    ),
  ).toBe('{"freq": "weekly", "by_weekday": [1, 2, 3, 4, 5]}');
  expect(
    sql(
      `select schedule ->> 'on_date' from public.chore where household_id = '${HOUSEHOLD}' and title = 'Order school uniform' and archived_at is null`,
    ),
  ).toBe(demoDate(2));

  await test.step('[CHR-03][CHR-09] a new item has its next two weeks planned, for the people it’s for', async () => {
    await page.goto('/admin/chores');
    await openItem(page, 'Tidy toys');
    // [NFR-18] Coming up is folded to the next one (WP-96).
    await expect(foldOf(page, 'Coming up')).toContainText('Next: today 7:00 pm, Leo');
    await unfold(foldOf(page, 'Coming up'));
    const comingUp = page.getByRole('list', { name: 'Coming up' });
    await expect(comingUp.getByRole('listitem')).toHaveCount(15);
    await expect(comingUp.getByRole('listitem').first()).toContainText('Today');
    await expect(comingUp.getByRole('listitem').nth(1)).toContainText('Tomorrow');
    await expect(comingUp.getByRole('listitem').first()).toContainText('Leo');
    expect(
      sql(`select count(*) || ':' || count(distinct o.due_date) || ':' || bool_or(o.due_date = ${TODAY}::date)::text
           from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${HOUSEHOLD}' and c.title = 'Tidy toys' and c.archived_at is null
            and o.due_date between ${TODAY} and ${TODAY} + 14`),
    ).toBe('15:15:true');

    // Saturdays only: the plan follows the schedule.
    await page.goto('/admin/chores');
    await openItem(page, 'Water the plants');
    await unfold(foldOf(page, 'Coming up'));
    const saturdays = Number(
      sql(
        `select count(*) from generate_series(${TODAY}, ${TODAY} + 14, interval '1 day') d where extract(isodow from d) = 6`,
      ),
    );
    await expect(page.getByRole('list', { name: 'Coming up' }).getByRole('listitem')).toHaveCount(
      saturdays,
    );
  });
});

test('[CHR-12][CHR-21] a task entered after its date is open and shows as overdue', async ({
  page,
}) => {
  made.push('Return the library books');
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
  // [CHR-21] Under Overdue in Scheduled, its date in the missed colour (WP-96).
  await expect(
    page
      .getByRole('list', { name: 'Overdue', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Return the library books' }),
  ).toContainText(`Due ${calendarDay(demoDate(-3))}`);
  expect(
    sql(`select o.due_date::text || ':' || o.status from public.chore_occurrence o join public.chore c on c.id = o.chore_id
          where c.household_id = '${HOUSEHOLD}' and c.title = 'Return the library books'`),
  ).toBe(`${demoDate(-3)}:scheduled`);
});

test('[CHR-11] the list filters by time of day, person and kind', async ({ page }) => {
  fixture({
    title: `Pack school bag ${RUN}`,
    people: ['Maya'],
    icon: 'chore-pack',
    time: '07:15',
    weekdays: [1, 2, 3, 4, 5],
  });
  fixture({
    title: `Order school uniform ${RUN}`,
    people: ['Sam'],
    icon: 'backpack',
    kind: 'task',
    onDate: demoDate(2),
  });
  await signIn(page, 'Alex');
  // [CHR-21] More filters, applied as tapped (WP-96).
  await unfold(foldOf(page, 'More filters'));
  await page
    .getByRole('group', { name: 'Time of day' })
    .getByRole('link', { name: 'Morning' })
    .click();
  await expect(foldOf(page, 'More filters')).toContainText('Time of day: Morning');
  // Recurring by due time: 7:15, 7:30, 7:45.
  await expect(rowsOf(page).locator('.fw-row__name')).toHaveText([
    /Pack school bag/,
    /Make bed/,
    /Brush teeth/,
  ]);

  await page.goto('/admin/chores');
  const sam = page.getByRole('group', { name: 'Whose' }).getByRole('button', { name: 'Sam' });
  await sam.click();
  await expect(sam).toHaveAttribute('aria-pressed', 'true');
  await unfold(foldOf(page, 'More filters'));
  await page.getByRole('group', { name: 'Kind' }).getByRole('link', { name: 'Tasks' }).click();
  await expect(foldOf(page, 'More filters')).toContainText('Kind: Tasks');
  // Sam's private gift is not Alex's to see.
  const names = rowsOf(page).locator('.fw-row__name');
  await expect(names).toHaveCount(2);
  await expect(names.filter({ hasText: 'Book the dentist' })).toHaveCount(1);
  await expect(names.filter({ hasText: /Order school uniform/ })).toHaveCount(1);
});

test('[CHR-10] a household tag: apply, filter, rename and archive (US-312)', async ({ page }) => {
  // About 15 server round trips (a tag, three saves, a rename, an archive, six page loads): up to
  // about 40 s on a slow preview, so 3x that.
  test.setTimeout(120_000);
  const tidy = `Tidy toys ${RUN}`;
  const shoes = `Put shoes away ${RUN}`;
  fixture({ title: tidy, people: ['Leo'], icon: 'chore-toys', time: '19:00' });
  fixture({ title: shoes, people: ['Maya', 'Leo'], icon: 'chore-shoes' });
  const times: string[] = [];
  await signIn(page, 'Alex');
  await page.getByRole('link', { name: 'Tags', exact: true }).click();
  // [NFR-18] Add a tag, folded to its button; each tag's Edit a fold (WP-94).
  await unfold(foldOf(page, 'Add a tag'));
  const add = page.getByRole('form', { name: 'Add a tag' });
  await add.getByLabel('Name').fill('Tidy-up');
  await pick(add, 'Green');
  await pick(add, 'toys');
  await add.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Tidy-up.');
  await expectContrastOk(page);

  for (const title of [tidy, shoes, 'Make bed']) {
    await page.goto('/admin/chores');
    await openItem(page, title);
    const form = page.getByRole('form', { name: 'Edit item' });
    await form.getByRole('checkbox', { name: 'Tidy-up' }).check();
    await save(
      page,
      form.getByRole('button', { name: 'Save changes' }),
      title,
      `Saved ${title}.`,
      times,
    );
  }
  report(`CHR-10 saves: ${times.join(', ')}`);

  // [CHR-21] More filters' Tag applies as it is picked (WP-96).
  await unfold(foldOf(page, 'More filters'));
  await page.getByRole('combobox', { name: 'Tag' }).selectOption({ label: 'Tidy-up' });
  await expect(foldOf(page, 'More filters')).toContainText('Tag: Tidy-up');
  await expect(rowsOf(page).locator('.fw-row__name')).toHaveText([
    /Make bed/,
    /Tidy toys/,
    /Put shoes away/,
  ]);
  const filtered = page.url();

  // Renaming keeps the same three: items and filters hold the tag's id. [NFR-18] Each tag's ⋯
  // holds Edit and Archive (WP-96).
  await page.goto('/admin/tags');
  await (await menuOf(page, 'Tidy-up')).getByRole('link', { name: 'Edit Tidy-up' }).click();
  const edit = page.getByRole('form', { name: 'Edit Tidy-up' });
  await edit.getByLabel('Name').fill('Tidy-up time');
  await edit.getByRole('button', { name: 'Save tag' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Tidy-up time.');
  await page.goto(filtered);
  await expect(rowsOf(page).locator('.fw-row__name')).toHaveText([
    /Make bed/,
    /Tidy toys/,
    /Put shoes away/,
  ]);
  // Tags are off the rows (Q6); More filters names it by its new name.
  await expect(foldOf(page, 'More filters')).toContainText('Tag: Tidy-up time');

  // Archived: no longer offered on an item, but the items keep it for goals and history.
  await page.goto('/admin/tags');
  await (
    await menuOf(page, 'Tidy-up time')
  )
    .getByRole('button', { name: 'Archive Tidy-up time' })
    .click();
  await expect(page.getByRole('list', { name: 'Archived tags' })).toContainText('Tidy-up time');
  await page.goto('/admin/chores');
  await openItem(page, tidy);
  await expect(
    page.getByRole('form', { name: 'Edit item' }).getByRole('checkbox', { name: 'Tidy-up time' }),
  ).toHaveCount(0);
  await expect(page.getByText('Also tagged Tidy-up time (archived)')).toBeVisible();
  expect(
    sql(`select count(*) from public.chore_tag ct join public.tag t on t.id = ct.tag_id
          where t.household_id = '${HOUSEHOLD}' and t.name = 'Tidy-up time'`),
  ).toBe('3');
});

test('[CHR-13][NFR-14-f] a private task stays with its creator, and reaches the other parent only if it’s theirs', async ({
  browser,
}) => {
  made.push('Plan the birthday surprise', 'Pick up the cake');
  const times: string[] = [];
  const alex = await (await browser.newContext()).newPage();
  const sam = await (await browser.newContext()).newPage();
  try {
    await signIn(alex, 'Alex');
    for (const [title, who] of [
      ['Plan the birthday surprise', 'Alex'],
      ['Pick up the cake', 'Sam'],
    ] as const) {
      await alex.getByRole('link', { name: 'Add a task' }).click();
      const form = alex.getByRole('form', { name: 'Add an item' });
      await enter(form, { title, people: [who], icon: 'gift', onDate: demoDate(4) });
      await form.getByRole('switch', { name: 'Private' }).check();
      // Timed as the other saves are (WP-83): a save that never answers, a refused one and a slow
      // one each say so (16 October: no banner within 15 s, and nothing in the log to say which).
      await save(
        alex,
        form.getByRole('button', { name: 'Save', exact: true }),
        title,
        `Saved ${title}.`,
        times,
      );
      await expect(row(alex, title)).toContainText('Private');
    }
    report(`CHR-13 saves: ${times.join(', ')}`);

    await signIn(sam, 'Sam');
    await expect(list(sam)).toContainText('Pick up the cake');
    await expect(list(sam)).not.toContainText('Plan the birthday surprise');
    const surprise = sql(
      `select id from public.chore where household_id = '${HOUSEHOLD}' and title = 'Plan the birthday surprise'
          and created_at >= '${since}'`,
    );
    expect((await sam.goto(`/admin/chores/${surprise}`))?.status()).toBe(404);

    // Sam can't make a family item private: only its creator (Alex) is offered the switch.
    await sam.goto('/admin/chores');
    await openItem(sam, 'Make bed');
    await expect(sam.getByRole('switch', { name: 'Private' })).toHaveCount(0);
    await expect(
      sam.getByText('Only the person who created this item can make it private.'),
    ).toBeVisible();
  } finally {
    await alex.context().close();
    await sam.context().close();
  }
});

test('[CHR-01][CHR-21] an item is archived and restored from its ⋯, never deleted', async ({
  page,
}) => {
  const piano = `Practice piano ${RUN}`;
  const id = fixture({ title: piano, people: ['Maya'], icon: 'chore-music', time: '16:30' });
  await signIn(page, 'Alex');
  await (await menuOf(page, piano)).getByRole('button', { name: `Archive ${piano}` }).click();
  // Each action redirects when it has saved; wait for that before reading or moving on.
  await page.waitForURL(/\/admin\/chores\?archived=.*open=archived/);
  await expect(page.getByRole('status')).toHaveText(`Archived ${piano}. It’s under Archived.`);
  await expect(page.getByRole('list', { name: 'Recurring', exact: true })).not.toContainText(piano);
  // [CHR-21] Under Archived, opened after the archive.
  await expect(foldOf(page, 'Archived')).toHaveAttribute('open', '');
  await expect(
    page.getByRole('list', { name: 'Archived', exact: true }).getByRole('listitem').filter({
      hasText: piano,
    }),
  ).toHaveCount(1);
  await (await menuOf(page, piano)).getByRole('button', { name: `Restore ${piano}` }).click();
  await page.waitForURL(/\/admin\/chores\?restored=/);
  await expect(page.getByRole('list', { name: 'Recurring', exact: true })).toContainText(piano);
  expect(
    sql(`select count(*) from public.audit_log where household_id = '${HOUSEHOLD}' and entity_type = 'chore' and action = 'update'
          and diff ? 'archived_at' and chore_id = '${id}'`),
  ).toBe('2');
});

test('[CHR-07][CHR-18] an item’s page shows its last seven days: each child’s own bed, and the days each missed', async ({
  page,
}) => {
  // The demo family's seeded week (supabase/seed.sql): each makes their own bed (D-47); Leo missed
  // yesterday and Maya three days ago.
  await signIn(page, 'Alex');
  await page.goto(`/admin/chores/${family.own('0de00000-0000-4000-8000-0000000c0001')}`);
  // [NFR-18] Folded to its counts (WP-96): opened by its header.
  await unfold(foldOf(page, 'Last 7 days'));
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
          where o.chore_id = '${family.own('0de00000-0000-4000-8000-0000000c0001')}' and o.due_date in (${TODAY} - 1, ${TODAY} - 3)`),
  ).toBe('Leo=missed,Maya=completed,Leo=completed,Maya=missed');
  await expectContrastOk(page);
});

test('[CHR-18] several people: everyone does their own by default for a chore; switching to any one of them makes one a day', async ({
  page,
}) => {
  // A chore for Maya and Leo, each their own (as the app saves it by default: the WP-08 test above
  // checks that default), and one for Leo alone.
  const shoes = `Put shoes away ${RUN}`;
  const tidy = `Tidy toys ${RUN}`;
  const id = fixture({ title: shoes, people: ['Maya', 'Leo'], icon: 'chore-shoes' });
  fixture({ title: tidy, people: ['Leo'], icon: 'chore-toys', time: '19:00' });
  const perDay = () =>
    sql(`select count(*) || ':' || count(distinct o.due_date) from public.chore_occurrence o
          where o.chore_id = '${id}' and o.due_date between ${TODAY} and ${TODAY} + 14`);
  expect(perDay()).toBe('30:15');
  await signIn(page, 'Alex');
  await expect(row(page, shoes)).toContainText('each their own');
  await openItem(page, shoes);
  await unfold(foldOf(page, 'Coming up'));
  await expect(
    page.getByRole('list', { name: 'Coming up' }).getByRole('listitem').first(),
  ).toContainText('each their own');
  const form = page.getByRole('form', { name: 'Edit item' });
  await expect(form.getByRole('radio', { name: 'Everyone does their own' })).toBeChecked();
  await form.getByRole('radio', { name: 'Any one of them' }).check();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved ${shoes}.`);
  expect(perDay()).toBe('15:15');
  await expect(row(page, shoes)).not.toContainText('each their own');

  // With one person the question is not asked.
  await openItem(page, tidy);
  await expect(
    page.getByRole('form', { name: 'Edit item' }).getByRole('radio', { name: 'Any one of them' }),
  ).toHaveCount(0);
});

test('[CHR-19][US-321] a lunch-day item follows each child’s school lunch, and re-plans when a lunch changes', async ({
  page,
}) => {
  const title = 'Pack lunch e2e';
  made.push(title);
  const [maya, leo] = ['Maya', 'Leo'].map((name) =>
    sql(
      `select id from public.member where household_id = '${HOUSEHOLD}' and display_name = '${name}'`,
    ),
  ) as [string, string];
  // [D-110] School days of its own over the two weeks, so there are lunch days in summer and over
  // winter break too; taken away in the finally below, with Leo's lunch change.
  const noSchoolDays = withSchoolDays(db!, [maya, leo], today, demoDate(14));
  let day = '';
  try {
    await signIn(page, 'Alex');
    await page.getByRole('link', { name: 'Add a chore' }).click();
    const form = page.getByRole('form', { name: 'Add an item' });
    await enter(form, { title, people: ['Maya', 'Leo'], icon: 'backpack', time: '07:00' });
    // Private, so it stays off the board other specs read.
    await form.getByRole('switch', { name: 'Private' }).check();
    await form.getByRole('radio', { name: 'Any one of them' }).check();
    await form.getByText('More options').click();
    await form.getByRole('combobox', { name: 'School lunch' }).selectOption('bring');
    // Each child has their own lunch: choosing lunch days makes it everyone's own.
    await expect(form.getByRole('radio', { name: 'Everyone does their own' })).toBeChecked();
    await expect(form.getByRole('radio', { name: 'Any one of them' })).toBeDisabled();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved ${title}.`);
    await expect(row(page, title)).toContainText('on days they bring lunch');

    const chore = sql(
      `select id from public.chore where household_id = '${HOUSEHOLD}' and title = '${title}' and created_at >= '${since}'`,
    );
    expect(
      sql(`select assignment || ':' || lunch_days from public.chore where id = '${chore}'`),
    ).toBe('each:bring');
    // Over the next two weeks (to the 13th day, which a run just after midnight already has), for each
    // child and day: planned exactly when they bring lunch. In one statement, so it holds whatever
    // another test does to the household's lunches meanwhile.
    const mismatches = () =>
      sql(`select count(*) from public.member m
           cross join generate_series(${TODAY}, ${TODAY} + 13, interval '1 day') d
          where m.household_id = '${HOUSEHOLD}' and m.display_name in ('Maya', 'Leo')
            and (public.lunch_mode(m.id, d::date) is not distinct from 'bring')
                <> exists (select from public.chore_occurrence o
                            where o.chore_id = '${chore}' and o.member_id = m.id and o.due_date = d::date)`);
    expect(mismatches()).toBe('0');
    expect(
      Number(sql(`select count(*) from public.chore_occurrence where chore_id = '${chore}'`)),
    ).toBeGreaterThan(0);

    // Leo's next school day changed to the other lunch: his plan follows at once.
    day = sql(`select d::date from generate_series(${TODAY} + 1, ${TODAY} + 13, interval '1 day') d
                    where public.lunch_mode('${leo}', d::date) is not null order by d limit 1`);
    expect(day, 'a school day for Leo in the next two weeks').not.toBe('');
    const was = sql(`select public.lunch_mode('${leo}', '${day}')`);
    sql(`insert into public.lunch_override (household_id, member_id, lunch_date, mode)
       values ('${HOUSEHOLD}', '${leo}', '${day}', '${was === 'bring' ? 'buy' : 'bring'}')
       on conflict (member_id, lunch_date) do update set mode = excluded.mode`);
    expect(mismatches()).toBe('0');
    sql(`delete from public.lunch_override where member_id = '${leo}' and lunch_date = '${day}'`);
    expect(mismatches()).toBe('0');
  } finally {
    if (day)
      sql(`delete from public.lunch_override where member_id = '${leo}' and lunch_date = '${day}'`);
    // The item itself goes in afterEach.
    noSchoolDays();
  }
});
