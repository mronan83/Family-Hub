import { expect, test } from '../support/test';
import { sql as query } from '../support/db';
import { foldOf, unfold } from '../support/fold';
import { openSetting } from '../support/settings';
import { signIn } from '../support/session';

// [NFR-18][D-120] Calendars folded on the preview (WP-93), as Alex of the demo family: every
// calendar folded at first, the Family calendar's header read, then opened, an edit saved under Edit,
// and the calendar open again after the save. The spec's own calendar, connected as Alex (its link
// to Vault) and marked synced 12 minutes ago, with no sync run: the link is made up (.invalid never
// resolves), and saving without a new link syncs nothing. Removed afterwards.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const NAME = 'Family fold e2e';
const LINK = 'https://calendar.familywise.invalid/family-fold-e2e.ics';
const sql = (q: string) => query(db!, q);

test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

function cleanUp() {
  // Its link goes from Vault with it (trg_calendar_source_secrets).
  sql(`delete from public.calendar_source where household_id = '${DEMO}' and name = '${NAME}'`);
}

test.beforeAll(() => {
  cleanUp();
  const alex = sql(
    `select user_id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`,
  );
  sql(`select set_config('request.jwt.claims', '{"sub":"${alex}","role":"authenticated"}', false);
       select public.save_calendar('${DEMO}', null, '${NAME}', '${LINK}', 'member-6',
         array[]::uuid[], true)`);
  // Synced 12 minutes ago by the database's clock, so the header's words don't hang on the runner's.
  sql(`update public.calendar_source
          set status = 'ok', last_synced_at = now() - interval '12 minutes',
              last_success_at = now() - interval '12 minutes', last_error = null
        where household_id = '${DEMO}' and name = '${NAME}'`);
});
test.afterAll(() => cleanUp());

test('[NFR-18-j][CAL-06][D-120] Alex opens Calendars folded, reads the Family calendar’s header, saves an edit and finds it open', async ({
  page,
}) => {
  const family = foldOf(page, NAME);

  await test.step('every calendar folded, the header read', async () => {
    await signIn(page);
    await openSetting(page, 'Calendars');
    await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();
    const rows = page
      .getByRole('list', { name: 'Calendars', exact: true })
      .locator('details.fw-fold--row');
    await expect(family).toBeVisible();
    for (const row of await rows.all()) await expect(row).not.toHaveAttribute('open');
    // Synced 12 minutes ago, or a few more by when the page was drawn.
    await expect(family.locator(':scope > summary')).toContainText(
      /The whole family · Synced 1\d min ago · nothing coming up/,
    );
    await expect(family.locator(':scope > summary .fw-fold__flag')).toHaveCount(0);
  });

  await test.step('opened, an edit saved under Edit, and the calendar open after the save', async () => {
    await unfold(family);
    await expect(family.locator('.fw-calendar__sync')).toContainText('Synced');
    await unfold(foldOf(page, `Edit ${NAME}`));
    const edit = page.getByRole('form', { name: `Edit ${NAME}` });
    await edit.getByText('Green', { exact: true }).click();
    await edit.getByRole('button', { name: 'Save calendar' }).click();
    await page.waitForURL(/did=saved/);
    await expect(page.getByText(`Saved ${NAME}.`)).toBeVisible();
    await expect(family).toHaveAttribute('open', '');
    await expect(family.locator('.fw-calendar__sync')).toBeVisible();
    await expect
      .poll(() =>
        sql(
          `select color from public.calendar_source where household_id = '${DEMO}' and name = '${NAME}'`,
        ),
      )
      .not.toBe('member-6');
  });
});
