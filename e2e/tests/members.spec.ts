import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [ACC-04][PTS-07] Members on the preview, as Alex of the demo family (D-37, D-39): add a child and
// an adult, check the earns-rewards default, change it, link an adult to an admin, archive and
// restore. The database is read with psql to confirm what was saved.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const SAM = '0de00000-0000-4000-8000-0000000000a2';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

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

async function addMember(page: Page, name: string, role: 'Child' | 'Adult') {
  await page.getByRole('link', { name: 'Add a member' }).click();
  const form = page.getByRole('form', { name: 'Add a member' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel(role, { exact: true }).check();
  return form;
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  // A retry starts from the seeded demo family.
  sql(`delete from public.member where household_id = '${DEMO}' and display_name in ('Ava', 'Pat');
       update public.member set user_id = '${SAM}', archived_at = null
        where household_id = '${DEMO}' and display_name = 'Sam';
       update public.member set archived_at = null where household_id = '${DEMO}';`);
});

test('[ACC-04] the demo family lists its children and adults', async ({ page }) => {
  await asAlex(page);
  const list = page.getByRole('list', { name: 'Members', exact: true });
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) await expect(list).toContainText(name);
  await expect(list).toContainText('Signs in as sam@demo.familywise.invalid');
  await expectContrastOk(page);
});

test('[ACC-04][PTS-07] a new child earns rewards by default; a new adult does not', async ({
  page,
}) => {
  await asAlex(page);
  let form = await addMember(page, 'Ava', 'Child');
  await expect(form.getByRole('switch', { name: 'Earns rewards' })).toBeChecked();
  await expectContrastOk(page);
  // The pickers show the avatar or swatch; the radio inside each is visually hidden.
  for (const name of ['Cat', 'Green']) {
    await form.locator('label', { has: page.getByRole('radio', { name, exact: true }) }).click();
    await expect(form.getByRole('radio', { name, exact: true })).toBeChecked();
  }
  await form.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Ava.');

  form = await addMember(page, 'Pat', 'Adult');
  await expect(form.getByRole('switch', { name: 'Earns rewards' })).not.toBeChecked();
  await form.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Pat.');

  expect(
    sql(`select string_agg(display_name || ':' || role || ':' || earns_rewards || ':' || coalesce(avatar_key, '-')
                           || ':' || color || ':' || coalesce(user_id::text, '-'), ',' order by display_name)
           from public.member where household_id = '${DEMO}' and display_name in ('Ava', 'Pat')`),
  ).toBe('Ava:child:true:cat:member-5:-,Pat:adult:false:owl:member-1:-');
});

test('[PTS-07] the switch can be changed for anyone', async ({ page }) => {
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Pat' }).click();
  const form = page.getByRole('form', { name: 'Edit member' });
  await form.getByRole('switch', { name: 'Earns rewards' }).check();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
    'Pat · Adult · Earns rewards',
  );
  expect(
    sql(
      `select earns_rewards from public.member where household_id = '${DEMO}' and display_name = 'Pat'`,
    ),
  ).toBe('t');
});

test('[ACC-04] an adult is linked to an admin, and only to one member', async ({ page }) => {
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Sam' }).click();
  let form = page.getByRole('form', { name: 'Edit member' });
  await form.getByLabel('Their sign-in').selectOption('');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved Sam.');
  expect(
    sql(
      `select coalesce(user_id::text, '-') from public.member where household_id = '${DEMO}' and display_name = 'Sam'`,
    ),
  ).toBe('-');

  // Now Pat could take Sam's sign-in; give it back to Sam instead.
  await page.getByRole('link', { name: 'Edit Sam' }).click();
  form = page.getByRole('form', { name: 'Edit member' });
  await form.getByLabel('Their sign-in').selectOption({ label: 'sam@demo.familywise.invalid' });
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
    'Signs in as sam@demo.familywise.invalid',
  );
  expect(
    sql(
      `select user_id from public.member where household_id = '${DEMO}' and display_name = 'Sam'`,
    ),
  ).toBe(SAM);

  // Alex's and Sam's sign-ins are taken by their own members, so Pat is not offered them.
  await page.getByRole('link', { name: 'Edit Pat' }).click();
  // allTextContents does not wait, so wait for the edit page first.
  await expect(page.getByRole('heading', { name: 'Pat', level: 1 })).toBeVisible();
  const options = await page.getByLabel('Their sign-in').locator('option').allTextContents();
  expect(options[0]).toBe('Not linked');
  expect(options).not.toContain('alex@demo.familywise.invalid');
  expect(options).not.toContain('sam@demo.familywise.invalid');
});

test('[ACC-04] archiving takes a member off the list and keeps them; restoring brings them back', async ({
  page,
}) => {
  const since = sql('select now()');
  await asAlex(page);
  await page.getByRole('link', { name: 'Edit Ava' }).click();
  await page.getByRole('button', { name: 'Archive Ava' }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).not.toContainText('Ava');
  await expect(page.getByRole('list', { name: 'Archived members' })).toContainText('Ava');
  expect(
    sql(
      `select archived_at is not null from public.member where household_id = '${DEMO}' and display_name = 'Ava'`,
    ),
  ).toBe('t');

  await page.getByRole('button', { name: 'Restore Ava' }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText('Ava');
  expect(
    sql(`select count(*) from public.audit_log where household_id = '${DEMO}' and entity_type = 'member'
           and actor_id = '0de00000-0000-4000-8000-0000000000a1' and action = 'update' and diff ? 'archived_at' and at >= '${since}'`),
  ).toBe('2');
});
