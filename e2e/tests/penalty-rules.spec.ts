import { expect, test } from '../support/test';
import { sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [PTS-10][US-1112][D-157] Penalty rules on the preview (WP-121), as Alex of the spec's own household
// (a copy of the demo family: penalties on, its reasons). One story: Alex adds a rule in Settings for
// a chore of Maya's made for this spec; the rule is moved back a day (as if made yesterday) and the
// chore missed yesterday, so day close adds $1 to what Maya owes on it, on her page too; Alex marks
// that day done on time and the $1 is taken back. The database agrees at each step. Afterwards the
// rule ends, its misses are taken back and the chore is archived.
const family = ownHousehold('penalty-rules');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const ITEM = `Pack the bag e2e ${TAG}`;
const RULE = `Bag packed e2e ${TAG}`;
const CHORE = crypto.randomUUID();
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

const maya = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya'`);
const ruleId = () =>
  sql(
    `select id from public.penalty_rule where household_id = '${HOUSEHOLD}' and name = '${RULE}'`,
  );
/** What the rule has live on Maya: amount and the day missed, or '' for none. */
const misses = () =>
  sql(`select string_agg(p.amount || '@' || p.missed_on, ',' order by p.missed_on)
         from public.penalty p join public.penalty_rule r on r.id = p.rule_id
        where r.household_id = '${HOUSEHOLD}' and r.name = '${RULE}' and p.taken_back_at is null`);

test('[PTS-10-m][US-1112] a parent adds a rule; a missed day adds to what is owed; Mark done on time takes it back', async ({
  page,
}) => {
  const today = householdToday(db!, HOUSEHOLD);
  const yesterday = addDays(today, -1);
  const mayaId = maya();
  // Maya's chore for this spec, once, yesterday, not done.
  sql(`insert into public.chore (id, household_id, title, kind, points, schedule, start_date, approval)
       values ('${CHORE}', '${HOUSEHOLD}', '${ITEM}', 'chore', 2,
               jsonb_build_object('freq', 'once', 'on_date', '${yesterday}'), '${yesterday}', 'none')`);
  sql(`insert into public.chore_assignee (household_id, chore_id, member_id)
       values ('${HOUSEHOLD}', '${CHORE}', '${mayaId}')`);
  try {
    await signIn(page);

    await test.step('Settings: Add a rule for Maya’s chore, $1 a miss, max $10', async () => {
      await page.goto('/admin/settings/penalties');
      await page.getByRole('link', { name: 'Add a rule' }).click();
      await expect(page.getByRole('heading', { name: 'Add a rule', level: 1 })).toBeVisible();
      const form = page.getByRole('form', { name: 'Penalty rule' });
      await form
        .getByLabel('Reason', { exact: true })
        .selectOption({ label: 'Homework folder not home' });
      await form.getByLabel('Name').fill(RULE);
      await form.getByRole('checkbox', { name: 'Maya' }).check();
      await form
        .getByRole('group', { name: 'Items' })
        .getByRole('checkbox', { name: ITEM })
        .check();
      await form.locator('input[name="endDate"]').fill(addDays(today, 30));
      await form.getByLabel('Each miss adds').fill('1');
      await form.getByLabel('Max owed').fill('10');
      await form.getByRole('button', { name: 'Save the rule' }).click();
      await expect(
        page.getByText('Rule added. Each miss adds to what’s owed when the day closes.'),
      ).toBeVisible();
      await expect(
        page
          .getByRole('list', { name: 'Penalty rules' })
          .getByRole('listitem')
          .filter({ hasText: RULE }),
      ).toContainText(`Maya · ${ITEM} · $1 a miss · max $10`);
      await expect.poll(ruleId).toMatch(/^[0-9a-f-]{36}$/);
    });

    await test.step('Day close: yesterday’s miss adds $1 to what Maya owes on the rule', async () => {
      // As if the rule were made yesterday: its start, and the days it has worked out.
      sql(`update public.penalty_rule set start_date = '${yesterday}', accrued_through = '${addDays(today, -2)}'
            where id = '${ruleId()}'`);
      sql(`select private.generate_occurrences('${HOUSEHOLD}', '${yesterday}', '${yesterday}')`);
      sql(`select public.close_household_day('${HOUSEHOLD}')`);
      await expect.poll(misses).toBe(`100@${yesterday}`);
      await page.goto(`/admin/members/${mayaId}?open=penalties`);
      // The household is a copy of the demo family, which has its own rule on Maya ("Folder
      // home"), so this rule's line is found by its id.
      const line = page
        .getByRole('list', { name: 'What Maya owes' })
        .locator(`[data-rule="${ruleId()}"]`);
      await expect(line).toContainText(RULE);
      await expect(line).toContainText('$1');
    });

    await test.step('Mark done on time on yesterday takes the $1 back', async () => {
      await page.goto(`/admin/today?date=${yesterday}`);
      const row = page.locator('li.fw-day__row').filter({ hasText: ITEM });
      await expect(row).toContainText('Missed');
      await row.locator('details.fw-ontime > summary').click();
      const mark = row.getByRole('button', { name: `Mark ${ITEM} done on time` });
      await mark.click();
      // A goal of Maya's it changes asks first (D-151); then it is marked.
      const trace = row.locator('.fw-ontime__trace');
      await expect(trace.or(row.getByRole('status'))).toBeVisible();
      if (!(await trace.isVisible())) await mark.click();
      await expect(trace).toHaveText(/^Marked on time by Alex, \w+ \d+$/);
      await expect.poll(misses).toBe('');
      expect(
        sql(`select taken_back_on_time from public.penalty p join public.penalty_rule r on r.id = p.rule_id
              where r.household_id = '${HOUSEHOLD}' and r.name = '${RULE}'`),
      ).toBe('t');
    });
  } finally {
    // The rule ends, nothing it added is owed, and the chore leaves the list.
    sql(`update public.penalty set taken_back_at = now()
          where rule_id in (select id from public.penalty_rule where household_id = '${HOUSEHOLD}' and name = '${RULE}')
            and taken_back_at is null`);
    sql(`update public.penalty_rule set end_date = greatest(start_date, '${addDays(householdToday(db!, HOUSEHOLD), -1)}'::date)
          where household_id = '${HOUSEHOLD}' and name = '${RULE}'`);
    sql(`update public.chore set archived_at = now() where id = '${CHORE}'`);
  }
});
