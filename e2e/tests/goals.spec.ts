import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { householdToday } from '../support/day';
import { foldOf, unfold } from '../support/fold';
import { signIn } from '../support/session';

// [RWD-01][RWD-04][RWD-06][RWD-09] Goals on the preview (WP-19, D-56), as Alex of the demo family. The
// done-when: the seeded "Movie night" (Leo, 19 things done since last week; he has 18) becomes
// achieved when today's bed is done, goes back to going when a parent unchecks it, and is achieved
// again (achievement 2); and a goal whose stored progress is deliberately spoiled and marked dirty is
// healed. Previews run no jobs, so here the Goals page evaluates what needs it before it reads (the
// job does the same in production, lib/jobs/goals.test.ts). Then: Maya's achieved goal is redeemed,
// and a goal is set through the form and cancelled. Afterwards Leo's bed is put back as the seed left
// it, Maya's goal is achieved again (not redeemed), and the goal the form set is deleted.
//
// "Trip to the park" (STREAK 5, a miss a week forgiven) is reached on any weekday the seed is loaded:
// of Maya's seven seeded days only the bed missed 3 days ago is bad (always forgiven: it is the only
// one), and only the day of the latest homework, waiting for a parent, is open, so at least 5 are good.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const MOVIE = '0de00000-0000-4000-8000-000000060001';
const PARK = '0de00000-0000-4000-8000-000000060002';
const MAKE_BED = '0de00000-0000-4000-8000-0000000c0001';
const BIKE = `Bike ride e2e ${Math.random().toString(36).slice(2, 6)}`;
const sql = (q: string) => query(db!, q);

const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const movie = () =>
  sql(`select g.status || ':' || g.achievement_count || ':' || p.pct
         from public.reward_goal g join public.reward_goal_progress p on p.goal_id = g.id where g.id = '${MOVIE}'`);
/** A parent's uncheck of one occurrence, as the admin app records it. */
const uncheck = (occurrence: string) =>
  sql(`insert into public.chore_completion_event (id, occurrence_id, event_type, occurred_at)
       values (gen_random_uuid(), '${occurrence}', 'admin_uncomplete', now())`);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
/** Leo's bed today, found once: put back by its id, so the family's midnight can't move it. */
let leoBed = '';

test.beforeAll(async ({ browser }, testInfo) => {
  const today = householdToday(db!);
  const leo = memberId('Leo');
  leoBed = sql(`select id from public.chore_occurrence where chore_id = '${MAKE_BED}'
                  and due_date = '${today}' and member_id = '${leo}'`);
  // "18 of 19" counts everything Leo has done since the goal started, today included: anything of his
  // an earlier spec left done today is put back first, and named.
  const left = sql(`select coalesce(string_agg(o.id || ' ' || c.title, ','), '')
                      from public.chore_occurrence o join public.chore c on c.id = o.chore_id
                     where o.household_id = '${DEMO}' and o.due_date = '${today}'
                       and (o.member_id = '${leo}' or '${leo}' = any (o.done_by))
                       and o.status in ('completed', 'approved')`);
  for (const item of left ? left.split(',') : []) {
    const [id, ...title] = item.split(' ');
    uncheck(id!);
    testInfo.annotations.push({
      type: 'put back',
      description: `Leo's ${title.join(' ')} was left done today by an earlier spec`,
    });
  }
  admin = await browser.newPage();
  await signIn(admin);
});

test.afterAll(async () => {
  // Leo's bed as the seed left it: still to do today.
  if (
    leoBed &&
    sql(`select status from public.chore_occurrence where id = '${leoBed}'`) !== 'scheduled'
  ) {
    uncheck(leoBed);
  }
  // Maya's goal achieved again, as the Goals page first worked it out, not redeemed.
  sql(`update public.reward_goal set status = 'achieved', redeemed_at = null, redeemed_by = null
        where id = '${PARK}' and status = 'redeemed';
       delete from public.reward_goal_event where goal_id = '${PARK}' and type = 'redeemed';
       delete from public.reward_goal where household_id = '${DEMO}' and title = '${BIKE}';`);
  // And his goal worked out again, so it is going as the seed left it: a goal left reached would open
  // every later spec's board on its celebration (WP-20).
  await admin.goto('/admin/goals');
  await expect(goal('Movie night')).not.toContainText('Achieved');
  await admin.context().close();
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

// One story on Movie night, from the seed: worked out when the Goals page opens, achieved, unachieved,
// achieved again, healed. Each step needs the one before, so they are one test (D-110).
test('[RWD-04][US-401][US-409][US-407] the seeded goals worked out when the Goals page opens; achieved by the deciding check-off, back to going when it is unchecked, achieved again; spoiled progress is healed', async () => {
  // Three check-offs (two server round trips each), four Goals pages that work goals out before they
  // render, and psql reads: up to about 60 s on a slow preview, so 3x that.
  test.setTimeout(180_000);
  await test.step('the seeded goals, worked out by the engine when the Goals page opens', async () => {
    expect(sql(`select status from public.chore_occurrence where id = '${leoBed}'`)).toBe(
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
    await expect(
      goal('Trip to the park'),
      `Maya's streak goal, seeded reached, reads: ${sql(`select r.current_value || ' of ' || r.target_value
         from public.reward_rule_progress r where r.goal_id = '${PARK}'`)}`,
    ).toContainText('Achieved');
    await expect(goal('Pizza night')).toContainText('The whole family');
    expect(movie()).toBe('active:0:94.74');
  });

  await test.step('achieved by the deciding check-off', async () => {
    await setBed('Mark');
    await admin.goto('/admin/goals');
    await expect(goal('Movie night')).toContainText('Achieved');
    await expect(admin.getByRole('button', { name: 'Mark Movie night redeemed' })).toBeVisible();
    expect(movie()).toBe('achieved:1:100.00');
  });

  await test.step('back to going when a parent unchecks it', async () => {
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
  });

  await test.step('achieved again, as achievement 2', async () => {
    await setBed('Mark');
    await admin.goto('/admin/goals');
    await expect(goal('Movie night')).toContainText('Achieved again');
    expect(movie()).toBe('achieved:2:100.00');
    expect(
      sql(`select string_agg(type || coalesce(':' || (payload ->> 'n'), ''), ',' order by id)
           from public.reward_goal_event where goal_id = '${MOVIE}'`),
    ).toBe('created,activated,achieved:1,unachieved:1,achieved:2');
  });

  await test.step('a goal whose stored progress is spoiled and marked dirty is healed', async () => {
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
    expect(sql(`select count(*) from public.reward_goal_event where goal_id = '${MOVIE}'`)).toBe(
      '5',
    );
  });
});

test('[RWD-09][US-405] an achieved goal is marked redeemed: it moves to history with who and when', async () => {
  await admin.goto('/admin/goals');
  await admin.getByRole('button', { name: 'Mark Trip to the park redeemed', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Marked redeemed. It’s in the history.');
  await expect(goal('Trip to the park')).toHaveCount(0);
  // History is folded (D-120, WP-80).
  await unfold(foldOf(admin, 'History'));
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
  await form.getByLabel('Name', { exact: true }).fill(BIKE);
  await form.getByRole('radio', { name: 'Maya', exact: true }).check();
  await form.getByRole('combobox', { name: 'Counts' }).selectOption('COUNT');
  // The number field: the icon picker has a "target" icon too.
  await form.getByRole('spinbutton', { name: 'Target', exact: true }).fill('3');
  await form.getByRole('radio', { name: 'Some tags', exact: true }).check();
  await form.getByRole('checkbox', { name: 'Morning', exact: true }).check();
  await form.getByRole('button', { name: 'Set goal' }).click();
  await expect(admin.getByRole('status')).toHaveText(`Saved ${BIKE}.`);
  await expect(goal(BIKE)).toContainText('Maya · Started');
  await expect(goal(BIKE)).toContainText('3 things done, tagged Morning');
  expect(
    sql(`select g.status || ':' || r.rule_type || ':' || r.target from public.reward_goal g
           join public.reward_rule r on r.goal_id = g.id where g.household_id = '${DEMO}' and g.title = '${BIKE}'`),
  ).toBe('active:COUNT:3');

  await admin.getByRole('link', { name: `Change ${BIKE}` }).click();
  // Cancel is set apart at the bottom, folded (D-120, WP-80).
  await unfold(foldOf(admin, 'Cancel'));
  await admin.getByRole('button', { name: `Cancel ${BIKE}`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Cancelled. It’s in the history.');
  await unfold(foldOf(admin, 'History'));
  await expect(
    admin.getByRole('list', { name: 'History' }).getByRole('listitem').filter({ hasText: BIKE }),
  ).toContainText('Cancelled');
});
