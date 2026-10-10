import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

// [RWD-01][RWD-04][RWD-06][RWD-09] Goals on the preview (WP-19, D-56), as Alex of the demo family. The
// done-when: the seeded "Movie night" (Leo, 19 things done since last week; he has 18) becomes
// achieved when today's bed is done, goes back to going when a parent unchecks it, and is achieved
// again (achievement 2); and a goal whose stored progress is deliberately spoiled and marked dirty is
// healed. Previews run no jobs, so here the Goals page evaluates what needs it before it reads (the
// job does the same in production, lib/jobs/goals.test.ts). Then: Maya's achieved goal is redeemed,
// and a goal is set through the form and cancelled. Leo's bed is put back as the seed left it.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MOVIE = '0de00000-0000-4000-8000-000000060001';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const TODAY = `(now() at time zone 'America/New_York')::date`;

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}
const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const leoBed = () =>
  sql(`select id from public.chore_occurrence where chore_id = '${MAKE_BED}' and due_date = ${TODAY}
         and member_id = '${memberId('Leo')}'`);
const movie = () =>
  sql(`select g.status || ':' || g.achievement_count || ':' || p.pct
         from public.reward_goal g join public.reward_goal_progress p on p.goal_id = g.id where g.id = '${MOVIE}'`);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
});

test.afterAll(async () => {
  // Leo's bed as the seed left it: still to do today.
  const bed = leoBed();
  if (sql(`select status from public.chore_occurrence where id = '${bed}'`) !== 'scheduled') {
    sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
         values (gen_random_uuid(), '${bed}', 'admin_uncomplete', now())`);
  }
  // And his goal worked out again, so it is going as the seed left it: a goal left reached would open
  // every later spec's board on its celebration (WP-20).
  await admin.goto('/admin/goals');
  await expect(goal('Movie night')).not.toContainText('Achieved');
});

const inPlay = () => admin.getByRole('list', { name: 'Goals in play' });
const goal = (title: string) => inPlay().getByRole('listitem').filter({ hasText: title });

async function setBed(action: 'Mark' | 'Uncheck') {
  await admin.goto('/admin/today');
  if (action === 'Mark') {
    await admin.getByRole('button', { name: 'Mark Make bed (Leo) done', exact: true }).click();
    await expect(admin.getByRole('status')).toHaveText('Marked Make bed (Leo) done.');
  } else {
    await admin.getByRole('button', { name: 'Uncheck Make bed (Leo)', exact: true }).click();
    await expect(admin.getByRole('status')).toContainText('Unchecked Make bed (Leo).');
  }
}

test('[RWD-04][US-401] the seeded goals, worked out by the engine when the Goals page opens', async () => {
  expect(sql(`select status from public.chore_occurrence where id = '${leoBed()}'`)).toBe(
    'scheduled',
  );
  await admin.goto('/admin/goals');
  await expect(admin.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
  await expect(goal('Movie night')).toContainText('Going');
  await expect(
    goal('Movie night').getByRole('progressbar', { name: '19 things done' }),
  ).toHaveAttribute('aria-valuenow', '95');
  await expect(goal('Movie night')).toContainText('18 of 19 · 95%');
  // Maya's 5 good days in a row (a miss a week forgiven) were already reached.
  await expect(goal('Trip to the park')).toContainText('Achieved');
  await expect(goal('Pizza night')).toContainText('The whole family');
  expect(movie()).toBe('active:0:94.74');
});

test('[RWD-04][US-409] achieved by the deciding check-off, back to going when it is unchecked, achieved again', async () => {
  await setBed('Mark');
  await admin.goto('/admin/goals');
  await expect(goal('Movie night')).toContainText('Achieved');
  await expect(admin.getByRole('button', { name: 'Mark Movie night redeemed' })).toBeVisible();
  expect(movie()).toBe('achieved:1:100.00');

  await setBed('Uncheck');
  await admin.goto('/admin/goals');
  await expect(goal('Movie night')).toContainText('Going');
  await expect(admin.getByRole('button', { name: 'Mark Movie night redeemed' })).toHaveCount(0);
  expect(movie()).toBe('active:1:94.74');
  expect(
    sql(
      `select achieved_at is null and celebrated_at is null from public.reward_goal where id = '${MOVIE}'`,
    ),
  ).toBe('t');

  await setBed('Mark');
  await admin.goto('/admin/goals');
  await expect(goal('Movie night')).toContainText('Achieved again');
  expect(movie()).toBe('achieved:2:100.00');
  expect(
    sql(`select string_agg(type || coalesce(':' || (payload ->> 'n'), ''), ',' order by id)
           from public.reward_goal_event where goal_id = '${MOVIE}'`),
  ).toBe('created,activated,achieved:1,unachieved:1,achieved:2');
});

test('[RWD-04][US-407] a goal whose stored progress is spoiled and marked dirty is healed', async () => {
  sql(`update public.reward_goal_progress set pct = 3, dirty = true, marked_at = clock_timestamp()
        where goal_id = '${MOVIE}';
       update public.reward_rule_progress set current_value = 1, pct = 5 where goal_id = '${MOVIE}'`);
  await admin.goto('/admin/goals');
  await expect(
    goal('Movie night').getByRole('progressbar', { name: '19 things done' }),
  ).toHaveAttribute('aria-valuenow', '100');
  expect(movie()).toBe('achieved:2:100.00');
  expect(
    sql(`select dirty || ':' || (select current_value from public.reward_rule_progress where goal_id = '${MOVIE}')
           from public.reward_goal_progress where goal_id = '${MOVIE}'`),
  ).toBe('false:19');
  // Healing changes no status, so nothing new is logged.
  expect(sql(`select count(*) from public.reward_goal_event where goal_id = '${MOVIE}'`)).toBe('5');
});

test('[RWD-09][US-405] an achieved goal is marked redeemed: it moves to history with who and when', async () => {
  await admin.goto('/admin/goals');
  await admin.getByRole('button', { name: 'Mark Trip to the park redeemed', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Marked redeemed. It’s in the history.');
  await expect(goal('Trip to the park')).toHaveCount(0);
  await expect(
    admin
      .getByRole('list', { name: 'History' })
      .getByRole('listitem')
      .filter({ hasText: 'Trip to the park' }),
  ).toContainText(/Redeemed .* by Alex/);
});

test('[RWD-01][RWD-06] a parent sets a goal through the form, then cancels it', async () => {
  await admin.goto('/admin/goals');
  await admin.getByRole('link', { name: 'Set a goal' }).click();
  const form = admin.getByRole('form', { name: 'Set a goal' });
  await form.getByLabel('Name', { exact: true }).fill('Bike ride e2e');
  await form.getByRole('radio', { name: 'Maya', exact: true }).check();
  await form.getByRole('combobox', { name: 'Counts' }).selectOption('COUNT');
  // The number field: the icon picker has a "target" icon too.
  await form.getByRole('spinbutton', { name: 'Target', exact: true }).fill('3');
  await form.getByRole('radio', { name: 'Some tags', exact: true }).check();
  await form.getByRole('checkbox', { name: 'Morning', exact: true }).check();
  await form.getByRole('button', { name: 'Set goal' }).click();
  await expect(admin.getByRole('status')).toHaveText('Saved Bike ride e2e.');
  await expect(goal('Bike ride e2e')).toContainText('Maya · Started');
  await expect(goal('Bike ride e2e')).toContainText('3 things done, tagged Morning');
  expect(
    sql(`select g.status || ':' || r.rule_type || ':' || r.target from public.reward_goal g
           join public.reward_rule r on r.goal_id = g.id where g.household_id = '${DEMO}' and g.title = 'Bike ride e2e'`),
  ).toBe('active:COUNT:3');

  await admin.getByRole('link', { name: 'Change Bike ride e2e' }).click();
  await admin.getByRole('button', { name: 'Cancel Bike ride e2e', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Cancelled. It’s in the history.');
  await expect(
    admin
      .getByRole('list', { name: 'History' })
      .getByRole('listitem')
      .filter({ hasText: 'Bike ride e2e' }),
  ).toContainText('Cancelled');
});
