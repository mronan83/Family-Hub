import { expect, test, type Locator, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';
import { foldOf, unfold } from '../support/fold';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [CHR-21][CHR-22][CHR-23][NFR-18] WP-96's done-when on the preview, as Alex of the spec's own
// made-up household (D-137): Maya's chip filters every section; Completed opens and Show older
// brings the rest; an item is duplicated and the copy saved; Do again on a completed one-time item
// adds a new one under its date in Scheduled, and its icon is changed and saved; on the Meal library
// a meal is edited, duplicated and archived from ⋯; on Tags a tag is edited and archived from ⋯.
//
// Its own one-time items ("Sort the shelf e2e …", Maya's, 0 points, each done today by a tick as a
// board records it), 21 of them so Completed has more than its newest 20. Everything the spec makes
// is archived or removed afterwards, and what it changes is put back.
const family = ownHousehold('chore-sections');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const RUN = Math.random().toString(36).slice(2, 6);
const DONE = Array.from(
  { length: 21 },
  (_, i) => `Sort the shelf e2e ${RUN} ${String(i + 1).padStart(2, '0')}`,
);
const AGAIN = DONE[0]!;
const COPY = 'Feed the dog (copy)';
const MEAL = family.own('0de00000-0000-4000-8000-000000071002'); // Spaghetti
const KITCHEN = family.own('0de00000-0000-4000-8000-0000000a0002');
const sql = (q: string) => query(db!, q);
const quoted = (s: string) => `'${s.replace(/'/g, "''")}'`;

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let today = '';
let mealWas = '';
const memberId = (name: string) =>
  sql(
    `select id from public.member where household_id = '${HOUSEHOLD}' and display_name = '${name}'`,
  );

const rowsOf = (page: Page) => page.locator('li.fw-row');
const row = (page: Page, title: string) => rowsOf(page).filter({ hasText: title });
/** A row's ⋯, opened, and its menu. */
async function menuOf(page: Page, title: string): Promise<Locator> {
  await page.getByLabel(`More for ${title}`, { exact: true }).click();
  return row(page, title).locator('.fw-row__menu');
}

test.beforeAll(() => {
  today = householdToday(db!);
  mealWas = sql(`select coalesce(description, '') from public.meal where id = '${MEAL}'`);
  const maya = memberId('Maya');
  // Each a one-time chore today, ticked done a minute apart, as a board records a check-off.
  for (const [i, title] of DONE.entries()) {
    const id = sql(`select public.save_chore('${HOUSEHOLD}', null,
      jsonb_build_object('title', ${quoted(title)}, 'kind', 'chore', 'points', 0, 'approval', 'none',
                         'schedule', jsonb_build_object('freq', 'once', 'on_date', '${today}')),
      array['${maya}'::uuid])`);
    sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, done_by, occurred_at)
         select gen_random_uuid(), o.id, 'complete', array['${maya}'::uuid], now() - interval '${30 - i} minutes'
           from public.chore_occurrence o where o.chore_id = '${id}'`);
  }
});

test.afterAll(() => {
  // Items with history are archived, never deleted (D-46); the copy and Do again's item have none.
  sql(`delete from public.chore c where c.household_id = '${HOUSEHOLD}'
          and c.title in (${[COPY, ...DONE].map(quoted).join(', ')})
          and not exists (select from public.chore_occurrence o
                            join public.chore_completion_event e on e.occurrence_id = o.id
                           where o.chore_id = c.id);
       update public.chore set archived_at = now()
        where household_id = '${HOUSEHOLD}' and title in (${DONE.map(quoted).join(', ')});
       update public.meal set description = nullif(${quoted(mealWas)}, ''), archived_at = null
        where id = '${MEAL}';
       delete from public.meal where household_id = '${HOUSEHOLD}' and name = 'Spaghetti (copy)';
       update public.tag set name = 'Kitchen', archived_at = null where id = '${KITCHEN}';`);
});

test('[CHR-21-i][US-323] Maya’s chip filters every section; Completed opens and Show older brings the rest', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  await page.goto('/admin/chores');
  const chips = page.getByRole('group', { name: 'Whose' });
  await chips.getByRole('button', { name: 'Maya' }).click();
  await expect(chips.getByRole('button', { name: 'Maya' })).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.getByRole('link', { name: 'Clear' })).toBeVisible();
  // Every section, folded ones too, holds only Maya's.
  const lines = rowsOf(page).locator('.fw-row__l2');
  await expect(lines.first()).toBeVisible();
  for (const line of await lines.all()) await expect(line).toContainText('Maya');
  await expect(row(page, 'Take out the bins')).toHaveCount(0);

  await unfold(foldOf(page, 'Completed'));
  const completed = page
    .getByRole('list', { name: 'Completed', exact: true })
    .getByRole('listitem');
  await expect(completed).toHaveCount(20);
  await expect(page.getByText(/^Showing the newest 20 of \d+\.$/)).toBeVisible();
  const total = Number(
    (await page.getByText(/^Showing the newest 20 of/).textContent())!.match(/of (\d+)/)![1],
  );
  expect(total).toBeGreaterThanOrEqual(21);
  await page.getByRole('link', { name: 'Show older' }).click();
  await expect(completed).toHaveCount(Math.min(total, 40));
  await expect(
    page.getByRole('group', { name: 'Whose' }).getByRole('button', { name: 'Maya' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('[CHR-22-b][US-324] an item duplicated from its ⋯ and the copy saved; the original unchanged', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  await page.goto('/admin/chores');
  await (
    await menuOf(page, 'Feed the dog')
  )
    .getByRole('link', { name: 'Duplicate Feed the dog' })
    .click();
  await expect(page.getByRole('heading', { name: 'Add a chore', level: 1 })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('A copy of Feed the dog.');
  const form = page.getByRole('form', { name: 'Add an item' });
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue(COPY);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved ${COPY}.`);
  await expect(page.getByRole('list', { name: 'Recurring', exact: true })).toContainText(COPY);
  const shape = (title: string) =>
    sql(`select c.kind || ':' || c.points || ':' || c.icon || ':' || coalesce(left(c.due_time::text, 5), '-') || ':'
                || (c.schedule ->> 'freq') || ':'
                || (select string_agg(m.display_name, '+' order by m.display_name)
                      from public.chore_assignee a join public.member m on m.id = a.member_id
                     where a.chore_id = c.id)
           from public.chore c where c.household_id = '${HOUSEHOLD}' and c.title = ${quoted(title)}
            and c.archived_at is null`);
  expect(shape(COPY)).toBe(shape('Feed the dog'));
  expect(
    sql(
      `select count(*) from public.chore where household_id = '${HOUSEHOLD}' and title = 'Feed the dog'`,
    ),
  ).toBe('1');
});

test('[CHR-23-c][US-325] Do again on a completed one-time item: a new one under its date in Scheduled, the first stays done; then its icon changed', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  const inAWeek = addDays(today, 7);
  const firstWas = () =>
    sql(`select string_agg(o.status || ':' || o.done_by::text, ',') from public.chore_occurrence o
           join public.chore c on c.id = o.chore_id
          where c.household_id = '${HOUSEHOLD}' and c.title = ${quoted(AGAIN)} and c.schedule ->> 'on_date' = '${today}'`);
  const before = firstWas();
  expect(before).toMatch(/^completed:/);

  await test.step('Do again… opens the date step', async () => {
    await page.goto('/admin/chores?open=completed');
    await (await menuOf(page, AGAIN)).getByRole('link', { name: `Do again: ${AGAIN}` }).click();
  });
  const sheet = page.getByRole('dialog', { name: `Do again: ${AGAIN}` });
  await expect(sheet).toContainText('The first one stays done on');
  await sheet.getByRole('group', { name: 'When' }).getByText('In a week').click();
  await expect(sheet.getByLabel('Or a date')).toHaveValue(inAWeek);

  await test.step('Add it: the new one is in Scheduled, under its date', async () => {
    await sheet.getByRole('button', { name: 'Add it' }).click();
    await expect(page.getByRole('status')).toContainText(`Added ${AGAIN} for`);
    await expect(page.getByRole('status')).toContainText('It’s in Scheduled, under');
    const heading = (await page.getByRole('status').textContent())!.match(/under (.+)\.$/)![1]!;
    await expect(
      page
        .getByRole('list', { name: heading, exact: true })
        .getByRole('listitem')
        .filter({ hasText: AGAIN }),
    ).toHaveCount(1);
    expect(
      sql(`select count(*) from public.chore where household_id = '${HOUSEHOLD}' and title = ${quoted(AGAIN)}
            and schedule ->> 'on_date' = '${inAWeek}' and archived_at is null`),
    ).toBe('1');
    expect(firstWas()).toBe(before);
  });

  await test.step('its icon changed and saved', async () => {
    const again =
      sql(`select id from public.chore where household_id = '${HOUSEHOLD}' and title = ${quoted(AGAIN)}
                        and schedule ->> 'on_date' = '${inAWeek}'`);
    await page.goto(`/admin/chores/${again}`);
    const form = page.getByRole('form', { name: 'Edit item' });
    await unfold(form.locator('details', { has: page.locator('.fw-iconpick') }));
    await form.getByRole('searchbox', { name: 'Find an icon' }).fill('book');
    await form
      .locator('label', { has: page.getByRole('radio', { name: 'book', exact: true }) })
      .click();
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved ${AGAIN}.`);
    expect(sql(`select icon from public.chore where id = '${again}'`)).toBe('book');
  });
});

test('[NFR-18-z] the Meal library from ⋯: a meal edited, duplicated and archived', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  await page.goto('/admin/meals/library');
  await test.step('Edit opens its form under its row', async () => {
    await (await menuOf(page, 'Spaghetti')).getByRole('link', { name: 'Edit Spaghetti' }).click();
    const form = page.getByRole('form', { name: 'Edit Spaghetti' });
    await form.getByLabel('Description (optional)').fill(`Edited e2e ${RUN}`);
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved Spaghetti.');
    await expect(row(page, 'Spaghetti')).toContainText(`Edited e2e ${RUN}`);
  });
  await test.step('Duplicate opens Add a meal filled in, "(copy)"', async () => {
    await (
      await menuOf(page, 'Spaghetti')
    )
      .getByRole('link', { name: 'Duplicate Spaghetti' })
      .click();
    const add = page.getByRole('form', { name: 'Add a meal' });
    await expect(add.getByRole('textbox', { name: 'Name' })).toHaveValue('Spaghetti (copy)');
    await add.getByRole('button', { name: 'Add meal' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved Spaghetti (copy).');
    expect(
      sql(`select array_to_string(meal_types, ',') from public.meal where household_id = '${HOUSEHOLD}'
            and name = 'Spaghetti (copy)'`),
    ).toBe(sql(`select array_to_string(meal_types, ',') from public.meal where id = '${MEAL}'`));
  });
  await test.step('Archive takes it to Archived', async () => {
    await (
      await menuOf(page, 'Spaghetti (copy)')
    )
      .getByRole('button', { name: 'Archive Spaghetti (copy)' })
      .click();
    await expect(page.getByRole('status')).toHaveText('Archived. Plans that used it keep it.');
    await expect(page.getByRole('list', { name: 'Archived meals' })).toContainText(
      'Spaghetti (copy)',
    );
  });
});

test('[NFR-18-z] Tags from ⋯: a tag edited and archived', async ({ page }) => {
  await signIn(page, 'Alex');
  await page.goto('/admin/tags');
  await (await menuOf(page, 'Kitchen')).getByRole('link', { name: 'Edit Kitchen' }).click();
  const form = page.getByRole('form', { name: 'Edit Kitchen' });
  await form.getByLabel('Name').fill(`Kitchen ${RUN}`);
  await form.getByRole('button', { name: 'Save tag' }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved Kitchen ${RUN}.`);
  await (
    await menuOf(page, `Kitchen ${RUN}`)
  )
    .getByRole('button', { name: `Archive Kitchen ${RUN}` })
    .click();
  await expect(page.getByRole('list', { name: 'Archived tags' })).toContainText(`Kitchen ${RUN}`);
  expect(sql(`select archived_at is not null from public.tag where id = '${KITCHEN}'`)).toBe('t');
});
