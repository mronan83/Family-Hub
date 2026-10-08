import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const THEMES = ['day', 'evening'] as const;
const SURFACES = ['board', 'admin'] as const;

/** What a tile looks like, as the browser computes it: deterministic on every machine. */
async function tileStyles(page: Page, theme: (typeof THEMES)[number]) {
  return page
    .getByTestId(`tiles-${theme}`)
    .locator('.fw-tile')
    .evaluateAll((tiles) =>
      tiles.map((tile) => {
        const css = getComputedStyle(tile);
        const status = tile.querySelector('.fw-tile__status')!;
        return {
          status: tile.getAttribute('data-status'),
          display: tile.getAttribute('data-display'),
          icon: tile.querySelector('.fw-tile__status-icon')?.getAttribute('data-icon'),
          label: status.textContent,
          background: css.backgroundColor,
          border: `${css.borderTopWidth} ${css.borderTopStyle} ${css.borderTopColor}`,
          text: css.color,
          statusText: getComputedStyle(status).color,
          minHeight: css.minHeight,
        };
      }),
    );
}

for (const surface of SURFACES) {
  test(`[NFR-13] every tile state keeps its icon, word and colors in Day and Evening (${surface})`, async ({
    page,
  }) => {
    await page.goto(`/dev/brand?surface=${surface}&theme=day`);
    for (const theme of THEMES) {
      const styles = await tileStyles(page, theme);
      expect(styles.length).toBe(12);
      expect(JSON.stringify(styles, null, 2)).toMatchSnapshot(`tiles-${surface}-${theme}.json`);
    }
  });
}

test('[NFR-13] the page theme and a scoped theme resolve to the same tokens', async ({ page }) => {
  await page.goto('/dev/brand?surface=admin&theme=evening');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'evening');
  const [page_, panel] = await Promise.all([
    page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    page.getByTestId('panel-evening').evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(page_).toBe(panel);
});

const CONTRAST_PAGES: [string, 'light' | 'dark'][] = [
  ['/board', 'light'],
  ['/admin', 'light'],
  ['/admin', 'dark'],
  ...SURFACES.flatMap((s) =>
    THEMES.map((t) => [`/dev/brand?surface=${s}&theme=${t}`, 'light'] as [string, 'light']),
  ),
];

for (const [path, colorScheme] of CONTRAST_PAGES) {
  test(`[NFR-11] ${path} passes the axe contrast check (${colorScheme} device)`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(
      violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`)),
    ).toEqual([]);
  });
}

test('[NFR-13] admin follows the device dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'evening');
  await expect(page.locator('.fw-logo__evening')).toBeVisible();
  await expect(page.locator('.fw-logo__day')).toBeHidden();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect(page.locator('.fw-logo__day')).toBeVisible();
});

test('[NFR-13] board and admin each link their own manifest, titles and icons', async ({
  page,
  request,
}) => {
  const cases = [
    {
      path: '/board',
      manifest: '/board.webmanifest',
      display: 'fullscreen',
      title: 'FamilyWise Board',
    },
    { path: '/admin', manifest: '/admin.webmanifest', display: 'standalone', title: 'FamilyWise' },
  ];
  for (const c of cases) {
    await page.goto(c.path);
    await expect(page).toHaveTitle(c.title);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', c.manifest);
    const manifest = await (await request.get(c.manifest)).json();
    expect(manifest).toMatchObject({ name: 'FamilyWise', display: c.display, start_url: c.path });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  }
  for (const href of ['/icons/favicon.svg', '/icons/favicon.ico', '/icons/apple-touch-icon.png']) {
    expect((await request.get(href)).ok()).toBe(true);
  }
});

test('[NFR-13] the board boot splash is Evening with the reversed logo, whatever the time', async ({
  page,
}) => {
  await page.goto('/board');
  await expect(page.getByRole('heading', { name: 'Getting your day ready' })).toBeVisible();
  await expect(page.locator('.fw-splash .fw-logo__evening')).toBeVisible();
});

test('[NFR-13] fonts are self-hosted and precached for offline use', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:3100')) external.push(r.url());
  });
  await page.goto('/board');
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = await document.fonts.load('700 40px Nunito');
    return loaded.map((f) => `${f.family.replace(/"/g, '')} ${f.weight} ${f.status}`);
  });
  expect(faces).toContain('Nunito 700 loaded');
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 100; i++) {
      const key = (await caches.keys()).find((k) => k.startsWith('familywise-brand-'));
      const urls = key
        ? (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)
        : [];
      if (urls.length >= 9) return urls.sort();
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  });
  expect(cached).toHaveLength(9);
  expect(cached).toContain('/brand/fonts.css');
  expect(cached).toContain('/brand/fonts/nunito-latin-800-normal.woff2');
  expect(external).toEqual([]);
});
