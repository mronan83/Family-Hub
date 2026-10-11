import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [BRD-04][US-1003] Weather on the board (WP-45, D-69) on /dev/board: the sky, the temperature now and
// today's high beside the clock, with the service's credit; none when there is no reading (no place,
// the source failing), when a layout turns it off, or when it is yesterday's; and nothing else on the
// board moves. Weather on the boards on Home (/dev/admin?view=weather) on a phone and a laptop. The
// job storing reads and a failing source on a real board run in e2e/tests/weather.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

const weather = (page: Page) => page.getByRole('group', { name: /^Weather:/ });
/** Where the clock and the people sit: the same with weather or without. */
const places = (page: Page) =>
  page.evaluate(() =>
    ['.fw-board__clock', '.fw-today__people', '.fw-dash'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return [s, Math.round(r.right), Math.round(r.top)];
    }),
  );

test.describe('on the board', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const theme of ['day', 'evening'] as const) {
    test(`[BRD-04][BRD-03][NFR-11] the weather beside the clock in ${theme}: 28 px text, AA contrast, no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(`/dev/board?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(weather(page)).toHaveAccessibleName(
        'Weather: 54 degrees Fahrenheit, partly cloudy, high 61',
      );
      await expect(weather(page)).toContainText('54°');
      await expect(weather(page)).toContainText('Partly cloudy');
      await expect(weather(page)).toContainText('High 61°');
      // The licence's credit, next to the data.
      await expect(weather(page)).toContainText('Weather by Open-Meteo.com');
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('.fw-weather *')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      );
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
      await contrastOk(page);
    });
  }

  test('[BRD-04][US-1003] no reading (no place, or the source failing): no weather, and nothing else moves', async ({
    page,
  }) => {
    await page.goto('/dev/board');
    await expect(weather(page)).toBeVisible();
    const withWeather = await places(page);
    await page.goto('/dev/board?weather=none');
    await expect(page.locator('.fw-board__clock')).toBeVisible();
    await expect(weather(page)).toHaveCount(0);
    expect(await places(page)).toEqual(withWeather);
  });

  test('[BRD-04][BRD-05] a layout that turns it off, or yesterday’s reading on a board offline overnight: none', async ({
    page,
  }) => {
    for (const kind of ['off', 'yesterday']) {
      await page.goto(`/dev/board?weather=${kind}`);
      await expect(page.locator('.fw-dash')).toBeVisible();
      await expect(weather(page), kind).toHaveCount(0);
    }
  });

  test('[BRD-04] the sky in a word and an icon, a moon at night, and °C', async ({ page }) => {
    const cases = [
      ['rain', 'Weather: 50 degrees Fahrenheit, rain, high 52', 'rain'],
      ['snow', 'Weather: 28 degrees Fahrenheit, snow, high 32', 'snow'],
      ['night', 'Weather: 46 degrees Fahrenheit, clear, high 61', 'clear'],
      ['celsius', 'Weather: 12 degrees Celsius, partly cloudy, high 16', 'partly'],
    ] as const;
    for (const [kind, name, sky] of cases) {
      await page.goto(`/dev/board?weather=${kind}`);
      await expect(weather(page), kind).toHaveAccessibleName(name);
      await expect(weather(page), kind).toHaveAttribute('data-sky', sky);
    }
  });
});

test.describe('on Home', () => {
  for (const [width, height, name] of [
    [390, 844, 'a phone'],
    [1280, 800, 'a laptop'],
  ] as const) {
    test.describe(name, () => {
      test.use({ viewport: { width, height } });
      for (const theme of ['day', 'evening'] as const) {
        test(`[BRD-04][NFR-11] Weather on the boards fits ${name} in ${theme}: no sideways scroll, 44 px controls, AA contrast`, async ({
          page,
        }) => {
          for (const state of ['none', 'found', 'failing']) {
            await page.goto(`/dev/admin?view=weather&state=${state}&theme=${theme}`);
            await expect(
              page.getByRole('heading', { name: 'Weather on the boards', level: 2 }),
            ).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth), state).toBe(
              width,
            );
            const small = await page.evaluate(() =>
              [...document.querySelectorAll('button, input, a')]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  const type = el.getAttribute('type');
                  return el.tagName !== 'A' && r.height > 0 && r.height < 44 && type !== 'radio';
                })
                .map((el) => el.outerHTML.slice(0, 80)),
            );
            expect(small, state).toEqual([]);
            await contrastOk(page);
          }
        });
      }
    });
  }

  test('[BRD-04][US-1003] find a place: the matches to choose from, each its own button', async ({
    page,
  }) => {
    await page.goto('/dev/admin?view=weather&state=found');
    const found = page.getByRole('list', { name: 'Places found' });
    await expect(found.getByRole('listitem')).toHaveCount(3);
    await expect(
      found.getByRole('button', { name: 'Use Springfield, Illinois, United States', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: 'Find your place' }).getByRole('searchbox'),
    ).toHaveValue('Springfield');
  });

  test('[BRD-04] the last read, or why it failed; none set yet says what it does', async ({
    page,
  }) => {
    await page.goto('/dev/admin?view=weather');
    await expect(page.locator('[data-weather-status]')).toHaveText(
      'Last read at 10:09 am: 54°F, partly cloudy, high 61°F.',
    );
    await expect(page.getByRole('button', { name: 'Stop showing the weather' })).toBeVisible();
    await page.goto('/dev/admin?view=weather&state=failing');
    await expect(page.getByRole('status')).toContainText(
      'Couldn’t read the weather at 10:39 am: The weather service answered 503 (Service Unavailable).',
    );
    await expect(page.getByRole('status')).toContainText(
      'The boards show no weather until it can.',
    );
    await page.goto('/dev/admin?view=weather&state=none');
    await expect(page.getByText('Set your town or ZIP code and the boards show')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop showing the weather' })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Weather data by Open-Meteo.com' }),
    ).toHaveAttribute('href', 'https://open-meteo.com/');
  });
});
