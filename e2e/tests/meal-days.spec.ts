import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, householdWeekStart, weekStartOf } from '../support/day';
import { mealDay, unfold } from '../support/fold';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [MEAL-14][US-711][D-98] The meal planner's days folded (WP-75), as Alex of the demo family, on the
// preview. The done-when: Alex opens Meals with every day collapsed, sees "2 of 4 set" on a day with
// two meals, adds the other two from the expanded day and sees the checkmark, and edits a meal there.
// Its own week (six weeks ahead, clear of meals.spec.ts's two and three and meal-edit.spec.ts's five),
// its own two meals made in SQL; the week's plan is cleared before and after.
const family = ownHousehold('meal-days');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const PORRIDGE = 'e2e75000-0000-4000-8000-000000000001';
const STEW = 'e2e75000-0000-4000-8000-000000000002';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** The household week six weeks from this one, and its third day, read once (D-110). */
let week: string;
let day: string;

const clear = () =>
  sql(`delete from public.meal_plan_entry where household_id = '${HOUSEHOLD}'
         and plan_date between '${week}' and '${addDays(week, 6)}'`);

test.beforeAll(async ({ browser }) => {
  week = weekStartOf(addDays(householdToday(db!), 42), householdWeekStart(db!));
  day = addDays(week, 2);
  clear();
  sql(`insert into public.meal_plan_entry (id, household_id, plan_date, slot, sort_order, free_text) values
         ('${PORRIDGE}', '${HOUSEHOLD}', '${day}', 'breakfast', 1, 'Porridge e2e-days'),
         ('${STEW}', '${HOUSEHOLD}', '${day}', 'dinner', 1, 'Stew e2e-days')`);
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  if (week) clear();
  await admin?.close();
});

test('[MEAL-14][US-711] done-when: every day folded, 2 of 4 set, the other two added from the day to a check, and a meal edited there', async () => {
  // [D-110] Four page loads, two adds and one save (each 3 to 8 s on a preview, as meals.spec.ts
  // measures), about 35 s at worst: three times that.
  test.setTimeout(105_000);
  const theDay = mealDay(admin, day);
  const head = theDay.locator(':scope > summary');
  const add = admin.getByRole('region', { name: 'Add to the plan' });
  const form = add.getByRole('form', { name: 'Add to the plan' });

  await test.step('every day folded; the day with two meals says 2 of 4 set', async () => {
    await admin.goto(`/admin/meals?week=${week}`);
    const days = admin.locator('.fw-meal-day > details');
    await expect(days).toHaveCount(7);
    await expect(admin.locator('.fw-meal-day > details[open]')).toHaveCount(0);
    await expect(head).toContainText('2 of 4 set');
    await expect(mealDay(admin, addDays(week, 3)).locator(':scope > summary')).toContainText(
      '0 of 4 set',
    );
    await expect(add.locator('details')).not.toHaveAttribute('open');
  });

  for (const [slot, text, after] of [
    ['snack', 'Crackers e2e-days', '3 of 4 set'],
    ['lunch', 'Wraps e2e-days', null],
  ] as const) {
    await test.step(`Add on the day's ${slot} opens Add to the plan filled in; added`, async () => {
      await unfold(theDay);
      await admin
        .locator(`[id="${day}-${slot}"]`)
        .getByRole('link', { name: /^Add to / })
        .click();
      await expect(add.locator('details')).toHaveAttribute('open', '');
      await expect(form.getByRole('combobox', { name: 'Day' })).toHaveValue(day);
      await expect(form.getByRole('combobox', { name: 'Meal' })).toHaveValue(slot);
      await form.getByRole('radio', { name: 'Something else' }).check();
      await form.getByRole('textbox', { name: 'Something else' }).fill(text);
      await form.getByRole('button', { name: 'Add to the plan' }).click();
      // The day comes back open with the meal in it; its head counts it.
      await expect(admin.locator(`[id="${day}-${slot}"]`)).toContainText(text);
      if (after) await expect(head).toContainText(after);
      else await expect(head.getByRole('img', { name: 'All set' })).toBeVisible();
      await expect(theDay).toHaveAttribute('open', '');
    });
  }

  await test.step('a meal edited in the open day', async () => {
    const dinner = admin.locator(`[id="${day}-dinner"]`);
    await dinner.getByText('Change', { exact: true }).click();
    await dinner.getByRole('link', { name: /^Edit Stew e2e-days/ }).click();
    const edit = admin.getByRole('form', { name: 'Edit Stew e2e-days' });
    await edit.getByRole('textbox', { name: 'Note (optional)' }).fill('Edited e2e-days');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByRole('status')).toHaveText('Saved.');
    await expect(edit).toHaveCount(0);
    await expect(theDay).toHaveAttribute('open', '');
    await expect(dinner).toContainText('Edited e2e-days');
    expect(sql(`select notes from public.meal_plan_entry where id = '${STEW}'`)).toBe(
      'Edited e2e-days',
    );
    await expect(head.getByRole('img', { name: 'All set' })).toBeVisible();
  });
});
