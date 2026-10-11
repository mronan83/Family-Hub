import type { Page } from '@playwright/test';

/**
 * [NFR-15] Opens a page from the admin menu the way a parent does (WP-51, D-81): on a phone the
 * menu waits behind Menu, so that is tapped first; on a laptop it is beside the page.
 */
export async function openFromMenu(page: Page, label: string): Promise<void> {
  const menu = page.getByRole('button', { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: label, exact: true })
    .click();
}

/**
 * [NFR-15] Opens one of Settings' pages (WP-51, D-81): Settings in the menu, then its tile. `label`
 * is the tile's name: School, Calendars, Boards, Tags, Reminders or Health.
 */
export async function openSetting(page: Page, label: string): Promise<void> {
  await openFromMenu(page, 'Settings');
  await page
    .getByRole('list', { name: 'Settings', exact: true })
    .getByRole('link', { name: new RegExp(`^${label}\\b`) })
    .click();
}
