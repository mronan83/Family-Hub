import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-12][US-408] The admin Insights page (WP-17) on /dev/insights: the 14 days of
// supabase/tests/190_streak_history.test.sql with no database, on a phone and a laptop, in both
// themes. The numbers are the pgTAP test's hand-computed ones; e2e/tests/insights.spec.ts reads a
// real member's on the preview.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

test('[RWD-12][US-408] streaks, done rate, the day heatmap, most missed, tags and checking', async ({
  page,
}) => {
  await page.goto('/dev/insights');
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Member' }).getByRole('link', { name: 'Maya' }),
  ).toHaveAttribute('aria-current', 'page');
  const streaks = page.getByRole('region', { name: 'Streaks' });
  await expect(streaks).toContainText('Good run now6 days');
  await expect(streaks).toContainText('Best good run6 days');
  await expect(streaks).toContainText('Longest bad streak2 days');
  await expect(page.getByRole('region', { name: 'Done' })).toContainText(
    '86% 32 of 37 routines that counted',
  );
  // The heatmap: every day, in words as well as colour.
  const heat = page.getByRole('table', { name: 'Day by day' });
  await expect(heat.locator('td[data-class="good"]')).toHaveCount(10);
  await expect(heat.locator('td[data-class="bad"]')).toHaveCount(3);
  await expect(heat).toContainText('Sat, Oct 3: Bad day, 2 done of 3, 1 missed');
  await expect(heat).toContainText('Sun, Oct 11: Nothing that counted, 0 done of 3');
  await expect(page.getByRole('list', { name: 'Missed most' })).toContainText(
    'Brush teethmissed 2 times',
  );
  await expect(page.getByRole('list', { name: 'By tag' })).toContainText('Morning 85% · 22 of 26');
  const checking = page.getByRole('region', { name: 'Checking' });
  await expect(checking).toContainText('Check-offs34');
  await expect(checking).toContainText('Unchecked by a parent1 (3%)');
  await expect(checking).toContainText('Sent back1 of 11 (9%)');
  await expect(checking).toContainText('Time to check2 hours');
});

test('[US-408] a member with no history yet says so, and a range can be chosen', async ({
  page,
}) => {
  await page.goto('/dev/insights?member=new&days=7');
  await expect(page.getByText('Leo has no days to show yet')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Streaks' })).toContainText('Good run now0 days');
  await expect(page.getByText('Nothing missed in these days.')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Range' }).getByRole('link', { name: 'Last 7 days' }),
  ).toHaveAttribute('aria-current', 'page');
});

for (const [width, height, label] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  for (const theme of ['day', 'evening'] as const) {
    test(`[NFR-11] fits ${label} in ${theme}: no sideways scroll, 44 px links, AA contrast`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/dev/insights?theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const link of await page.locator('.fw-insights__tab').all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await contrastOk(page);
    });
  }
}
