import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [PTS-01][PTS-02][PTS-07] Points on the preview, as Alex of the demo family (WP-16): each child's
// balance on Members, their history on their page, and a parent adding and taking away points with a
// reason. Expectations start from the database, so a retry or an earlier spec's check-offs still add
// up. The database is read with psql to confirm what was posted.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const ALEX = '0de00000-0000-4000-8000-0000000000a1';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const memberId = (name: string) =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = '${name}'`);
const balance = (id: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${id}'`),
  );

async function asAlex(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex' }).click();
  await page.waitForURL(/\/admin/);
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Members' })
    .click();
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test("[PTS-02] Members shows each child's balance; their page shows where it came from", async ({
  page,
}) => {
  const leo = memberId('Leo');
  const points = balance(leo);
  expect(points).toBeGreaterThan(10); // last week's chores and Alex's thank-you (the seed)
  await asAlex(page);
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
    `Leo · Child · Earns rewards · ${points} points`,
  );
  await page.getByRole('link', { name: 'Edit Leo' }).click();
  const section = page.getByRole('region', { name: 'Points' });
  await expect(section).toContainText(String(points));
  // His latest 30 entries, newest first: the specs before this one add today's, so the seed's older
  // ones (Alex's thank-you among them) may be further back. Who made an adjustment is checked below.
  const history = section.getByRole('list', { name: 'Leo’s points' });
  const entries = Number(
    sql(`select count(*) from public.points_ledger where member_id = '${leo}'`),
  );
  await expect(history.getByRole('listitem')).toHaveCount(Math.min(entries, 30));
  await expect(history).toContainText('Set the table');
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
});

test('[PTS-01] a parent adds and takes away points with a reason; each is kept, never edited', async ({
  page,
}) => {
  const leo = memberId('Leo');
  const before = balance(leo);
  const reason = `Tidied the garage ${Date.now()}`;
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Leo' }).click();

  let form = page.getByRole('form', { name: 'Change Leo’s points' });
  await form.getByLabel('Add', { exact: true }).check();
  await form.getByLabel('Points', { exact: true }).fill('5');
  await form.getByLabel('Why').fill(reason);
  await form.getByRole('button', { name: 'Add points' }).click();
  const section = page.getByRole('region', { name: 'Points' });
  await expect(section).toContainText('Added 5 points.');
  await expect(section).toContainText(String(before + 5));
  const newest = section.getByRole('list', { name: 'Leo’s points' }).getByRole('listitem').first();
  await expect(newest).toContainText(`Today ${reason} · by Alex`);
  await expect(newest).toContainText('+5');
  expect(
    sql(`select entry_type || ':' || amount || ':' || created_by_type || ':' || created_by
           from public.points_ledger where member_id = '${leo}' and reason = '${reason}'`),
  ).toBe(`adjustment:5:admin:${ALEX}`);

  form = page.getByRole('form', { name: 'Change Leo’s points' });
  await form.getByLabel('Take away', { exact: true }).check();
  await form.getByLabel('Points', { exact: true }).fill('3');
  await form.getByLabel('Why').fill(`${reason}, but left the rake out`);
  await form.getByRole('button', { name: 'Take away points' }).click();
  await expect(section).toContainText('Took away 3 points.');
  expect(balance(leo)).toBe(before + 2);
  // The first adjustment is still there as it was.
  expect(
    sql(
      `select count(*) from public.points_ledger where member_id = '${leo}' and reason = '${reason}'`,
    ),
  ).toBe('1');
});

test('[PTS-01] a reason is required, and an empty one is caught before anything is posted', async ({
  page,
}) => {
  const leo = memberId('Leo');
  const before = balance(leo);
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Leo' }).click();
  const form = page.getByRole('form', { name: 'Change Leo’s points' });
  await form.getByLabel('Points', { exact: true }).fill('4');
  await form.getByLabel('Why').fill('   ');
  await form.getByRole('button', { name: 'Add points' }).click();
  await expect(form).toContainText('Say why, in up to 200 characters.');
  expect(balance(leo)).toBe(before);
});

test('[PTS-07] a member who does not earn rewards has no points to change', async ({ page }) => {
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Sam' }).click();
  await expect(page.getByRole('heading', { name: 'Sam', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Points' })).toHaveCount(0);
});
