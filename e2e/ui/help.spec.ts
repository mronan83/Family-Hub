import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [D-72] Help: the user guide (docs/07) in the app at /help, open signed in or not. Its pictures
// load, its five diagrams are drawn and readable on a phone and a laptop, its contents links land on
// their sections, and the admin menu, sign-in and setup lead to it.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    // The diagrams are drawn by mermaid in its own theme; their words are checked by eye.
    .exclude('.fw-help__diagram')
    .analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

async function drawn(page: Page) {
  await expect(page.locator('.fw-help')).toHaveAttribute('data-diagrams', 'drawn', {
    timeout: 15_000,
  });
  await expect(page.locator('.fw-help__diagram svg')).toHaveCount(5);
}

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${device}`, () => {
    test.use({ viewport: { width, height } });
    for (const scheme of ['light', 'dark'] as const) {
      test(`[D-72][NFR-11] Help fits ${device} in ${scheme === 'light' ? 'Day' : 'Evening'}: no sideways scroll, pictures, diagrams, AA contrast`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/help');
        await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
        await drawn(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        // Every picture loads (lazily, so each is brought into view first).
        const pictures = page.locator('.fw-help__shot img');
        expect(await pictures.count()).toBeGreaterThan(20);
        for (const img of await pictures.all()) {
          await img.scrollIntoViewIfNeeded();
          await expect
            .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
            .toBeGreaterThan(0);
        }
        // Each diagram is drawn at a size its words can be read at: at least 60% of its own size.
        const shrunk = await page.evaluate(() =>
          [...document.querySelectorAll<SVGSVGElement>('.fw-help__diagram svg')]
            .map((svg) => svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)
            .filter((s) => s < 0.6),
        );
        expect(shrunk).toEqual([]);
        await contrastOk(page);
      });
    }
  });
}

test('[D-72] the contents lead to their sections', async ({ page }) => {
  await page.goto('/help');
  await page.getByRole('link', { name: "A2 A parent's day", exact: true }).click();
  await expect(page).toHaveURL(/#a2-a-parents-day$/);
  await expect(page.getByRole('heading', { name: "A2 A parent's day" })).toBeInViewport();
  await page.getByRole('link', { name: 'B4 Troubleshooting', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'B4 Troubleshooting' })).toBeInViewport();
});

test('[D-72] Help leaves out what is only for the people building FamilyWise', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'A1 Getting started' })).toBeVisible();
  await expect(page.getByText('How this guide is kept current')).toHaveCount(0);
  await expect(page.getByText('Stories this guide covers')).toHaveCount(0);
});

test('[D-72] the admin menu, sign-in and setup lead to Help', async ({ page }) => {
  await page.goto('/dev/admin');
  await expect(
    page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Help' }),
  ).toHaveAttribute('href', '/help');
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: 'Help: how FamilyWise works' })).toHaveAttribute(
    'href',
    '/help',
  );
  await page.goto('/setup');
  await page.getByRole('link', { name: 'Help: getting started, step by step' }).click();
  await expect(page.getByRole('heading', { name: 'A1 Getting started' })).toBeInViewport();
});
