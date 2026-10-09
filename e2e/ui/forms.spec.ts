import { expect, test } from '@playwright/test';

// [ACC-02] Admin forms keep what was typed when an action refuses it (React resets a form after a
// form action by default; lib/forms.ts opts out). The CI build has no Supabase settings, so every
// sign-in is refused here, which is exactly the case to check.
test('[ACC-02] a refused sign-in keeps the email that was typed', async ({ page }) => {
  await page.goto('/sign-in');
  const form = page.getByRole('form', { name: 'Sign in with password' });
  await form.getByLabel('Email').fill('pat@example.com');
  await form.getByLabel('Password').fill('anything');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.getByRole('status')).toHaveText('Sign-in isn’t set up on this deployment.');
  await expect(form.getByLabel('Email')).toHaveValue('pat@example.com');
});

test('[ACC-04] members pages need a signed-in admin', async ({ page }) => {
  await page.goto('/admin/members/new');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fmembers%2Fnew$/);
});

test('[DEV-01] boards pages need a signed-in admin', async ({ page }) => {
  await page.goto('/admin/devices');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fdevices$/);
});
