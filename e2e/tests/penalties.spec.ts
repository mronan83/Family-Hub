import { expect, test } from '../support/test';
import { sql as query } from '../support/db';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [PTS-09][US-1111][D-156] Penalties on the preview (WP-120), as Alex of the spec's own household (a
// copy of the demo family: penalties on, its four reasons). One story: Alex turns penalties off and on
// in Settings and adds a reason in money; gives Leo a money penalty with it and a points penalty
// ("Rude to a sibling") from Home; on Leo's page records part of the money paid and takes the points
// penalty back. The database agrees at each step. Afterwards the money penalty is taken back and the
// reason removed, so Leo owes nothing and his points are as they were.
const family = ownHousehold('penalties');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const TAG = Math.random().toString(36).slice(2, 6);
const REASON = `Late for dinner e2e ${TAG}`;
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

const leo = () =>
  sql(`select id from public.member where household_id = '${HOUSEHOLD}' and display_name = 'Leo'`);
const balance = (id: string) =>
  Number(
    sql(`select coalesce(sum(amount), 0) from public.points_ledger where member_id = '${id}'`),
  );
const penaltiesOn = () =>
  sql(`select penalties_on from public.household_settings where household_id = '${HOUSEHOLD}'`);
/** What Leo owes on this spec's reason, in cents ('' while there is no penalty). */
const owed = (id: string) =>
  sql(`select p.amount - coalesce((select sum(x.amount) from public.penalty_payment x where x.penalty_id = p.id), 0)
         from public.penalty p where p.member_id = '${id}' and p.reason = '${REASON}' and p.taken_back_at is null`);

test('[PTS-09-m][US-1111] a parent turns penalties on, adds a reason, gives, records paid and takes back', async ({
  page,
}) => {
  const leoId = leo();
  const before = balance(leoId);
  try {
    await signIn(page);

    await test.step('Settings: off, then on, and a reason in money', async () => {
      await page.goto('/admin/settings/penalties');
      const toggle = page.getByRole('switch', { name: 'Penalties' });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(page.getByRole('heading', { name: 'Penalties are off' })).toBeVisible();
      await expect.poll(penaltiesOn).toBe('f');
      await page.getByRole('switch', { name: 'Penalties' }).click();
      await expect(page.getByRole('heading', { name: 'Penalties are on' })).toBeVisible();
      await expect.poll(penaltiesOn).toBe('t');
      const add = page.getByRole('form', { name: 'Add a reason' });
      await add.getByLabel('Add a reason').fill(REASON);
      await add.getByRole('radio', { name: 'Money' }).check();
      await add.getByLabel('Amount').fill('1.50');
      await add.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByText('Reason added.')).toBeVisible();
      await expect(
        page
          .getByRole('list', { name: 'Penalty reasons' })
          .getByRole('listitem')
          .filter({ hasText: REASON }),
      ).toContainText('$1.50');
    });

    await test.step('Home: a money penalty and a points penalty for Leo', async () => {
      for (const [reason, amount] of [
        [REASON, '1.50'],
        ['Rude to a sibling', '10'],
      ] as const) {
        await page.goto('/admin');
        const form = page.getByRole('form', { name: 'Give a penalty' });
        await form.getByRole('radio', { name: 'Leo' }).check();
        await form.getByRole('radio', { name: new RegExp(`^${reason}`) }).check();
        await expect(form.getByLabel(/^Penalty, in/)).toHaveValue(amount);
        await form.getByRole('button', { name: 'Give the penalty' }).click();
        await expect(
          page.getByText('Penalty given. It shows on the board with its reason.'),
        ).toBeVisible();
      }
      await expect.poll(() => owed(leoId)).toBe('150');
      await expect.poll(() => balance(leoId)).toBe(before - 10);
    });

    await test.step('Leo’s page: part paid, and the points penalty taken back', async () => {
      await page.goto(`/admin/members/${leoId}?open=penalties`);
      await expect(page.locator('.fw-penalty__owes')).toHaveText('Leo owes $1.50');
      const paid = page.getByRole('form', { name: `Record paid for ${REASON}` });
      await paid.getByLabel('Paid').fill('1');
      await paid.getByRole('button', { name: 'Record paid' }).click();
      await expect(page.getByText('Payment recorded.')).toBeVisible();
      await expect.poll(() => owed(leoId)).toBe('50');
      await expect(page.locator('.fw-penalty__owes')).toHaveText('Leo owes $0.50');
      await page
        .getByRole('list', { name: 'Leo’s penalties' })
        .getByRole('listitem')
        .filter({ hasText: 'Rude to a sibling' })
        .filter({ hasText: 'Penalty' })
        .getByRole('button', { name: 'Take back' })
        .click();
      await expect(
        page.getByText('Penalty taken back. The board no longer shows it.'),
      ).toBeVisible();
      await expect.poll(() => balance(leoId)).toBe(before);
    });
  } finally {
    // Leo owes nothing and his points are as they were; the reason leaves the list.
    sql(`update public.penalty set taken_back_at = now(), taken_back_by = given_by
          where member_id = '${leoId}' and taken_back_at is null`);
    sql(`insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                           created_by_type, created_by, penalty_id)
         select p.household_id, p.member_id, 'penalty', p.amount, p.reason, 'pen-back:' || p.id, 'admin', p.given_by, p.id
           from public.penalty p
          where p.member_id = '${leoId}' and p.unit = 'points'
         on conflict (dedupe_key) do nothing`);
    sql(`update public.penalty_reason set removed_at = now()
          where household_id = '${HOUSEHOLD}' and name = '${REASON}' and removed_at is null`);
  }
});
