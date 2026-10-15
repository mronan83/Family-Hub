import { expect, test } from '../../e2e/support/test';

test('an assertion failure', async ({ page }) => {
  await page.setContent('<p>Done!</p>');
  await expect(page.locator('p')).toHaveText('Not done', { timeout: 1_000 });
});
