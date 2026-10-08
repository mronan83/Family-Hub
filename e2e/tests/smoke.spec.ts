import { expect, test } from '@playwright/test';

test('[NFR-14] health endpoint answers on the deployment', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({ status: 'ok', app: 'familywise' });
});

test('[NFR-14] board route renders', async ({ page }) => {
  await page.goto('/board');
  await expect(page).toHaveTitle(/FamilyWise Board/);
});
