import { expect, test, type Page } from '@playwright/test';
import { sql as query } from '../support/db';

// [CHR-15][CHR-16][CHR-17] A parent's own reminders on the preview (WP-40, D-58), as Alex of the demo
// family: his settings saved and read back, a device switched off, tested and removed, the bell on
// an item in My tasks, and an item's reminder lead time in the editor. Sending is tested on the
// runner against a mocked push service (reminders-job.spec.ts); a preview holds no VAPID private key,
// so a test notification says it works on the live app. Everything it changes it puts back.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const TRIP_FEE = '0de00000-0000-4000-8000-0000000c0007';
const sql = (q: string) => query(db!, q);
const ENDPOINT = 'https://push.familywise.invalid/rmd-ui-e2e';

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let page: Page;
const alex = () =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`);

function putBack() {
  sql(`delete from public.reminder_preference where member_id = '${alex()}';
       delete from public.push_subscription where endpoint = '${ENDPOINT}';
       update public.chore_assignee set remind = null where chore_id = '${TRIP_FEE}';
       update public.chore set remind_lead_minutes = null where id = '${TRIP_FEE}';`);
}

test.beforeAll(async ({ browser }) => {
  putBack();
  page = await browser.newPage();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
});

test.afterAll(() => putBack());

test('[CHR-15][CHR-16][CHR-17][US-319] Alex’s own settings: off until he turns them on; saved and read back', async () => {
  await page.goto('/admin/reminders');
  await expect(page.getByRole('heading', { name: 'Reminders', level: 1 })).toBeVisible();
  await expect(page.getByText('Off. Nothing is sent to you.')).toBeVisible();
  // Turning on asks the browser for permission only after the tap; without web push keys on this
  // deployment, the page says so instead.
  await expect(
    page
      .getByRole('button', { name: 'Turn on reminders' })
      .or(page.getByText('Reminders aren’t set up on this site yet.')),
  ).toBeVisible();

  const form = page.getByRole('form', { name: 'When to remind me' });
  await form.getByRole('combobox', { name: /^Remind me/ }).selectOption('60');
  await form.getByLabel(/no due time/).fill('07:30');
  await form.getByRole('checkbox', { name: 'Send me a summary of my day' }).check();
  await form.getByLabel(/^At/).fill('06:45');
  await form.getByRole('checkbox', { name: 'Hold reminders during quiet hours' }).check();
  await form.getByLabel('From', { exact: true }).fill('22:00');
  await form.getByLabel('To', { exact: true }).fill('06:30');
  await form.getByRole('checkbox', { name: /Hide the names of private items/ }).uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  expect(
    sql(`select concat_ws('|', enabled, default_lead_minutes, morning_time, digest_time, quiet_start, quiet_end,
                          hide_private_titles)
           from public.reminder_preference where member_id = '${alex()}'`),
  ).toBe('f|60|07:30:00|06:45:00|22:00:00|06:30:00|f');

  await page.reload();
  await expect(form.getByRole('combobox', { name: /^Remind me/ })).toHaveValue('60');
  await expect(form.getByLabel('From', { exact: true })).toHaveValue('22:00');
  await expect(form.getByRole('checkbox', { name: /Hide the names/ })).not.toBeChecked();
});

test('[CHR-15][US-317] a device: switched off and on, a test (live app only), removed', async () => {
  const user = sql(`select user_id from public.member where id = '${alex()}'`);
  sql(`insert into public.push_subscription (household_id, member_id, user_id, endpoint, p256dh, auth_secret, device_label)
       values ('${DEMO}', '${alex()}', '${user}', '${ENDPOINT}', '${'B'.repeat(87)}', '${'a'.repeat(22)}', 'E2E phone')`);
  await page.goto('/admin/reminders');
  const devices = page.getByRole('list', { name: 'My devices' });
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(devices).toContainText('E2E phone');

  await devices.getByRole('button', { name: 'Switch off E2E phone' }).click();
  await expect(page.getByRole('status')).toHaveText('That device is switched off.');
  await expect(devices.getByRole('button', { name: 'Send a test to E2E phone' })).toBeDisabled();
  expect(sql(`select enabled from public.push_subscription where endpoint = '${ENDPOINT}'`)).toBe(
    'f',
  );
  await devices.getByRole('button', { name: 'Switch on E2E phone' }).click();
  await expect(page.getByRole('status')).toHaveText('That device is switched on.');

  await devices.getByRole('button', { name: 'Send a test to E2E phone' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Test notifications work on the live app once reminders are set up there.',
  );

  await devices.getByRole('button', { name: 'Remove E2E phone' }).click();
  await expect(page.getByRole('status')).toHaveText('Removed. That device gets nothing more.');
  expect(sql(`select count(*) from public.push_subscription where endpoint = '${ENDPOINT}'`)).toBe(
    '0',
  );
});

test('[CHR-16][US-318] the bell on an item in My tasks: off for this item only, then on again', async () => {
  await page.goto('/admin/my');
  const bell = page.getByRole('button', { name: 'Remind me about Pay the school trip fee' });
  // His default is "remind me", so the bell is on until he says otherwise.
  await expect(bell).toHaveAttribute('aria-pressed', 'true');
  await bell.click();
  await expect(page.getByRole('status')).toHaveText('Pay the school trip fee won’t remind you.');
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  expect(
    sql(
      `select remind from public.chore_assignee where chore_id = '${TRIP_FEE}' and member_id = '${alex()}'`,
    ),
  ).toBe('f');
  await bell.click();
  await expect(page.getByRole('status')).toHaveText('Pay the school trip fee reminds you.');
  await expect(bell).toHaveAttribute('aria-pressed', 'true');
});

test('[CHR-16] an item’s reminder lead time, in the editor', async () => {
  await page.goto(`/admin/chores/${TRIP_FEE}`);
  const select = page.getByRole('combobox', { name: /^Reminders/ });
  await expect(select).toHaveValue('');
  await select.selectOption('1440');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Pay the school trip fee');
  expect(sql(`select remind_lead_minutes from public.chore where id = '${TRIP_FEE}'`)).toBe('1440');
});
