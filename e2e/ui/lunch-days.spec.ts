import { expect, test } from '@playwright/test';

// [CHR-19][US-321] The chore form's school lunch choice (WP-61, D-86) on /dev/forms, with a made-up
// family and no database: choosing lunch days makes an item everyone's own, since each child has
// their own lunch, and the choice fits a phone. Saving and the plan are in e2e/tests/chores.spec.ts.

test.use({ viewport: { width: 390, height: 844 } });

test('[CHR-19] lunch days make an item everyone’s own, and fit a phone', async ({ page }) => {
  await page.goto('/dev/forms?form=chore');
  const form = page.getByRole('form', { name: 'Add an item' });
  const people = form.getByRole('group', { name: 'Who it’s for' });
  for (const box of (await people.getByRole('checkbox').all()).slice(0, 2)) await box.check();
  await form.getByRole('radio', { name: 'Any one of them' }).check();

  await form.getByText('More options').click();
  const lunch = form.getByRole('combobox', { name: 'School lunch' });
  await expect(lunch).toHaveValue('');
  await lunch.selectOption({ label: 'Days they bring lunch' });
  await expect(form.getByRole('radio', { name: 'Everyone does their own' })).toBeChecked();
  await expect(form.getByRole('radio', { name: 'Any one of them' })).toBeDisabled();
  await expect(form).toContainText('because each child has their own lunch');

  // Back to any day: the choice is open again.
  await lunch.selectOption({ label: 'Any day' });
  await expect(form.getByRole('radio', { name: 'Any one of them' })).toBeEnabled();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await lunch.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
