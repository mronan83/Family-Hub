import type { Page } from '@playwright/test';

/**
 * [NFR-15] Opens one of Settings' pages the way a parent does (WP-51, D-81): Settings in the menu,
 * then its tile. `label` is the tile's name: School, Calendars, Boards, Tags, Reminders or Health.
 */
export async function openSetting(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page
    .getByRole('list', { name: 'Settings', exact: true })
    .getByRole('link', { name: new RegExp(`^${label}\\b`) })
    .click();
}
