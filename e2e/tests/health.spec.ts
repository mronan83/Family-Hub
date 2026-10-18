import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '../support/test';
import { sql as query } from '../support/db';
import { foldOf, unfold } from '../support/fold';
import { openSetting } from '../support/settings';
import { signIn } from '../support/session';
import { ownHousehold } from '../support/household';

// [NFR-07][NFR-08] System Health on the preview (WP-42, D-42), as Alex of the demo family: a failing
// job shows with its message and clears after a good run, a server error recorded for the household
// shows, and usage is listed against the Free-plan limits. That no other household sees any of it
// is pinned by 080_system_health.test.sql. Rows are written with psql, as the job runner and the
// error log would write them in production.
const family = ownHousehold('health');
const db = process.env.SUPABASE_DB_URL;
const HOUSEHOLD = family.id;
const FAILURE = 'e2e: forced failure (job-run workflow)';
const ERROR = 'Error: e2e seeded server error';

const sql = (q: string) => query(db!, q);

const CLEAN = `delete from public.job_run where household_id = '${HOUSEHOLD}' and (error = '${FAILURE}' or stats ? 'e2e');
               delete from private.app_error where household_id = '${HOUSEHOLD}' and message = '${ERROR}';`;

async function asAlexOnHealth(page: Page) {
  await signIn(page);
  await openSetting(page, 'Health');
  await expect(page.getByRole('heading', { name: 'System health', level: 1 })).toBeVisible();
}

/** [NFR-18] Opens the page's folds (WP-94): jobs, errors and usage, folded to their counts. */
async function openFolds(page: Page) {
  for (const name of ['Background jobs', 'Server errors', 'Usage'])
    await unfold(foldOf(page, name));
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  sql(`${CLEAN}
       insert into public.job_run (household_id, job_type, status, started_at, finished_at, error)
       values ('${HOUSEHOLD}', 'heartbeat', 'error', now(), now(), '${FAILURE}');
       insert into private.app_error (route, kind, message, household_id)
       values ('/admin/members', 'action', '${ERROR}', '${HOUSEHOLD}');`);
});

test.afterAll(() => {
  sql(CLEAN);
});

test('[NFR-18-x][NFR-07] a failing job is named on the folded header, shows with its message, and the household’s server errors are listed', async ({
  page,
}) => {
  await asAlexOnHealth(page);
  // [NFR-18-x] Folded, the failing job by name on Background jobs' header (WP-94).
  const jobsFold = foldOf(page, 'Background jobs');
  await expect(jobsFold).not.toHaveAttribute('open');
  await expect(jobsFold.locator(':scope > summary .fw-fold__flag')).toContainText(
    'Heartbeat: Failing',
  );
  await expect(foldOf(page, 'Server errors').locator(':scope > summary')).toContainText(
    'in the last 30 days',
  );
  await openFolds(page);
  const jobs = page.getByRole('list', { name: 'Background jobs', exact: true });
  const heartbeat = jobs.getByRole('listitem').filter({ hasText: 'Heartbeat' });
  await expect(heartbeat).toContainText('Failing');
  await expect(heartbeat).toContainText(FAILURE);
  await expect(page.getByRole('status').filter({ hasText: 'needs attention' })).toContainText(
    'Heartbeat',
  );
  await expect(page.getByRole('list', { name: 'Server errors', exact: true })).toContainText(ERROR);
  // The seed marks the demo family, so production's jobs leave it alone (D-62); the page says so.
  expect(sql(`select is_demo from public.household where id = '${HOUSEHOLD}'`)).toBe('t');
  await expect(
    page.getByText('The background jobs leave the demo family alone', { exact: false }),
  ).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
});

test('[NFR-07] after a good run the job is fine again', async ({ page }) => {
  // A later transaction than beforeAll's failing run, so now() is already after it (not in the future).
  sql(`insert into public.job_run (household_id, job_type, status, started_at, finished_at, stats)
       values ('${HOUSEHOLD}', 'heartbeat', 'ok', now(), now(), '{"e2e": true}');`);
  await asAlexOnHealth(page);
  await openFolds(page);
  const heartbeat = page
    .getByRole('list', { name: 'Background jobs', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'Heartbeat' });
  await expect(heartbeat).toContainText('Running fine');
  await expect(heartbeat).not.toContainText(FAILURE);
});

test('[NFR-08] usage is listed against the Free-plan limits, the database size read live', async ({
  page,
}) => {
  await asAlexOnHealth(page);
  await openFolds(page);
  const usage = page.getByRole('list', { name: 'Usage', exact: true });
  await expect(usage.getByRole('listitem').filter({ hasText: 'Database' })).toContainText(
    /\d[\d,]* MB of 500 MB/,
  );
});
