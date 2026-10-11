import { expect, test, type Page } from '@playwright/test';
import { type Fetcher, storeWeather, type WeatherPlace } from '../../apps/web/lib/weather';
import { retireBoard } from '../support/board';
import { serviceRpc, sql as query } from '../support/db';

// [BRD-04][US-1003] Weather on a board, on the preview (WP-45, D-69). Alex sets the demo family's
// place; the weather job's own code reads made-up weather for it on the e2e runner (the preview holds
// no job secret, and the e2e never calls the real weather service) and stores it. The done-when: with
// a place set, the board shows the temperature now and today's high; with the source failing, the
// weather hides and nothing else on the board changes. Then Alex switches to °C and stops showing the
// weather on Home. The place is cleared at the end.
const db = process.env.SUPABASE_DB_URL;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const BOARD = 'Weather e2e';
const PLACE_NAME = 'Springfield, Illinois, United States';
const sql = (q: string) => query(db!, q);

test.describe.configure({ mode: 'serial' });
test.skip(!db || !process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'runs in the e2e workflow');

let admin: Page;
let board: Page;

const alex = () =>
  sql(`select user_id from public.member where household_id = '${DEMO}' and display_name = 'Alex'`);
/** Calls a function as Alex, as the admin app does (RLS and the admin checks as for them). */
const asAlex = (call: string) =>
  sql(`select set_config('request.jwt.claims', '{"sub":"${alex()}","role":"authenticated"}', false);
       select ${call}`);

/** The household's place as save_weather checks it, in its unit. */
function place(): WeatherPlace {
  const [lat, lon, unit] = sql(
    `select weather_latitude || '|' || weather_longitude || '|' || temperature_unit
       from public.household_settings where household_id = '${DEMO}'`,
  ).split('|');
  return {
    latitude: Number(lat),
    longitude: Number(lon),
    unit: unit === 'celsius' ? 'celsius' : 'fahrenheit',
  };
}

/** A made-up answer in Open-Meteo's shape, for the demo family's own now and today. */
function answer(temperature: number, high: number, code: number): Fetcher {
  const [time, today, offset] = sql(
    `select to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24:MI') || '|' ||
            (now() at time zone 'America/New_York')::date || '|' ||
            extract(epoch from (now() at time zone 'America/New_York') - (now() at time zone 'UTC'))::int`,
  ).split('|');
  return async (url) => {
    expect(url).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    return new Response(
      JSON.stringify({
        utc_offset_seconds: Number(offset),
        current: { time, temperature_2m: temperature, weather_code: code, is_day: 1 },
        daily: { time: [today], temperature_2m_max: [high], temperature_2m_min: [high - 12] },
      }),
    );
  };
}
const failing: Fetcher = async () =>
  new Response('', { status: 503, statusText: 'Service Unavailable' });
const read = (fetch: Fetcher) =>
  storeWeather(serviceRpc(db!) as unknown as Parameters<typeof storeWeather>[0], DEMO, place(), {
    fetch,
  });

const weather = () => board.getByRole('group', { name: /^Weather:/ });
/** Where the clock, the people and the dashboard sit, and what the dashboard lists. */
const boardAsIs = () =>
  board.evaluate(() => ({
    at: ['.fw-board__clock', '.fw-today__people', '.fw-dash'].map((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return [s, Math.round(r.right), Math.round(r.top)];
    }),
    rows: [...document.querySelectorAll('.fw-dash__list li[data-row]')].length,
  }));

function cleanUp() {
  sql(`update public.household_settings
          set weather_place = null, weather_latitude = null, weather_longitude = null,
              temperature_unit = 'fahrenheit'
        where household_id = '${DEMO}';
       delete from public.weather_reading where household_id = '${DEMO}';`);
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Signing in and pairing a board can take most of 30 s on a cold preview.
  testInfo.setTimeout(90_000);
  cleanUp();
  sql(`delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${BOARD}';
       delete from public.device where household_id = '${DEMO}' and name = '${BOARD}';`);
  admin = await browser.newPage();
  await admin.goto('/sign-in');
  await admin.getByRole('button', { name: 'Sign in as Alex', exact: true }).click();
  await admin.waitForURL(/\/admin$/);
  await admin.goto('/admin/devices');
  const form = admin.getByRole('form', { name: 'Add a board', exact: true });
  await form.getByLabel('Board name', { exact: true }).fill(BOARD);
  await form.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const code = (await admin.getByTestId('pairing-code').textContent())?.replace(/\D/g, '') ?? '';
  board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await board.getByLabel('Pairing code from the admin app', { exact: true }).fill(code);
  await board.getByRole('button', { name: 'Pair this board', exact: true }).click();
  await expect(board).toHaveURL(/\/board$/);
  await expect(board.getByRole('status')).toHaveText('Live', { timeout: 30_000 });
});

test.afterAll(async () => {
  cleanUp();
  await retireBoard(board, BOARD);
});

test('[BRD-04][US-1003] the done-when: with a place set, the board shows the temperature now and today’s high', async () => {
  await expect(weather()).toHaveCount(0);
  asAlex(`public.set_weather_place('${DEMO}', '${PLACE_NAME}', 39.80172, -89.64371)`);
  expect(place()).toEqual({ latitude: 39.8, longitude: -89.64, unit: 'fahrenheit' });
  expect(await read(answer(63.4, 68.2, 61))).toBe('ok');
  await expect(weather()).toHaveAccessibleName('Weather: 63 degrees Fahrenheit, rain, high 68');
  await expect(weather()).toContainText('63°');
  await expect(weather()).toContainText('High 68°');
  await expect(weather()).toContainText('Weather by Open-Meteo.com');
});

test('[BRD-04][US-1003] the done-when: with the source failing, the weather hides and nothing else on the board changes', async () => {
  await expect(weather()).toBeVisible();
  const before = await boardAsIs();
  expect(await read(failing)).toBe('error');
  await expect(weather()).toHaveCount(0);
  expect(await boardAsIs()).toEqual(before);
  expect(sql(`select error from public.weather_reading where household_id = '${DEMO}'`)).toBe(
    'The weather service answered 503 (Service Unavailable). FamilyWise tries again in 30 minutes.',
  );
  // The next good read brings it back.
  expect(await read(answer(64.1, 68.2, 3))).toBe('ok');
  await expect(weather()).toHaveAccessibleName('Weather: 64 degrees Fahrenheit, cloudy, high 68');
});

test('[BRD-04] on Home: Alex sees the place and the last read, switches to °C, then stops showing the weather', async () => {
  await admin.goto('/admin');
  const section = admin.getByRole('region', { name: 'Weather on the boards' });
  await expect(section).toContainText(
    `The boards show the weather for ${PLACE_NAME} beside the clock.`,
  );
  await expect(section.locator('[data-weather-status]')).toContainText('64°F, cloudy, high 68°F.');

  const units = section.getByRole('form', { name: 'Temperatures' });
  await units.getByRole('radio', { name: 'Celsius (°C)' }).check();
  await units.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(admin.getByRole('status').first()).toHaveText(
    'Saved. The boards show temperatures in the new unit in a moment.',
  );
  expect(
    sql(`select temperature_unit from public.household_settings where household_id = '${DEMO}'`),
  ).toBe('celsius');
  // The °F read is gone; the job's next read (here, made up) is in °C.
  expect(await read(answer(17.8, 20.1, 0))).toBe('ok');
  await expect(weather()).toHaveAccessibleName('Weather: 18 degrees Celsius, sunny, high 20');

  await admin
    .getByRole('region', { name: 'Weather on the boards' })
    .getByRole('button', { name: 'Stop showing the weather', exact: true })
    .click();
  await expect(admin.getByRole('status').first()).toHaveText(
    'The boards no longer show the weather.',
  );
  await expect(weather()).toHaveCount(0);
  expect(
    sql(
      `select coalesce(weather_place, 'none') from public.household_settings where household_id = '${DEMO}'`,
    ),
  ).toBe('none');
});
