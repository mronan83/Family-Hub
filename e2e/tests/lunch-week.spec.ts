import { appendFileSync } from 'node:fs';
import { expect, test } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday, weekStartOf } from '../support/day';
import { withSchoolDays } from '../support/school';
import { signIn } from '../support/session';

// [MEAL-13][US-710][D-98] The lunch week as a list of days, on the preview (WP-74). The done-when:
// Alex opens Maya's lunch week on a 390 px phone with nothing scrolling sideways and every day
// closed, opens a Buy day, picks an entree and a milk and sees its check, sets a day to Bring and
// sees its check, and finds a closure greyed as "No school". The week four weeks on, Monday to
// Friday, is the spec's own: school days for Maya (support/school) with a snow day on Thursday, a
// made-up menu by section ("Lunch week e2e") on each day, and Monday and Tuesday set to Buy. Maya's
// menu is put back and everything the spec made is taken away at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MENU = 'Lunch week e2e';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

function report(line: string) {
  console.log(line);
  if (process.env.E2E_REPORT) appendFileSync(process.env.E2E_REPORT, `${line}\n`);
}

const items = JSON.stringify([
  { name: 'Pasta e2e', section: 'Choice of Entree', option: 1 },
  { name: 'Burger e2e', section: 'Choice of Entree', option: 2 },
  { name: 'Grapes e2e', section: 'Fruits & Vegetables offered', option: 1 },
  { name: 'White milk e2e', section: 'Choice of Milk', option: 1 },
  { name: 'Berry milk e2e', section: 'Choice of Milk', option: 2 },
]);

test('[MEAL-13][US-710] done-when: Maya’s week on a phone, every day closed; a Buy day picked, a day set to Bring, each checked; a snow day greyed', async ({
  browser,
}) => {
  // Signing in on a cold preview can take most of 30 s; the rest measured well under 20 s.
  test.setTimeout(120_000);
  const mon = weekStartOf(addDays(householdToday(db!), 28), 1);
  const [tue, thu, fri] = [addDays(mon, 1), addDays(mon, 3), addDays(mon, 4)];
  const maya = sql(
    `select id from public.member where household_id = '${DEMO}' and display_name = 'Maya'`,
  );
  const inWeek = `member_id = '${maya}' and lunch_date between '${mon}' and '${fri}'`;
  const menuBefore = sql(
    `select coalesce(menu_source_id::text, '') from public.member_lunch where member_id = '${maya}'`,
  );
  const undo = withSchoolDays(db!, [maya], mon, fri);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    // A snow day on Thursday, in the school year the spec gave her (it goes with that year).
    sql(`insert into public.school_closure (household_id, school_year_id, name, closure_type, start_date, end_date)
         select '${DEMO}', public.member_school_year('${maya}', '${mon}'), 'Snow day e2e', 'snow_day',
                '${thu}', '${thu}'`);
    sql(`delete from public.menu_source where household_id = '${DEMO}' and name = '${MENU}';
         insert into public.menu_source (household_id, name, adapter, config)
         values ('${DEMO}', '${MENU}', 'manual', '{}');
         insert into public.school_menu_day (household_id, source_id, menu_date, meal_service, items, origin,
                                             is_override)
         select '${DEMO}', s.id, d::date, 'lunch', '${items}'::jsonb, 'manual', true
           from public.menu_source s, generate_series('${mon}'::date, '${fri}'::date, interval '1 day') d
          where s.household_id = '${DEMO}' and s.name = '${MENU}';
         insert into public.member_lunch (member_id, household_id, menu_source_id)
         values ('${maya}', '${DEMO}', (select id from public.menu_source where household_id = '${DEMO}' and name = '${MENU}'))
         on conflict (member_id) do update set menu_source_id = excluded.menu_source_id;`);
    sql(`select set_config('request.jwt.claims', '{}', false);
         delete from public.lunch_choice where ${inWeek};
         delete from public.lunch_override where ${inWeek};
         insert into public.lunch_override (household_id, member_id, lunch_date, mode)
         values ('${DEMO}', '${maya}', '${mon}', 'buy'), ('${DEMO}', '${maya}', '${tue}', 'buy');`);

    await signIn(page, 'Alex');
    await page.goto(`/admin/meals?week=${mon}`);
    await page
      .getByRole('group', { name: 'Whose lunches' })
      .getByRole('button', { name: /^Maya/ })
      .click();
    const week = page.getByRole('list', { name: 'Maya’s lunch week' });
    const day = (date: string) => week.locator(`.fw-lunchday[data-date="${date}"]`);

    await test.step('[MEAL-13] her Monday to Friday, every day closed, nothing sideways at 390 px', async () => {
      await expect(week.locator('.fw-lunchday__name')).toHaveText([
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
      ]);
      await expect(week.locator('details[open]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    });

    await test.step('[MEAL-13][MEAL-11] Monday, a Buy day: an entree and a milk picked, then its check', async () => {
      await expect(day(mon).getByRole('img', { name: 'Not picked yet' })).toBeVisible();
      await day(mon).locator('summary').click();
      const form = day(mon).locator('form.fw-lunchday__picks');
      await form.getByLabel('Burger e2e', { exact: true }).check();
      await form.getByLabel('Berry milk e2e', { exact: true }).check();
      await form.getByRole('button', { name: 'Save Maya’s picks' }).click();
      await expect(page.getByRole('status')).toHaveText('Lunch picks saved.');
      await expect(day(mon).getByRole('img', { name: 'Complete' })).toBeVisible();
      expect(
        sql(`select string_agg(array_to_string(names, ','), ' | ' order by section) from public.lunch_choice
              where member_id = '${maya}' and lunch_date = '${mon}'`),
      ).toBe('Burger e2e | Berry milk e2e');
    });

    await test.step('[MEAL-13][MEAL-04] Tuesday set to Bring: its check', async () => {
      await expect(day(tue).getByRole('img', { name: 'Not picked yet' })).toBeVisible();
      if ((await day(tue).locator('details').getAttribute('open')) === null)
        await day(tue).locator('summary').click();
      await day(tue)
        .getByRole('group', { name: 'Maya, Tuesday: buy or bring' })
        .getByRole('button', { name: 'Bring' })
        .click();
      await expect(page.getByRole('status')).toHaveText('Lunch changed.');
      await expect(day(tue).locator('.fw-lunchday__end')).toHaveText('Bring');
      await expect(day(tue).getByRole('img', { name: 'Complete' })).toBeVisible();
      expect(sql(`select public.lunch_mode('${maya}', '${tue}')`)).toBe('bring');
    });

    await test.step('[MEAL-13] Thursday’s snow day: greyed, "No school", nothing to open', async () => {
      await expect(day(thu)).toHaveClass(/fw-lunchday--off/);
      await expect(day(thu).locator('.fw-lunchday__end')).toHaveText('No school');
      await expect(day(thu).locator('summary')).toHaveCount(0);
    });
    report('MEAL-13 the lunch week on a phone: picks and Bring checked, the snow day greyed');
  } finally {
    sql(`delete from public.lunch_choice where ${inWeek};
         delete from public.lunch_override where ${inWeek};
         update public.member_lunch set menu_source_id = ${menuBefore ? `'${menuBefore}'` : 'null'}
          where member_id = '${maya}';
         delete from public.menu_source where household_id = '${DEMO}' and name = '${MENU}';`);
    undo();
    await page.close();
  }
});
