import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../../e2e/support/test';

// Each fails on its first run only (a marker file in SELFTEST_STATE), or always with SELFTEST_ALWAYS.
const firstRun = (name: string): boolean => {
  const marker = join(process.env.SELFTEST_STATE ?? '.', name);
  if (existsSync(marker) && !process.env.SELFTEST_ALWAYS) return false;
  writeFileSync(marker, '');
  return true;
};

test('passes', async ({ page }) => {
  await page.setContent('<p>ready</p>');
  await expect(page.locator('p')).toHaveText('ready');
});

test('a statement timeout in the error', async () => {
  if (firstRun('timeout')) {
    throw new Error('psql: ERROR:  canceling statement due to statement timeout');
  }
});

test('a Supabase 5xx the browser saw, then an assertion on what the page shows', async ({
  page,
}) => {
  const fail = firstRun('supabase');
  await page.route('https://demo.supabase.co/**', (route) =>
    route.fulfill(
      fail
        ? {
            status: 500,
            headers: { 'access-control-allow-origin': '*' },
            body: '{"code":"57014","message":"canceling statement due to statement timeout"}',
          }
        : { status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' },
    ),
  );
  await page.setContent('<p>board</p>');
  const ok = await page.evaluate(async () => {
    const r = await fetch('https://demo.supabase.co/rest/v1/rpc/board_snapshot').catch(() => null);
    return r?.ok ?? false;
  });
  expect(ok).toBe(true);
});

test('the preview’s demo sign-in finding Supabase Auth not answering', async ({ page }) => {
  const fail = firstRun('auth');
  await page.route('https://preview.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Admin</h1>' }),
  );
  await page.goto(fail ? 'https://preview.test/sign-in?error=auth' : 'https://preview.test/admin');
  await expect(page).toHaveURL(/\/admin$/);
});
