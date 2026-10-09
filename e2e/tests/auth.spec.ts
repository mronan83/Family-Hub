import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// [ACC-01][ACC-02][ACC-03][ACC-05] Admin sign-in, invites and setup on the preview, as the demo
// sign-ins (D-39). scripts/preview-db.sh has just reset the demo family and set their passwords.
// The database is reached with psql for what a person would get by other means: a setup code from
// the workflow, an invite that has run out, and the audit rows.
const db = process.env.SUPABASE_DB_URL;
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const email = (who: string) => `${who}@demo.familywise.invalid`;

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

async function oneTap(page: Page, name: string) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: `Sign in as ${name}` }).click();
  await page.waitForURL(/\/(admin|setup)/);
}

async function newInviteLink(page: Page, to: string): Promise<string> {
  await page.getByLabel('Their email').fill(to);
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await page.getByTestId('invite-link').textContent())?.trim() ?? '';
  expect(link).toMatch(/\/invite#[0-9a-f]{48}$/);
  return link;
}

test.describe.configure({ mode: 'serial' });
test.skip(
  !db || !secret,
  'needs SUPABASE_DB_URL and the bypass secret (the e2e workflow has both)',
);

test.beforeAll(() => {
  // A retry starts from the state preview-db.sh left: only demo sign-ins and the demo family.
  sql(`delete from public.household h where h.id <> '${DEMO}' and exists (
         select from public.household_user hu join auth.users u on u.id = hu.user_id
          where hu.household_id = h.id and u.email = '${email('riley')}');
       delete from public.household_user where household_id = '${DEMO}'
          and user_id in (select id from auth.users where email in ('${email('jordan')}', '${email('riley')}'));
       delete from public.invite where household_id = '${DEMO}';`);
});

test('[ACC-02] signed out, the admin app asks you to sign in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
});

test('[ACC-02] one tap signs a preview in as Alex, who sees the demo family', async ({ page }) => {
  await oneTap(page, 'Alex');
  await expect(page.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  const admins = page.getByRole('region', { name: 'Admins' });
  await expect(admins).toContainText(email('alex'));
  await expect(admins).toContainText(email('sam'));
});

test('[ACC-02] a refused password gets one neutral line; the right one signs in', async ({
  page,
}) => {
  await page.goto('/sign-in');
  const form = page.getByRole('form', { name: 'Sign in with password' });
  await form.getByLabel('Email').fill(email('sam'));
  await form.getByLabel('Password').fill('not-the-password');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.getByRole('status')).toHaveText(
    'That email and password don’t match an account. Check both and try again.',
  );
  const password = createHmac('sha256', secret!)
    .update(`familywise demo sign-in ${email('sam')}`)
    .digest('hex');
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
});

test('[ACC-03] Alex invites Jordan, Jordan joins, and the link works only once', async ({
  browser,
}) => {
  const since = sql('select now()');
  const alex = await browser.newPage();
  await oneTap(alex, 'Alex');
  const link = await newInviteLink(alex, email('jordan'));
  await expect(alex.getByRole('list', { name: 'Open invites' })).toContainText(email('jordan'));

  const jordan = await browser.newPage();
  await oneTap(jordan, 'Jordan');
  await expect(jordan).toHaveURL(/\/setup$/);
  await jordan.goto(link);
  await expect(jordan.getByRole('heading', { name: 'Join Demo family' })).toBeVisible();
  await jordan.getByRole('button', { name: 'Join household' }).click();
  await expect(jordan.getByRole('heading', { name: 'Demo family', level: 1 })).toBeVisible();
  await expect(jordan.getByRole('region', { name: 'Admins' })).toContainText(email('jordan'));

  await jordan.goto(link);
  await expect(jordan.getByRole('status')).toContainText('That invite was already used.');

  // ACC-05: the invite and the join were audited, with who did each.
  expect(
    sql(`select string_agg(a.entity_type || ':' || a.action || ':' || u.email, ',' order by a.id)
           from public.audit_log a join auth.users u on u.id = a.actor_id
          where a.household_id = '${DEMO}' and a.entity_type in ('invite', 'household_user')
            and a.action = 'insert' and a.at >= '${since}'`),
  ).toBe(`invite:insert:${email('alex')},household_user:insert:${email('jordan')}`);
  expect(
    sql(
      `select count(*) from public.audit_log where household_id = '${DEMO}' and diff ? 'token_hash'`,
    ),
  ).toBe('0');
});

test('[ACC-03] an expired invite is turned away', async ({ browser }) => {
  const alex = await browser.newPage();
  await oneTap(alex, 'Alex');
  const link = await newInviteLink(alex, email('riley'));
  sql(`update public.invite set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where household_id = '${DEMO}' and email = '${email('riley')}' and accepted_at is null`);

  const riley = await browser.newPage();
  await oneTap(riley, 'Riley');
  await riley.goto(link);
  await expect(riley.getByRole('status')).toContainText('That invite has expired.');
});

test('[ACC-01] Riley starts a household with a setup code and becomes its owner', async ({
  page,
}) => {
  const code = randomBytes(6).toString('hex').toUpperCase();
  sql(`insert into private.household_setup_code (code_hash, expires_at)
       values (private.code_hash('${code}'), now() + interval '1 hour')`);

  await oneTap(page, 'Riley');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Setup code').fill(code.toLowerCase().replace(/(.{4})/g, '$1-'));
  await page.getByLabel('Household name').fill('Riley e2e household');
  await page.getByLabel('Timezone').selectOption('America/Chicago');
  await page.getByLabel('Week starts on').selectOption('1');
  await page.getByRole('button', { name: 'Create household' }).click();

  await expect(page.getByRole('heading', { name: 'Riley e2e household', level: 1 })).toBeVisible();
  await expect(page.getByText('America/Chicago · Week starts on Monday')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Admins' })).toContainText('Owner');
  expect(
    sql(`select a.actor_type || ':' || u.email from public.audit_log a
           join public.household h on h.id = a.household_id
           join auth.users u on u.id = a.actor_id
          where h.name = 'Riley e2e household' and a.entity_type = 'household' and a.action = 'insert'`),
  ).toBe(`admin:${email('riley')}`);

  // Now that Riley runs a household, setup sends them home.
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/admin$/);
});

test('[ACC-02] signing out ends the session', async ({ page }) => {
  await oneTap(page, 'Alex');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in$/);
});
