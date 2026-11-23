import { expect, test } from '../support/test';
import { serviceRpc, sql as query } from '../support/db';
import { addDays, householdToday } from '../support/day';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [PTS-11][US-1113][D-158] Penalties paid back through a goal on the preview (WP-122), as Alex of the
// spec's own household (a copy of the demo family: penalties on, its reasons). One story: a weekly goal
// of Maya's and a chore of hers are made for this spec; Alex adds a rule for the chore in Settings,
// paid back $1 a week won by the goal; the rule is moved back a day and the chore missed yesterday, so
// day close adds $1 to what Maya owes. A won week, saved as the goals job saves it, pays back the $1
// (on her page too); the week undone takes the payback back, so the $1 is owed again. The database
// agrees at each step. Afterwards the rule ends, its misses are taken back, and the goal and the chore
// are archived.
const family = ownHousehold('penalty-paybacks');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const ITEM = `Folder in the bag e2e ${TAG}`;
const RULE = `Folder back e2e ${TAG}`;
const GOAL_TITLE = `Folder week e2e ${TAG}`;
const CHORE = crypto.randomUUID();
const GOAL = crypto.randomUUID();
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

const maya = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Maya'`);
const ruleId = () =>
  sql(
    `select id from public.penalty_rule where household_id = '${HOUSEHOLD}' and name = '${RULE}'`,
  );
/** What the rule has on Maya, in cents. */
const owed = () =>
  sql(`select private.penalty_rule_held(r.id, rm.member_id)
         from public.penalty_rule r join public.penalty_rule_member rm on rm.rule_id = r.id
        where r.household_id = '${HOUSEHOLD}' and r.name = '${RULE}'`);
/** The goal's paybacks on the rule: amount, and whether taken back. */
const paybacks = () =>
  sql(`select coalesce(string_agg(b.amount || case when b.taken_back_at is null then '' else ' back' end, ','
                                  order by b.paid_at), '')
         from public.penalty_payback b where b.goal_id = '${GOAL}'`);

/** Last week of the goal as the goals job sends it: won, or missed. */
async function saveWeek(today: string, outcome: 'won' | 'missed') {
  const start = addDays(today, -13);
  const goal = sql(
    `select status || ',' || rules_version from public.reward_goal where id = '${GOAL}'`,
  ).split(',');
  const { error } = await serviceRpc(db!).rpc('save_goal_evaluation', {
    p_goal: GOAL,
    p_status: goal[0],
    p_rules_version: Number(goal[1]),
    p_evaluation: {
      goal_id: GOAL,
      pct: 40,
      is_achieved: false,
      rules: [],
      transitions: [],
      periods: [
        {
          start,
          end: addDays(start, 6),
          outcome,
          next_start: addDays(start, 7),
          pct: outcome === 'won' ? 100 : 40,
          days_due: 5,
          days_done: outcome === 'won' ? 5 : 4,
          days_missed: outcome === 'won' ? 0 : 1,
          misses_allowed: 0,
        },
      ],
    },
    p_engine_version: 4,
    p_read_at: new Date().toISOString(),
  });
  expect(error, `the week saved ${outcome}`).toBeNull();
}

test('[PTS-11-m][US-1113] a rule paid back by a weekly goal: a won week pays back, undone it is owed again', async ({
  page,
}) => {
  const today = householdToday(db!, HOUSEHOLD);
  const yesterday = addDays(today, -1);
  const mayaId = maya();
  // Maya's weekly goal and her chore for this spec, once, yesterday, not done.
  sql(`insert into public.reward_goal (id, household_id, member_id, title, start_date, status, repeats)
       values ('${GOAL}', '${HOUSEHOLD}', '${mayaId}', '${GOAL_TITLE}', '${addDays(today, -20)}', 'active', 'week')`);
  sql(`insert into public.chore (id, household_id, title, kind, points, schedule, start_date, approval)
       values ('${CHORE}', '${HOUSEHOLD}', '${ITEM}', 'chore', 2,
               jsonb_build_object('freq', 'once', 'on_date', '${yesterday}'), '${yesterday}', 'none')`);
  sql(`insert into public.chore_assignee (household_id, chore_id, member_id)
       values ('${HOUSEHOLD}', '${CHORE}', '${mayaId}')`);
  try {
    await signIn(page);

    await test.step('Settings: Add a rule for Maya’s chore, paid back $1 a week won by her goal', async () => {
      await page.goto('/admin/settings/penalties/rules/new');
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
      await form.getByLabel('Goal or reward').selectOption({ label: `${GOAL_TITLE} · each week` });
      await form.getByLabel('Each win pays back').fill('1');
      await form.getByRole('button', { name: 'Save the rule' }).click();
      const line = page
        .getByRole('list', { name: 'Penalty rules' })
        .getByRole('listitem')
        .filter({ hasText: RULE });
      await expect(line).toContainText('Nothing owed · payback paused');
      await expect
        .poll(() => sql(`select payback_amount from public.penalty_rule where id = '${ruleId()}'`))
        .toBe('100');
    });

    await test.step('Day close: yesterday’s miss adds $1 to what Maya owes', async () => {
      sql(`update public.penalty_rule set start_date = '${yesterday}', accrued_through = '${addDays(today, -2)}'
            where id = '${ruleId()}'`);
      sql(`select private.generate_occurrences('${HOUSEHOLD}', '${yesterday}', '${yesterday}')`);
      sql(`select public.close_household_day('${HOUSEHOLD}')`);
      await expect.poll(owed).toBe('100');
    });

    await test.step('A won week pays back the $1, and Maya’s page says so', async () => {
      await saveWeek(today, 'won');
      await expect.poll(paybacks).toBe('100');
      await expect.poll(owed).toBe('0');
      await page.goto(`/admin/members/${mayaId}?open=penalties`);
      await expect(
        page
          .getByRole('list', { name: 'Maya’s penalties' })
          .getByRole('listitem')
          .filter({ hasText: `${GOAL_TITLE}, week won` }),
      ).toContainText('−$1 owed');
    });

    await test.step('The week undone takes the payback back: the $1 is owed again', async () => {
      await saveWeek(today, 'missed');
      await expect.poll(paybacks).toBe('100 back');
      await expect.poll(owed).toBe('100');
    });
  } finally {
    // The rule ends, nothing it added is owed, and the goal and the chore leave their lists.
    sql(`update public.penalty set taken_back_at = now()
          where rule_id in (select id from public.penalty_rule where household_id = '${HOUSEHOLD}' and name = '${RULE}')
            and taken_back_at is null`);
    sql(`update public.penalty_rule set end_date = greatest(start_date, '${addDays(householdToday(db!, HOUSEHOLD), -1)}'::date)
          where household_id = '${HOUSEHOLD}' and name = '${RULE}'`);
    sql(`update public.reward_goal set archived_at = now() where id = '${GOAL}'`);
    sql(`update public.chore set archived_at = now() where id = '${CHORE}'`);
  }
});
