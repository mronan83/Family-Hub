import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

// [PTS-05][PTS-06] Bonus rules and the wishlist on the preview (WP-30, D-57), as Alex of the demo
// family with a paired board. Leo's seeded last week (see insights.spec.ts) has runs good 2, bad 1,
// good 3, bad 1: a "3 good days in a row" bonus counting from a week ago pays him once, for the run
// that began 4 days ago, and paying again pays nothing. On the board Leo chooses a wish and changes
// his mind; Maya's seeded wish shows her balance against its cost. The rule is archived and the
// board removed at the end; the bonus stays in the ledger (it never changes) until the next reseed.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Wish e2e';
const MOVIE_NIGHT = '0de00000-0000-4000-8000-0000000e0001';
const STAY_UP = '0de00000-0000-4000-8000-0000000e0003';
const RULE = '7 points for 3 good days in a row';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}
const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const balance = (member: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${member}'`),
  );
/** The household's date `days` from today, as YYYY-MM-DD. */
const householdDay = (days: number) =>
  sql(`select to_char((now() at time zone timezone)::date + ${days}, 'YYYY-MM-DD')
         from public.household where id = '${DEMO}'`);
const pin = (member: string) =>
  sql(`select coalesce((select catalog_item_id || ':' || pinned_by_type from public.wishlist_pin
                         where member_id = '${member}'), 'none')`);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;
let ruleId = '';

test.beforeAll(async ({ browser }) => {
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  // Leave nothing pinned for Leo and no board behind; the archived rule pays nothing more.
  sql(`delete from public.wishlist_pin where member_id = '${memberId('Leo')}';
       delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
});

test('[PTS-05][US-1107] a streak bonus pays once for a run that reaches it; paying again pays nothing', async () => {
  const leo = memberId('Leo');
  // His history as the seed left it (opening Insights brings it up to date).
  await admin.goto(`/admin/insights?member=${leo}&days=7`);
  await expect(admin.getByRole('region', { name: 'Streaks' })).toContainText('Best good run3 days');
  const before = balance(leo);

  await admin.goto('/admin/rewards');
  await admin.getByText('Add a bonus', { exact: true }).click();
  const form = admin.getByRole('form', { name: 'Add a bonus', exact: true });
  await form.getByRole('radio', { name: 'A streak', exact: true }).check();
  await form.getByLabel('Good days in a row', { exact: true }).fill('3');
  await form.getByLabel('Bonus points', { exact: true }).fill('7');
  // (Its label also holds the help line.)
  await form.getByLabel('Counts from').fill(householdDay(-7));
  await form.getByRole('button', { name: 'Add bonus', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(
    'Bonus added. It pays overnight, once a day is over.',
  );
  const rules = admin.getByRole('list', { name: 'Bonus points', exact: true });
  await expect(rules.getByRole('listitem').filter({ hasText: RULE })).toContainText('counts from');
  ruleId = sql(`select id from public.points_rule where household_id = '${DEMO}'
                  and archived_at is null and streak_days = 3 and bonus_points = 7`);
  expect(sql(`select created_by is not null from public.points_rule where id = '${ruleId}'`)).toBe(
    't',
  );

  // Paying brings each child's history up to date first, then pays every earner's good runs of 3
  // or more that reached 3 on or after the date: Leo's among them.
  await admin.getByRole('button', { name: 'Pay bonuses now', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(/^Paid (one bonus|\d+ bonuses)\.$/);
  const expected = Number(
    sql(`select count(*) from public.streak_segment s
           join public.member m on m.id = s.member_id and m.earns_rewards and m.archived_at is null
          where s.household_id = '${DEMO}' and s.kind = 'good' and s.length_days >= 3
            and s.start_date + 2 >= '${householdDay(-7)}'::date`),
  );
  await expect(admin.getByRole('status')).toHaveText(
    expected === 1 ? 'Paid one bonus.' : `Paid ${expected} bonuses.`,
  );
  // Leo's: one, for the run that began 4 days ago, posted by the system and naming the rule.
  expect(
    sql(`select string_agg(amount || ':' || reason || ':' || created_by_type || ':' || dedupe_key, ',')
           from public.points_ledger where member_id = '${leo}' and points_rule_id = '${ruleId}'`),
  ).toBe(`7:3 good days in a row:system:rule:${ruleId}:${leo}:${householdDay(-4)}`);
  expect(balance(leo)).toBe(before + 7);

  // The done-when: paying again pays nothing.
  await admin.getByRole('button', { name: 'Pay bonuses now', exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('No new bonuses to pay.');
  expect(sql(`select count(*) from public.points_ledger where points_rule_id = '${ruleId}'`)).toBe(
    String(expected),
  );
  expect(balance(leo)).toBe(before + 7);
});

test('[PTS-05] a bonus turned off pays nothing; back on it counts from today; archived, its bonuses stay', async () => {
  const leo = memberId('Leo');
  const paid = balance(leo);
  const rules = admin.getByRole('list', { name: 'Bonus points', exact: true });
  await rules.getByRole('button', { name: `Turn off: ${RULE}`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText(
    'Turned off. It pays nothing until it’s back on.',
  );
  await expect(rules.getByRole('listitem').filter({ hasText: RULE })).toContainText('· off');
  await expect(admin.getByRole('button', { name: 'Pay bonuses now' })).toHaveCount(0);

  await rules.getByRole('button', { name: `Turn on: ${RULE}`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Turned on. It counts from today.');
  expect(sql(`select counts_from from public.points_rule where id = '${ruleId}'`)).toBe(
    householdDay(0),
  );

  await rules.getByRole('button', { name: `Archive: ${RULE}`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Archived. Bonuses it paid stay.');
  await expect(admin.getByRole('list', { name: 'Archived bonuses', exact: true })).toContainText(
    RULE,
  );
  expect(sql(`select archived_at is not null from public.points_rule where id = '${ruleId}'`)).toBe(
    't',
  );
  expect(balance(leo)).toBe(paid);
});

test('[PTS-06][US-1108] on the board Leo chooses a wish, sees how far he is, and changes his mind', async () => {
  const leo = memberId('Leo');
  const maya = memberId('Maya');
  const people = board.getByRole('list', { name: 'Family', exact: true });

  // Maya's seeded wish: her balance against Movie night's 100.
  await people.getByRole('button', { name: 'Maya', exact: true }).click();
  const card = board.getByRole('region', { name: 'Saving for', exact: true });
  await expect(card).toContainText('Movie night');
  const hers = Math.min(Math.max(balance(maya), 0), 100);
  await expect(card.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    `${hers} of 100, ${hers}%`,
  );

  // Leo has none yet; he picks Stay up 30 minutes late (25).
  await people.getByRole('button', { name: 'Leo', exact: true }).click();
  await expect(card).toContainText('Pick a reward from the shop to save up for.');
  await card.getByRole('button', { name: 'Choose a wish', exact: true }).click();
  const picker = board.getByRole('dialog', { name: 'What is Leo saving for?' });
  await picker.getByRole('button', { name: /Stay up 30 minutes late/ }).click();
  await expect(card).toContainText('Stay up 30 minutes late');
  await expect.poll(() => pin(leo)).toBe(`${STAY_UP}:device`);
  const his = balance(leo);
  await expect(card).toContainText(
    his >= 25 ? 'You have enough! Ask a grown-up for it.' : `${25 - his} more`,
  );

  // A parent sees who is saving for what.
  await admin.goto('/admin/rewards');
  const shop = admin.getByRole('list', { name: 'The shop', exact: true });
  await expect(
    shop.getByRole('listitem').filter({ hasText: 'Stay up 30 minutes late' }),
  ).toContainText('Leo is saving for it');
  await expect(shop.getByRole('listitem').filter({ hasText: 'Movie night' })).toContainText(
    'Maya is saving for it',
  );

  // He changes his mind: no wish.
  await card.getByRole('button', { name: 'Change', exact: true }).click();
  await picker.getByRole('button', { name: 'No wish', exact: true }).click();
  await expect(card).toContainText('Pick a reward from the shop to save up for.');
  await expect.poll(() => pin(leo)).toBe('none');
  expect(pin(maya)).toBe(`${MOVIE_NIGHT}:admin`);
});

test('[PTS-06] the wishes API: only for a child who earns, only a reward in the shop, JSON only', async () => {
  const wish = (member: string, item: string | null) =>
    board.request.post('/api/wishes', { data: { member_id: member, item_id: item } });
  let res = await wish(memberId('Alex'), STAY_UP);
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: 'not_earning' });
  res = await wish(memberId('Leo'), crypto.randomUUID());
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_in_shop' });
  res = await wish('not-a-member', STAY_UP);
  expect(res.status()).toBe(400);
  res = await board.request.post('/api/wishes', {
    form: { member_id: memberId('Leo'), item_id: STAY_UP },
  });
  expect(res.status()).toBe(415);
  // Pinning the same again changes nothing; unpinning leaves nothing.
  const leo = memberId('Leo');
  expect((await wish(leo, STAY_UP)).status()).toBe(200);
  expect((await wish(leo, STAY_UP)).status()).toBe(200);
  expect(sql(`select count(*) from public.wishlist_pin where member_id = '${leo}'`)).toBe('1');
  expect((await wish(leo, null)).status()).toBe(200);
  expect(pin(leo)).toBe('none');
});
