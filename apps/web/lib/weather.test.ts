import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { skyFor } from './sky';
import {
  type Fetcher,
  fetchWeather,
  forecastUrl,
  readForecast,
  runWeather,
  SEARCH_ERRORS,
  searchPlaces,
  WEATHER_ERRORS,
  type WeatherPlace,
} from './weather';

// [BRD-04][US-1003] Weather on the board (WP-45, D-69): the request to Open-Meteo, reading its answer,
// what a failure says, storing a read, and the sky in a word and an icon. Made-up readings only.
const PLACE: WeatherPlace = { latitude: 39.78173, longitude: -89.65015, unit: 'fahrenheit' };

/** Open-Meteo's answer for a place at UTC−5 (timezone=auto), as the service shapes it. */
const ANSWER = {
  latitude: 39.78,
  longitude: -89.65,
  utc_offset_seconds: -18000,
  timezone: 'America/Chicago',
  current: {
    time: '2026-10-11T09:15',
    interval: 900,
    temperature_2m: 54.3,
    weather_code: 2,
    is_day: 1,
  },
  daily: { time: ['2026-10-11'], temperature_2m_max: [61.2], temperature_2m_min: [48.0] },
};

describe('the request', () => {
  it('[BRD-04] now and today’s high and low, in the place’s own day and the household’s unit, to two decimals', () => {
    const url = new URL(forecastUrl(PLACE));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '39.78',
      longitude: '-89.65',
      current: 'temperature_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '1',
      temperature_unit: 'fahrenheit',
    });
    expect(
      new URL(forecastUrl({ ...PLACE, unit: 'celsius' })).searchParams.get('temperature_unit'),
    ).toBe('celsius');
  });
});

describe('reading the answer', () => {
  it('[BRD-04] the temperature now, the high and low, the sky, the place’s date, and when (as an instant)', () => {
    expect(readForecast(ANSWER, PLACE)).toEqual({
      ok: true,
      latitude: 39.78,
      longitude: -89.65,
      unit: 'fahrenheit',
      temperature: 54.3,
      high: 61.2,
      low: 48,
      weather_code: 2,
      is_day: true,
      for_date: '2026-10-11',
      observed_at: '2026-10-11T14:15:00.000Z',
    });
  });

  it('[BRD-04] anything missing or out of range is “couldn’t read”, never a guess', () => {
    const broken = [
      null,
      'weather',
      { ...ANSWER, current: { ...ANSWER.current, temperature_2m: null } },
      { ...ANSWER, current: { ...ANSWER.current, weather_code: 140 } },
      { ...ANSWER, current: { ...ANSWER.current, is_day: 2 } },
      { ...ANSWER, current: { ...ANSWER.current, time: 'soon' } },
      { ...ANSWER, daily: { ...ANSWER.daily, time: [] } },
      { ...ANSWER, daily: { ...ANSWER.daily, temperature_2m_max: ['warm'] } },
      { ...ANSWER, utc_offset_seconds: undefined },
      { ...ANSWER, current: { ...ANSWER.current, temperature_2m: 999 } },
    ];
    for (const body of broken) {
      expect(readForecast(body, PLACE)).toEqual({ ok: false, error: WEATHER_ERRORS.unreadable });
    }
  });
});

describe('asking the service', () => {
  const answering =
    (status: number, body: unknown, statusText = ''): Fetcher =>
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, statusText });

  it('[BRD-04] a good answer is a read', async () => {
    let asked = '';
    const read = await fetchWeather(PLACE, async (url, init) => {
      asked = url;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return answering(200, ANSWER)(url, init);
    });
    expect(asked).toBe(forecastUrl(PLACE));
    expect(read.ok).toBe(true);
  });

  it('[BRD-04] the service failing, slow or unreachable says so, and that it tries again', async () => {
    expect(await fetchWeather(PLACE, answering(503, {}, 'Service Unavailable'))).toEqual({
      ok: false,
      error:
        'The weather service answered 503 (Service Unavailable). FamilyWise tries again in 30 minutes.',
    });
    expect(await fetchWeather(PLACE, answering(200, '<html>'))).toEqual({
      ok: false,
      error: WEATHER_ERRORS.unreadable,
    });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(
      await fetchWeather(PLACE, async () => {
        throw timeout;
      }),
    ).toEqual({ ok: false, error: WEATHER_ERRORS.timeout });
    expect(
      await fetchWeather(PLACE, async () => {
        throw new TypeError('fetch failed');
      }),
    ).toEqual({ ok: false, error: WEATHER_ERRORS.unreachable });
  });
});

describe('storing a read', () => {
  /** Just enough of a Supabase client: the household's place, and save_weather. */
  function fakeDb(settings: Record<string, unknown> | null, status = 'ok') {
    const saved: unknown[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: settings, error: null }) }),
        }),
      }),
      rpc: async (name: string, args: { p_household: string; p_result: unknown }) => {
        expect(name).toBe('save_weather');
        saved.push(args);
        return { data: { status }, error: null };
      },
    } as unknown as SupabaseClient;
    return { db, saved };
  }

  it('[BRD-04] reads the household’s place in its unit and stores the read', async () => {
    const { db, saved } = fakeDb({
      weather_latitude: '39.78',
      weather_longitude: '-89.65',
      temperature_unit: 'celsius',
    });
    let asked = '';
    const outcome = await runWeather(db, 'h1', {
      fetch: async (url) => {
        asked = url;
        return new Response(JSON.stringify(ANSWER));
      },
    });
    expect(outcome).toBe('ok');
    expect(new URL(asked).searchParams.get('temperature_unit')).toBe('celsius');
    expect(saved).toEqual([
      {
        p_household: 'h1',
        p_result: expect.objectContaining({ ok: true, unit: 'celsius', temperature: 54.3 }),
      },
    ]);
  });

  it('[BRD-04] no place, nothing read; a failure is stored with why', async () => {
    const none = fakeDb({
      weather_latitude: null,
      weather_longitude: null,
      temperature_unit: 'fahrenheit',
    });
    expect(
      await runWeather(none.db, 'h1', {
        fetch: async () => {
          throw new Error('not asked');
        },
      }),
    ).toBe('no_place');
    expect(none.saved).toEqual([]);

    const failing = fakeDb(
      { weather_latitude: 39.78, weather_longitude: -89.65, temperature_unit: 'fahrenheit' },
      'error',
    );
    expect(
      await runWeather(failing.db, 'h1', { fetch: async () => new Response('', { status: 500 }) }),
    ).toBe('error');
    expect(failing.saved).toEqual([
      { p_household: 'h1', p_result: { ok: false, error: expect.stringMatching(/answered 500/) } },
    ]);
  });
});

describe('the sky', () => {
  it('[BRD-04] a word and an icon for each WMO code, a moon at night', () => {
    expect(skyFor(0, true)).toEqual({ key: 'clear', word: 'Sunny', icon: 'sun' });
    expect(skyFor(0, false)).toEqual({ key: 'clear', word: 'Clear', icon: 'moon' });
    expect([2, 3, 45, 53, 57, 63, 66, 73, 81, 86, 95].map((c) => skyFor(c, true).word)).toEqual([
      'Partly cloudy',
      'Cloudy',
      'Fog',
      'Drizzle',
      'Freezing drizzle',
      'Rain',
      'Freezing rain',
      'Snow',
      'Showers',
      'Snow showers',
      'Thunderstorms',
    ]);
    expect(skyFor(42, true).word).toBe('Cloudy');
  });
});

describe('finding the place', () => {
  const routes =
    (answers: Record<string, { status?: number; body: unknown }>): Fetcher =>
    async (url) => {
      const hit = Object.entries(answers).find(([prefix]) => url.startsWith(prefix));
      if (!hit) throw new Error(`not expected: ${url}`);
      return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
    };

  it('[BRD-04][US-1003] a town by name: up to five to choose from, named by state and country', async () => {
    let asked = '';
    const found = await searchPlaces('  Springfield ', async (url, init) => {
      asked = url;
      return routes({
        'https://geocoding-api.open-meteo.com/v1/search': {
          body: {
            results: [
              {
                name: 'Springfield',
                latitude: 37.21533,
                longitude: -93.29824,
                admin1: 'Missouri',
                country: 'United States',
              },
              {
                name: 'Springfield',
                latitude: 39.80172,
                longitude: -89.64371,
                admin1: 'Illinois',
                country: 'United States',
              },
              {
                name: 'Springfield',
                latitude: 39.8,
                longitude: -89.6,
                admin1: 'Illinois',
                country: 'United States',
              },
              { name: 'Nowhere' },
            ],
          },
        },
      })(url, init);
    });
    expect(Object.fromEntries(new URL(asked).searchParams)).toEqual({
      name: 'Springfield',
      count: '5',
      language: 'en',
      format: 'json',
    });
    expect(found).toEqual({
      ok: true,
      places: [
        { label: 'Springfield, Missouri, United States', latitude: 37.22, longitude: -93.3 },
        { label: 'Springfield, Illinois, United States', latitude: 39.8, longitude: -89.64 },
      ],
    });
  });

  it('[BRD-04] a US ZIP code: its own centre from Zippopotam.us; one it doesn’t know, Open-Meteo in the US', async () => {
    expect(
      await searchPlaces(
        '55124',
        routes({
          'https://api.zippopotam.us/us/55124': {
            body: {
              'post code': '55124',
              places: [
                {
                  'place name': 'Saint Paul',
                  latitude: '44.7497',
                  longitude: '-93.2029',
                  state: 'Minnesota',
                },
              ],
            },
          },
        }),
      ),
    ).toEqual({
      ok: true,
      places: [
        { label: 'Saint Paul, Minnesota 55124, United States', latitude: 44.75, longitude: -93.2 },
      ],
    });

    let fallback = '';
    const found = await searchPlaces('99999', async (url, init) => {
      if (url.includes('open-meteo')) fallback = url;
      return routes({
        'https://api.zippopotam.us/us/99999': { status: 404, body: {} },
        'https://geocoding-api.open-meteo.com/v1/search': { body: { generationtime_ms: 0.2 } },
      })(url, init);
    });
    expect(found).toEqual({ ok: true, places: [] });
    expect(new URL(fallback).searchParams.get('countryCode')).toBe('US');
  });

  it('[BRD-04] too short to search, or the service failing, says so', async () => {
    expect(await searchPlaces('a')).toEqual({ ok: false, error: SEARCH_ERRORS.short });
    expect(
      await searchPlaces(
        'Springfield',
        routes({ 'https://geocoding-api.open-meteo.com/v1/search': { status: 500, body: {} } }),
      ),
    ).toEqual({ ok: false, error: SEARCH_ERRORS.failed });
  });
});
