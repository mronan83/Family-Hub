import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { foldOf, unfold } from '../support/fold';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [PTS-01][PTS-02][PTS-07] Points on the preview, as Alex of the demo family (WP-16): each child's
// balance on Members, their history on their page, and a parent adding and taking away points with a
// reason. Expectations start from the database, so a retry or an earlier spec's check-offs still add
// up. The database is read with psql to confirm what was posted.
const family = ownHousehold('points');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const ALEX = family.own('0de00000-0000-4000-8000-0000000000a1');

const sql = (q: string) => query(db!, q);

const memberId = (name: string) =>
  sql(
    `select id from public.member where household_id = '${HOUSEHOLD}' and display_name = '${name}'`,
  );
const balance = (id: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${id}'`),
  );
/** The balance as the Points section's own chip shows it (the first chip; entries follow it). */
const shown = (page: Page) =>
  page.getByRole('region', { name: 'Points' }).locator('.fw-points__value').first();

async function asAlex(page: Page) {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Members' })
    .click();
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
}

/** Opens a member's Points and Change points: both folded until a change (D-120, WP-95). */
async function openPoints(page: Page) {
  await unfold(foldOf(page, 'Points'));
  await unfold(foldOf(page, 'Change points'));
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
  await expect(
    page
      .getByRole('list', { name: 'Members', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Leo' }),
  ).toContainText(`Child · Earns rewards · ${points} points`);
  await page.getByRole('link', { name: 'Edit Leo' }).click();
  const section = page.getByRole('region', { name: 'Points' });
  await expect(shown(page)).toHaveText(points.toLocaleString('en-US'));
  // His latest 30 entries, newest first: the specs before this one add today's, so the seed's older
  // ones may be further back. Each says where its points came from: the item's title for a check-off,
  // the reason for anything else, as the database has them (a private item may show as private, so it
  // isn't checked). Who made an adjustment is checked below.
  const history = section.getByRole('list', { name: 'Leo’s points' });
  const entries = Number(
    sql(`select count(*) from public.points_ledger where member_id = '${leo}'`),
  );
  await expect(history.getByRole('listitem')).toHaveCount(Math.min(entries, 30));
  const sources = sql(`select string_agg(distinct label, E'\n') from (
                         select case when l.occurrence_id is null then l.reason
                                     when c.visibility = 'family' then c.title end as label
                           from public.points_ledger l
                           left join public.chore_occurrence o on o.id = l.occurrence_id
                           left join public.chore c on c.id = o.chore_id
                          where l.member_id = '${leo}'
                          order by l.created_at desc, l.id desc limit 30) x`)
    .split('\n')
    .filter(Boolean);
  expect(sources.length, 'where Leo’s latest points came from, in the database').toBeGreaterThan(0);
  for (const source of sources) await expect(history).toContainText(source);
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
  await openPoints(page);

  let form = page.getByRole('form', { name: 'Change Leo’s points' });
  await form.getByLabel('Add', { exact: true }).check();
  await form.getByLabel('Points', { exact: true }).fill('5');
  await form.getByLabel('Why').fill(reason);
  await form.getByRole('button', { name: 'Add points' }).click();
  const section = page.getByRole('region', { name: 'Points' });
  await expect(section).toContainText('Added 5 points.');
  await expect(shown(page)).toHaveText((before + 5).toLocaleString('en-US'));
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

test('[PTS-01-b][NFR-18] Alex changes Maya’s points and finds Points open after the save', async ({
  page,
}) => {
  const maya = memberId('Maya');
  const before = balance(maya);
  const reason = `Watered the plants ${Date.now()}`;
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Maya' }).click();
  // Folded, Points says the balance.
  const points = foldOf(page, 'Points');
  await expect(points).not.toHaveAttribute('open');
  // As balanceText says it: no thousands separator, a true minus sign.
  await expect(points.locator(':scope > summary')).toContainText(
    `${before < 0 ? '−' : ''}${Math.abs(before)} ${Math.abs(before) === 1 ? 'point' : 'points'} · last:`,
  );
  await openPoints(page);
  const change = async (direction: 'Add' | 'Take away', why: string) => {
    const form = page.getByRole('form', { name: 'Change Maya’s points' });
    await form.getByLabel(direction, { exact: true }).check();
    await form.getByLabel('Points', { exact: true }).fill('4');
    await form.getByLabel('Why').fill(why);
    await form.getByRole('button', { name: `${direction} points` }).click();
  };
  try {
    await change('Add', reason);
    // The page comes back with Points open, and Change points with it; Archive stays folded.
    await expect(page.getByRole('region', { name: 'Points' })).toContainText('Added 4 points.');
    await expect(points).toHaveAttribute('open', '');
    await expect(foldOf(page, 'Change points')).toHaveAttribute('open', '');
    await expect(foldOf(page, 'Archive')).not.toHaveAttribute('open');
    await expect(shown(page)).toHaveText((before + 4).toLocaleString('en-US'));
    await expect(
      page.getByRole('list', { name: 'Maya’s points' }).getByRole('listitem').first(),
    ).toContainText(`Today ${reason} · by Alex`);
  } finally {
    // Maya's balance as it was: the ledger is never edited, so the 4 points are taken away again.
    if (balance(maya) === before + 4) {
      await openPoints(page);
      await change('Take away', `${reason}, put back`);
      await expect(page.getByRole('region', { name: 'Points' })).toContainText(
        'Took away 4 points.',
      );
    }
  }
  expect(balance(maya)).toBe(before);
});

test('[PTS-01] a reason is required, and an empty one is caught before anything is posted', async ({
  page,
}) => {
  const leo = memberId('Leo');
  const before = balance(leo);
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Leo' }).click();
  await openPoints(page);
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
