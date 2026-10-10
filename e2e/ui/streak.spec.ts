import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [RWD-05][US-408] The board's streak flame (WP-17) on /dev/board: Leo has six good days to
// yesterday and Maya two; the flame adds today once today is good, glows once on reaching a milestone
// (7), and stays still with reduced motion. Adults (who don't earn rewards) have none.
test.use({ viewport: { width: 1920, height: 1080 } });

const column = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Everyone today' })
    .locator('section', { has: page.getByRole('heading', { name, level: 2 }) });
const flame = (page: Page, name: string) => column(page, name).locator('.fw-today__flame');

test('[RWD-05] each child’s run shows beside their name; adults have none', async ({ page }) => {
  await page.goto('/dev/board');
  await expect(flame(page, 'Leo')).toHaveText('6 days in a row');
  await expect(flame(page, 'Leo')).toHaveAttribute('data-tier', '1');
  await expect(flame(page, 'Maya')).toHaveText('2 days in a row');
  await expect(flame(page, 'Alex')).toHaveCount(0);
  await expect(flame(page, 'Sam')).toHaveCount(0);
  // Not a celebration on load.
  await expect(flame(page, 'Leo')).not.toHaveAttribute('data-glow');
});

test('[RWD-05][US-408] finishing today adds today to the run, and reaching 7 glows once', async ({
  page,
}) => {
  await page.goto('/dev/board');
  const leo = column(page, 'Leo');
  await leo.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
  // Still a routine to do: today isn't good yet, and never bad.
  await expect(flame(page, 'Leo')).toHaveText('6 days in a row');
  await leo.getByRole('button', { name: 'Check off Set the table', exact: true }).click();
  await expect(flame(page, 'Leo')).toHaveText('7 days in a row');
  await expect(flame(page, 'Leo')).toHaveAttribute('data-glow', 'true');
  await expect(flame(page, 'Leo')).toHaveAttribute('data-tier', '2');
  expect(
    await flame(page, 'Leo')
      .locator('svg')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('fw-flame-glow');
});

test('[RWD-08] with reduced motion the flame changes without moving', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/board');
  const leo = column(page, 'Leo');
  await leo.getByRole('button', { name: 'Check off Make bed', exact: true }).click();
  await leo.getByRole('button', { name: 'Check off Set the table', exact: true }).click();
  await expect(flame(page, 'Leo')).toHaveText('7 days in a row');
  expect(
    await flame(page, 'Leo')
      .locator('svg')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('[RWD-05] on a child’s own screen too, legible in both themes', async ({ page }) => {
  for (const theme of ['day', 'evening']) {
    await page.goto(`/dev/board?theme=${theme}`);
    await page
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: 'Maya', exact: true })
      .click();
    await expect(page.locator('.fw-today__me-head .fw-today__flame')).toHaveText('2 days in a row');
    const { violations } = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .include('.fw-today__flame')
      .analyze();
    expect(violations).toEqual([]);
  }
});
