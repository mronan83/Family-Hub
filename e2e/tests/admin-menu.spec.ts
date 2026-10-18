import { expect, test } from '../support/test';
import { sql as query } from '../support/db';
import { openSetting } from '../support/settings';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [NFR-15][US-107] The admin menu and Settings on the preview (WP-51, D-81), as Alex of the demo
// family: Today carries how many check-offs wait for a parent, as the database counts them; Settings
// has its seven pages (Family options first since WP-57), each saying how it stands; Tags is one of them, and a page Settings holds has
// the way back.
const family = ownHousehold('admin-menu');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test('[NFR-15][US-107] the menu, Today’s count, and Settings with Tags among its pages', async ({
  page,
}) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Admin' });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  const waiting = Number(
    sql(`select count(*) from public.chore_occurrence
          where household_id = '${HOUSEHOLD}' and status = 'pending_approval'`),
  );
  await expect(nav.getByRole('link', { name: /^Today/ })).toHaveAccessibleName(
    waiting ? `Today, ${waiting} waiting for you` : 'Today',
  );

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const tiles = page.getByRole('list', { name: 'Settings', exact: true }).getByRole('link');
  await expect(tiles.locator('.fw-settings__name')).toHaveText([
    'Family options',
    'School',
    'Calendars',
    'Boards',
    'Tags',
    'Reminders',
    'Health',
  ]);
  const tags = Number(
    sql(
      `select count(*) from public.tag where household_id = '${HOUSEHOLD}' and archived_at is null`,
    ),
  );
  await expect(tiles.nth(4).locator('.fw-settings__status')).toHaveText(
    tags ? `${tags} tag${tags === 1 ? '' : 's'}` : 'No tags yet',
  );

  await openSetting(page, 'Tags');
  await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await page.locator('.fw-crumb').click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
});

test('[NFR-14-y] a spec signs in to its own household: its admins are its own copies of Alex and Sam', async ({
  page,
}) => {
  for (const who of ['Alex', 'Sam'] as const) {
    await signIn(page, who);
    // [ACC-08] The admins are in Settings, Family options (WP-57, D-84).
    await page.goto('/admin/settings/family');
    const admins = page.getByRole('region', { name: 'Admins' });
    await expect(admins).toContainText(family.email('sam'));
    const emails = ((await admins.textContent()) ?? '').match(/[\w.+-]+@[\w.-]+\.invalid/g) ?? [];
    expect([...new Set(emails)].sort()).toEqual([family.email('alex'), family.email('sam')]);
    await page.context().clearCookies();
  }
});
