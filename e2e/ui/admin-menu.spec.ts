import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [NFR-15][US-107] The admin app's one menu and Settings (WP-51, D-81), on /dev/settings with the
// made-up family and no database: on a laptop the menu stays down the left in three groups, Today
// with how many check-offs wait, Help and sign-out at its foot; on a phone a Menu button opens the
// same over the page, and Close or Escape shuts it. Settings has a tile for each of its pages with
// how it stands; a page it holds marks Settings and has the way back.

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });
const SETTINGS = ['School', 'Calendars', 'Boards', 'Tags', 'Reminders', 'Health'];

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** Shown buttons and links under 44 px tall, and the page's width. */
const fit = (page: Page) =>
  page.evaluate(() => ({
    wide: document.documentElement.scrollWidth,
    small: [...document.querySelectorAll('button, .fw-shell a, .fw-settings a, .fw-crumb')]
      .filter((b) => b.getClientRects().length > 0 && b.getBoundingClientRect().height < 44)
      .map((b) => b.textContent?.trim()),
  }));

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('[NFR-15][US-107] the menu in three groups beside the page, Settings marked, Today’s count', async ({
    page,
  }) => {
    await page.goto('/dev/settings');
    await expect(nav(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Menu/ })).toBeHidden();
    await expect(nav(page).locator('.fw-shell__label')).toHaveText([
      'Your day',
      'The family',
      'Set-up',
    ]);
    await expect(nav(page).locator('.fw-shell__list .fw-shell__text')).toHaveText([
      'Home',
      'Today',
      'My tasks',
      'Chores',
      'Members',
      'Rewards',
      'Goals',
      'Meals',
      'Insights',
      'Settings',
    ]);
    await expect(nav(page).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // [US-107] Two check-offs wait: Today says so, to see and to hear.
    await expect(nav(page).getByRole('link', { name: 'Today, 2 waiting for you' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
    await expect(nav(page).getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(nav(page)).toContainText('Alex');
    // The page sits beside the menu, not under it.
    const [menu, main] = await Promise.all([
      nav(page).boundingBox(),
      page.getByRole('heading', { name: 'Settings', level: 1 }).boundingBox(),
    ]);
    expect(main!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width);
  });

  test('[NFR-15][US-107] Settings: a tile for each of its pages, with how it stands', async ({
    page,
  }) => {
    await page.goto('/dev/settings');
    const tiles = page.getByRole('list', { name: 'Settings', exact: true }).getByRole('link');
    await expect(tiles.locator('.fw-settings__name')).toHaveText(SETTINGS);
    await expect(tiles.nth(3)).toHaveAttribute('href', '/admin/tags');
    await expect(tiles.nth(2)).toHaveAttribute('href', '/admin/devices');
    await expect(tiles.nth(3)).toContainText('6 tags');
    // A line that asks for a look says so in words and with an icon, never color alone.
    const warn = page.locator('.fw-settings__status[data-warn]');
    await expect(warn).toHaveText(['School can’t sync', '1 thing to look at']);
    await expect(warn.locator('svg[data-icon="warning"]')).toHaveCount(2);
    await page.goto('/dev/settings?state=quiet');
    await expect(page.locator('.fw-settings__status[data-warn]')).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Today' })).toBeVisible();
  });

  test('[NFR-15] a page Settings holds marks Settings, with the way back to it', async ({
    page,
  }) => {
    await page.goto('/dev/reminders');
    await expect(nav(page).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: 'Settings', exact: true }).last()).toHaveAttribute(
      'href',
      '/admin/settings',
    );
    await expect(page.locator('.fw-crumb')).toHaveText('Settings');
    // A page of the family's marks itself, with no way back to Settings.
    await page.goto('/dev/meals');
    await expect(nav(page).getByRole('link', { name: 'Meals' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.fw-crumb')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[NFR-15][US-107] Menu opens the menu over the page; Close or Escape shuts it', async ({
    page,
  }) => {
    await page.goto('/dev/settings');
    const menu = page.getByRole('button', { name: 'Menu, 2 waiting for you' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(nav(page)).toBeHidden();
    await menu.click();
    await expect(nav(page)).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(nav(page).getByRole('button', { name: 'Close' })).toBeFocused();
    // The whole menu fits a phone without scrolling: the family's six pages two to a row.
    const box = await nav(page).getByRole('button', { name: 'Sign out' }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    await expect(nav(page)).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await nav(page).getByRole('button', { name: 'Close' }).click();
    await expect(nav(page)).toBeHidden();
  });

  for (const theme of ['day', 'evening'] as const) {
    test(`[NFR-15][NFR-11] Settings and the open menu fit a phone in ${theme}: 44 px, AA contrast, no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(`/dev/settings?theme=${theme}`);
      expect(await fit(page)).toEqual({ wide: 390, small: [] });
      await contrastOk(page);
      await page.getByRole('button', { name: /^Menu/ }).click();
      expect(await fit(page)).toEqual({ wide: 390, small: [] });
      await contrastOk(page);
    });
  }
});

for (const theme of ['day', 'evening'] as const) {
  test(`[NFR-15][NFR-11] on a laptop in ${theme}: 44 px, AA contrast, no sideways scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/dev/settings?theme=${theme}`);
    expect(await fit(page)).toEqual({ wide: 1280, small: [] });
    await contrastOk(page);
  });
}
