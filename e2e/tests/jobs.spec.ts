import { expect, test } from '@playwright/test';

// [NFR-07] Previews hold no job secret (D-37), so every job call is refused there; jobs run in
// production only, where pg_cron calls them (01 §5.6).
test('[NFR-07] previews refuse job calls', async ({ request }) => {
  const res = await request.post('/api/jobs/heartbeat', { data: {} });
  expect(res.status()).toBe(503);
  expect(await res.json()).toEqual({ error: 'jobs are off' });
});

test('[NFR-07] job endpoints take POST only', async ({ request }) => {
  const res = await request.get('/api/jobs/heartbeat');
  expect(res.status()).toBe(405);
});
