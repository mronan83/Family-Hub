import { expect, test, type Page } from '@playwright/test';
import { sql as query } from '../support/db';

// [CHR-14][CHR-15][ACC-04] "Which one is you?" on the preview (D-61), as Alex of the demo family: a
// sign-in linked to no one links itself in one tap from Reminders or My tasks; a parent whose own
// record says Child is told to choose Adult, then links from their member page; and a sign-in left on
// an archived record moves to the one still here. Alex is put back as he was, an adult with his own
// sign-in.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const ALEX_SIGN_IN = '0de00000-0000-4000-8000-0000000000a1';
const OLD = 'Alex (old record)';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let page: Page;
const alex = () =>
  sql(`select id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`);
const linked = () =>
  sql(`select string_agg(display_name, ',' order by display_name) from public.member
        where household_id = '${DEMO}' and user_id = '${ALEX_SIGN_IN}'`);

function putBack() {
  sql(`delete from public.member where household_id = '${DEMO}' and display_name = '${OLD}';
       update public.member set role = 'adult', user_id = '${ALEX_SIGN_IN}'
        where household_id = '${DEMO}' and display_name = 'Alex';`);
}

function unlink(extra = '') {
  sql(`update public.member set user_id = null${extra} where id = '${alex()}'`);
}

test.beforeAll(async ({ browser }) => {
  putBack();
  page = await browser.newPage();
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
});

test.afterAll(() => putBack());

for (const [path, title, done] of [
  ['/admin/reminders', 'Reminders', 'Linked: these are your reminders now.'],
  ['/admin/my', 'My tasks', 'Linked: you’re Alex. These are your tasks.'],
] as const) {
  test(`[CHR-14][CHR-15][US-316] ${title}, not linked: “I’m Alex” links him in one tap`, async () => {
    unlink();
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    const choose = page.getByRole('region', { name: 'Which one is you?' });
    // Sam has his own sign-in, so Alex is the only adult offered.
    await expect(
      choose.getByRole('list', { name: 'Adults without a sign-in' }).getByRole('button'),
    ).toHaveText(['I’m Alex']);
    await choose.getByRole('button', { name: 'I’m Alex' }).click();
    await page.waitForURL(new RegExp(`${path}\\?did=linked`));
    await expect(page.getByText(done)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Which one is you?' })).toHaveCount(0);
    expect(linked()).toBe('Alex');
  });
}

test('[ACC-04][US-316] his record says Child: told to choose Adult, then “This is me” on his page', async () => {
  unlink(`, role = 'child'`);
  await page.goto('/admin/reminders');
  const choose = page.getByRole('region', { name: 'Which one is you?' });
  await expect(choose).toContainText('Every adult in the family already has a sign-in.');
  await expect(choose).toContainText(
    'if your record says Child, open it on Members and choose Adult',
  );

  await page.goto(`/admin/members/${alex()}`);
  const form = page.getByRole('form', { name: 'Edit member' });
  await expect(form.getByTestId('sign-in-child')).toHaveText(
    'Only an adult can have a sign-in. Choose Adult above to link one.',
  );
  // Only an adult can be linked, so there's nothing to link yet.
  await expect(page.getByRole('region', { name: 'Is this you?' })).toHaveCount(0);
  await form.getByLabel('Adult', { exact: true }).check();
  await expect(form.getByRole('combobox', { name: /^Their sign-in/ })).toBeVisible();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForURL(/\/admin\/members\?saved=Alex/);
  expect(
    sql(
      `select role || ' ' || coalesce(user_id::text, 'none') from public.member where id = '${alex()}'`,
    ),
  ).toBe('adult none');

  await page.goto(`/admin/members/${alex()}`);
  const me = page.getByRole('region', { name: 'Is this you?' });
  await expect(me).toContainText('Your sign-in isn’t linked to anyone yet.');
  await me.getByRole('button', { name: 'This is me' }).click();
  await page.waitForURL(/\/admin\/members\/[0-9a-f-]+\?did=linked/);
  await expect(page.getByText('Linked: you’re Alex now.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Is this you?' })).toHaveCount(0);
  expect(linked()).toBe('Alex');
});

test('[ACC-04][US-316] his sign-in left on an archived record: named, then moved to him', async () => {
  unlink();
  sql(`insert into public.member (household_id, display_name, role, color, user_id, archived_at)
       values ('${DEMO}', '${OLD}', 'adult', 'member-5', '${ALEX_SIGN_IN}', now())`);
  await page.goto(`/admin/members/${alex()}`);
  // The sign-in choice says where his sign-in went, rather than leaving it out without a word.
  await expect(page.getByRole('form', { name: 'Edit member' })).toContainText(
    `Already linked: alex@demo.familywise.invalid to ${OLD} (archived)`,
  );
  const me = page.getByRole('region', { name: 'Is this you?' });
  await expect(me).toContainText(`Your sign-in is on ${OLD}, who is archived. Move it here`);
  await me.getByRole('button', { name: 'This is me' }).click();
  await expect(page.getByText('Linked: you’re Alex now.')).toBeVisible();
  expect(linked()).toBe('Alex');
});
