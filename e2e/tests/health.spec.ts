import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [NFR-07][NFR-08] System Health on the preview (WP-42, D-42), as Alex of the demo family: a failing
// job shows with its message and clears after a good run, a server error recorded for the household
// shows, and usage is listed against the Free-plan limits. That no other household sees any of it
// is pinned by 080_system_health.test.sql. Rows are written with psql, as the job runner and the
// error log would write them in production.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const FAILURE = 'e2e: forced failure (job-run workflow)';
const ERROR = 'Error: e2e seeded server error';

function sql(query: string): string {
  return execFileSync('psql', [db!, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const CLEAN = `delete from public.job_run where household_id = '${DEMO}' and (error = '${FAILURE}' or stats ? 'e2e');
               delete from private.app_error where household_id = '${DEMO}' and message = '${ERROR}';`;

async function asAlexOnHealth(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await page.waitForURL(/\/admin$/);
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Health', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'System health', level: 1 })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

test.beforeAll(() => {
  sql(`${CLEAN}
       insert into public.job_run (household_id, job_type, status, started_at, finished_at, error)
       values ('${DEMO}', 'heartbeat', 'error', now(), now(), '${FAILURE}');
       insert into private.app_error (route, kind, message, household_id)
       values ('/admin/members', 'action', '${ERROR}', '${DEMO}');`);
});

test.afterAll(() => {
  sql(CLEAN);
});

test('[NFR-07] a failing job shows with its message, and the household’s server errors are listed', async ({
  page,
}) => {
  await asAlexOnHealth(page);
  const jobs = page.getByRole('list', { name: 'Background jobs', exact: true });
  const heartbeat = jobs.getByRole('listitem').filter({ hasText: 'Heartbeat' });
  await expect(heartbeat).toContainText('Failing');
  await expect(heartbeat).toContainText(FAILURE);
  await expect(page.getByRole('status').filter({ hasText: 'needs attention' })).toContainText(
    'Heartbeat',
  );
  await expect(page.getByRole('list', { name: 'Server errors', exact: true })).toContainText(ERROR);

  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
});

test('[NFR-07] after a good run the job is fine again', async ({ page }) => {
  sql(`insert into public.job_run (household_id, job_type, status, started_at, finished_at, stats)
       values ('${DEMO}', 'heartbeat', 'ok', now() + interval '1 second', now() + interval '1 second', '{"e2e": true}');`);
  await asAlexOnHealth(page);
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
  const usage = page.getByRole('list', { name: 'Usage', exact: true });
  await expect(usage.getByRole('listitem').filter({ hasText: 'Database' })).toContainText(
    /\d[\d,]* MB of 500 MB/,
  );
});
