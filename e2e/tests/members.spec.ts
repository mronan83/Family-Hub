import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [ACC-04][PTS-07] Members on the preview, as Alex of the demo family (D-37, D-39): add a child and
// an adult, check the earns-rewards default, change it, link an adult to an admin, archive and
// restore. The database is read with psql to confirm what was saved. Each test adds the members it
// needs, named for this run; they are deleted at the end, and Sam keeps his sign-in.
const family = ownHousehold('members');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const SAM = family.own('0de00000-0000-4000-8000-0000000000a2');
const RUN = Math.random().toString(36).slice(2, 6);
const AVA = `Ava ${RUN}`;
const PAT = `Pat ${RUN}`;
const ROBIN = `Robin ${RUN}`;
const KIM = `Kim ${RUN}`;
const NOA = `Noa ${RUN}`;
const MADE = [AVA, PAT, ROBIN, KIM, NOA].map((n) => `'${n}'`).join(', ');
const sql = (q: string) => query(db!, q);

/** A member added straight to the demo family, for a test that only needs one to be there. */
const addByDb = (name: string, role: 'child' | 'adult') =>
  sql(`insert into public.member (household_id, display_name, role)
       values ('${HOUSEHOLD}', '${name}', '${role}') returning id`);
/** Sam's own sign-in, as the seed left it. */
const relinkSam = () =>
  sql(
    `update public.member set user_id = '${SAM}' where household_id = '${HOUSEHOLD}' and display_name = 'Sam'`,
  );

async function expectContrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

async function asAlex(page: Page) {
  await signIn(page);
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

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(relinkSam);

test.afterAll(() => {
  // Only the members this run added, by name; Sam's sign-in as the seed left it.
  sql(
    `delete from public.member where household_id = '${HOUSEHOLD}' and display_name in (${MADE})`,
  );
  relinkSam();
});

test('[ACC-04] the demo family lists its children and adults', async ({ page }) => {
  await asAlex(page);
  const list = page.getByRole('list', { name: 'Members', exact: true });
  for (const name of ['Maya', 'Leo', 'Alex', 'Sam']) await expect(list).toContainText(name);
  await expect(list).toContainText(`Signs in as ${family.email('sam')}`);
  await expectContrastOk(page);
});

test('[ACC-04][PTS-07] a new child earns rewards by default; a new adult does not', async ({
  page,
}) => {
  await asAlex(page);
  let form = await addMember(page, AVA, 'Child');
  await expect(form.getByRole('switch', { name: 'Earns rewards' })).toBeChecked();
  await expectContrastOk(page);
  // The pickers show the avatar or swatch; the radio inside each is visually hidden.
  for (const name of ['Cat', 'Green']) {
    await form.locator('label', { has: page.getByRole('radio', { name, exact: true }) }).click();
    await expect(form.getByRole('radio', { name, exact: true })).toBeChecked();
  }
  await form.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved ${AVA}.`);

  form = await addMember(page, PAT, 'Adult');
  await expect(form.getByRole('switch', { name: 'Earns rewards' })).not.toBeChecked();
  await form.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toHaveText(`Saved ${PAT}.`);

  expect(
    sql(`select string_agg(display_name || ':' || role || ':' || earns_rewards || ':' || coalesce(avatar_key, '-')
                           || ':' || color || ':' || coalesce(user_id::text, '-'), ',' order by display_name)
           from public.member where household_id = '${HOUSEHOLD}' and display_name in ('${AVA}', '${PAT}')`),
  ).toBe(`${AVA}:child:true:cat:member-5:-,${PAT}:adult:false:owl:member-1:-`);
});

test('[PTS-07] the switch can be changed for anyone', async ({ page }) => {
  // An adult, who doesn't earn rewards when added.
  addByDb(ROBIN, 'adult');
  await asAlex(page);
  await page.getByRole('link', { name: `Edit ${ROBIN}` }).click();
  const form = page.getByRole('form', { name: 'Edit member' });
  await form.getByRole('switch', { name: 'Earns rewards' }).check();
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
    `${ROBIN} · Adult · Earns rewards`,
  );
  expect(
    sql(
      `select earns_rewards from public.member where household_id = '${HOUSEHOLD}' and display_name = '${ROBIN}'`,
    ),
  ).toBe('t');
});

test('[ACC-04] an adult is linked to an admin, and only to one member', async ({ page }) => {
  // Another adult, to see which sign-ins they are offered.
  addByDb(KIM, 'adult');
  await asAlex(page);
  try {
    await page.getByRole('link', { name: 'Edit Sam' }).click();
    let form = page.getByRole('form', { name: 'Edit member' });
    await form.getByLabel('Their sign-in').selectOption('');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved Sam.');
    expect(
      sql(
        `select coalesce(user_id::text, '-') from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Sam'`,
      ),
    ).toBe('-');

    // Now Kim could take Sam's sign-in; give it back to Sam instead.
    await page.getByRole('link', { name: 'Edit Sam' }).click();
    form = page.getByRole('form', { name: 'Edit member' });
    await form.getByLabel('Their sign-in').selectOption({ label: family.email('sam') });
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(
      `Signs in as ${family.email('sam')}`,
    );
    expect(
      sql(
        `select user_id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Sam'`,
      ),
    ).toBe(SAM);

    // Alex's and Sam's sign-ins are taken by their own members, so Kim is not offered them.
    await page.getByRole('link', { name: `Edit ${KIM}` }).click();
    // allTextContents does not wait, so wait for the edit page first.
    await expect(page.getByRole('heading', { name: KIM, level: 1 })).toBeVisible();
    const options = await page.getByLabel('Their sign-in').locator('option').allTextContents();
    expect(options[0]).toBe('Not linked');
    expect(options).not.toContain(family.email('alex'));
    expect(options).not.toContain(family.email('sam'));
  } finally {
    // Sam keeps his sign-in even when a step above failed between unlinking and linking him again.
    relinkSam();
  }
});

test('[ACC-04] archiving takes a member off the list and keeps them; restoring brings them back', async ({
  page,
}) => {
  const noa = addByDb(NOA, 'child');
  const since = sql('select now()');
  await asAlex(page);
  await page.getByRole('link', { name: `Edit ${NOA}` }).click();
  await page.getByRole('button', { name: `Archive ${NOA}` }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).not.toContainText(NOA);
  await expect(page.getByRole('list', { name: 'Archived members' })).toContainText(NOA);
  expect(sql(`select archived_at is not null from public.member where id = '${noa}'`)).toBe('t');

  await page.getByRole('button', { name: `Restore ${NOA}` }).click();
  await expect(page.getByRole('list', { name: 'Members', exact: true })).toContainText(NOA);
  expect(
    sql(`select count(*) from public.audit_log where household_id = '${HOUSEHOLD}' and entity_type = 'member'
           and entity_id = '${noa}' and actor_id = '${family.own('0de00000-0000-4000-8000-0000000000a1')}'
           and action = 'update' and diff ? 'archived_at' and at >= '${since}'`),
  ).toBe('2');
});
