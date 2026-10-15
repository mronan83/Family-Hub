import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { signIn } from '../support/session';

// [MEAL-15][US-701] Edit on a planned meal (WP-76, D-111), as Alex of the demo family, on the preview.
// The done-when: Alex taps Change on a planned dinner, chooses Edit, finds the form filled in, changes
// the meal, the people and the note, saves, sees the change on the plan, and opens Edit again to find
// the saved values. Its own week (five weeks ahead, clear of meals.spec.ts's two and three), its own
// meal and two dinners, made in SQL and removed afterwards.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MEAL = 'Tacos e2e-edit';
const SOUP = 'e2e7e000-0000-4000-8000-000000000001';
const PASTA = 'e2e7e000-0000-4000-8000-000000000002';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** The household week five weeks from this one, and its Wednesday, read once (D-110). */
let week: string;
let day: string;

const clear = () =>
  sql(`delete from public.meal_plan_entry where household_id = '${DEMO}' and id in ('${SOUP}', '${PASTA}');
       delete from public.meal where household_id = '${DEMO}' and name = '${MEAL}'`);

/** The dinner as it reads: "1 Soup e2e-edit; 2 Tacos e2e-edit (Alex, Sam) Edited", by order. */
const dinners = () =>
  sql(`select string_agg(e.sort_order || ' ' || coalesce(m.name, e.free_text)
                         || coalesce(' (' || (select string_agg(p.display_name, ', ' order by p.display_name)
                                                from public.meal_plan_entry_member x
                                                join public.member p on p.id = x.member_id
                                               where x.entry_id = e.id) || ')', '')
                         || coalesce(' ' || e.notes, ''), '; ' order by e.sort_order)
         from public.meal_plan_entry e left join public.meal m on m.id = e.meal_id
        where e.id in ('${SOUP}', '${PASTA}')`);

test.beforeAll(async ({ browser }) => {
  week = weekStartOf(addDays(householdToday(db!), 35), householdWeekStart(db!));
  day = addDays(week, 3);
  clear();
  sql(`insert into public.meal (household_id, name, meal_types) values ('${DEMO}', '${MEAL}', '{dinner}');
       insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, free_text, notes) values
         ('${SOUP}', '${DEMO}', '${day}', 'dinner', 1, 'Soup e2e-edit', null),
         ('${PASTA}', '${DEMO}', '${day}', 'dinner', 2, 'Pasta e2e-edit', 'Mild');
       insert into public.meal_plan_entry_member (household_id, entry_id, member_id)
       select '${DEMO}', '${PASTA}', id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`);
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  if (week) clear();
  await admin?.close();
});

test('[MEAL-15][US-701] done-when: Alex edits a planned dinner in place, and Edit again shows what was saved', async () => {
  // [D-110] Three page loads and one save (a save is 3 to 8 s on a preview, as meals.spec.ts
  // measures), about 20 s at worst: three times that.
  test.setTimeout(60_000);
  const slot = admin.locator(`[id="${day}-dinner"]`);
  const form = admin.getByRole('form', { name: 'Edit Pasta e2e-edit' });

  await test.step('Change on the second dinner offers Edit, which opens the form filled in', async () => {
    await admin.goto(`/admin/meals?week=${week}`);
    await slot.getByText('Change', { exact: true }).nth(1).click();
    await slot.getByRole('link', { name: /^Edit Pasta e2e-edit/ }).click();
    await expect(form.getByRole('textbox', { name: 'Something else' })).toHaveValue(
      'Pasta e2e-edit',
    );
    await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue(day);
    await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue('dinner');
    await expect(form.getByRole('checkbox', { name: 'Maya', exact: true })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Everyone', exact: true })).not.toBeChecked();
    await expect(form.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('Mild');
  });

  await test.step('the meal, the people and the note changed, and saved in place', async () => {
    await form.getByRole('radio', { name: 'From the library' }).check();
    await form.getByRole('combobox', { name: 'From the library' }).selectOption({ label: MEAL });
    const who = form.getByRole('group', { name: 'For' });
    await who.getByRole('checkbox', { name: 'Maya', exact: true }).uncheck();
    await who.getByRole('checkbox', { name: 'Alex', exact: true }).check();
    await who.getByRole('checkbox', { name: 'Sam', exact: true }).check();
    await form.getByRole('textbox', { name: 'Note (optional)' }).fill('Edited');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByRole('status')).toHaveText('Saved.');
    await expect(form).toHaveCount(0);
    await expect(slot.getByRole('listitem').nth(1)).toContainText(`${MEAL}AlexSam`);
    await expect(slot.getByRole('listitem').nth(1)).toContainText('Edited');
    // The same entry (its id), in its place after the soup.
    expect(dinners()).toBe(`1 Soup e2e-edit; 2 ${MEAL} (Alex, Sam) Edited`);
  });

  await test.step('Edit again shows the saved values', async () => {
    await slot.getByText('Change', { exact: true }).nth(1).click();
    await slot.getByRole('link', { name: new RegExp(`^Edit ${MEAL}`) }).click();
    const again = admin.getByRole('form', { name: `Edit ${MEAL}` });
    await expect(again.getByRole('radio', { name: 'From the library' })).toBeChecked();
    await expect(
      again.getByRole('combobox', { name: 'From the library' }).locator('option:checked'),
    ).toHaveText(MEAL);
    await expect(again.getByRole('checkbox', { name: 'Alex', exact: true })).toBeChecked();
    await expect(again.getByRole('checkbox', { name: 'Sam', exact: true })).toBeChecked();
    await expect(again.getByRole('checkbox', { name: 'Maya', exact: true })).not.toBeChecked();
    await expect(again.getByRole('textbox', { name: 'Note (optional)' })).toHaveValue('Edited');
  });
});
