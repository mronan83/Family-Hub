import type { SupabaseClient } from '@supabase/supabase-js';

// [BRD-04][US-1003] Weather on the board (WP-45, D-69): the temperature now and today's high and low
// at the household's place, from Open-Meteo (free, no key), read by the weather job every 30 minutes
// and stored through save_weather; saving a place on Home reads it at once. The board only reads the
// snapshot. A read that fails is recorded with why, and the board then shows no weather. Relative
// imports only: the e2e runner runs this against made-up readings.

export type TemperatureUnit = 'fahrenheit' | 'celsius';

/** Where to read the weather, kept to two decimals (about a kilometre), and in which unit. */
export interface WeatherPlace {
  latitude: number;
  longitude: number;
  unit: TemperatureUnit;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
/** A US ZIP code's own centre (Open-Meteo finds a ZIP only through a town that lists it). */
export const ZIP_URL = 'https://api.zippopotam.us/us/';
/** Open-Meteo answers in well under a second; a slower answer tries again at the next read. */
export const FETCH_TIMEOUT_MS = 10_000;

/** What an admin reads on Home when a read fails: what happened, and that it tries again. */
export const WEATHER_ERRORS = {
  unreachable: 'Couldn’t reach the weather service. FamilyWise tries again in 30 minutes.',
  timeout:
    'The weather service took more than 10 seconds to answer. FamilyWise tries again in 30 minutes.',
  unreadable:
    'The weather service sent something FamilyWise couldn’t read. FamilyWise tries again in 30 minutes.',
} as const;

export function httpError(status: number, statusText = ''): string {
  return `The weather service answered ${status}${statusText ? ` (${statusText})` : ''}. FamilyWise tries again in 30 minutes.`;
}

/** Two decimals of latitude or longitude: about a kilometre, as the household's place is kept. */
export const roundCoordinate = (n: number) => Math.round(n * 100) / 100;

/** The forecast request: now, and today's high and low, in the place's own zone and day. */
export function forecastUrl(place: WeatherPlace): string {
  const q = new URLSearchParams({
    latitude: roundCoordinate(place.latitude).toFixed(2),
    longitude: roundCoordinate(place.longitude).toFixed(2),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1',
    temperature_unit: place.unit,
  });
  return `${FORECAST_URL}?${q}`;
}

/** A read as save_weather stores it. */
export type WeatherRead =
  | {
      ok: true;
      latitude: number;
      longitude: number;
      unit: TemperatureUnit;
      temperature: number;
      high: number;
      low: number;
      weather_code: number;
      is_day: boolean;
      /** The place's own date the high and low are for. */
      for_date: string;
      /** When the service's reading is from (an ISO instant). */
      observed_at: string;
    }
  | { ok: false; error: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Reads Open-Meteo's answer. Its times are the place's own (timezone=auto), with the offset beside
 * them; anything missing or out of range is "couldn't read", never a guess.
 */
export function readForecast(body: unknown, place: WeatherPlace): WeatherRead {
  const unreadable: WeatherRead = { ok: false, error: WEATHER_ERRORS.unreadable };
  if (!body || typeof body !== 'object') return unreadable;
  const b = body as {
    utc_offset_seconds?: unknown;
    current?: {
      time?: unknown;
      temperature_2m?: unknown;
      weather_code?: unknown;
      is_day?: unknown;
    };
    daily?: { time?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown };
  };
  const offset = num(b.utc_offset_seconds);
  const time = b.current?.time;
  const temperature = num(b.current?.temperature_2m);
  const code = num(b.current?.weather_code);
  const day = num(b.current?.is_day);
  const days = Array.isArray(b.daily?.time) ? (b.daily.time as unknown[]) : [];
  const highs = Array.isArray(b.daily?.temperature_2m_max)
    ? (b.daily.temperature_2m_max as unknown[])
    : [];
  const lows = Array.isArray(b.daily?.temperature_2m_min)
    ? (b.daily.temperature_2m_min as unknown[])
    : [];
  const forDate = days[0];
  const high = num(highs[0]);
  const low = num(lows[0]);
  if (
    offset === null ||
    typeof time !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time) ||
    temperature === null ||
    high === null ||
    low === null ||
    code === null ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 99 ||
    (day !== 0 && day !== 1) ||
    typeof forDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(forDate) ||
    [temperature, high, low].some((t) => Math.abs(t) > 200)
  ) {
    return unreadable;
  }
  const observed = Date.parse(`${time}:00Z`) - offset * 1000;
  if (!Number.isFinite(observed)) return unreadable;
  return {
    ok: true,
    latitude: roundCoordinate(place.latitude),
    longitude: roundCoordinate(place.longitude),
    unit: place.unit,
    temperature,
    high,
    low,
    weather_code: code,
    is_day: day === 1,
    for_date: forDate,
    observed_at: new Date(observed).toISOString(),
  };
}

/** Asks Open-Meteo for the place's weather now. A failure is a read with why, never a throw. */
export async function fetchWeather(
  place: WeatherPlace,
  fetcher: Fetcher = fetch,
): Promise<WeatherRead> {
  let response: Response;
  try {
    response = await fetcher(forecastUrl(place), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? WEATHER_ERRORS.timeout
          : WEATHER_ERRORS.unreachable,
    };
  }
  if (!response.ok) return { ok: false, error: httpError(response.status, response.statusText) };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: WEATHER_ERRORS.unreadable };
  }
  return readForecast(body, place);
}

export type WeatherOutcome = 'ok' | 'error' | 'no_place' | 'stale';

/** Reads the weather at a place and stores it for the household. Only a failed store throws. */
export async function storeWeather(
  db: Pick<SupabaseClient, 'rpc'>,
  householdId: string,
  place: WeatherPlace,
  options: { fetch?: Fetcher } = {},
): Promise<WeatherOutcome> {
  const read = await fetchWeather(place, options.fetch);
  const saved = await db.rpc('save_weather', { p_household: householdId, p_result: read });
  if (saved.error) throw new Error(`store the weather: ${saved.error.message}`);
  return ((saved.data as { status?: WeatherOutcome } | null)?.status ?? 'ok') as WeatherOutcome;
}

/**
 * Reads the household's weather and stores it (the weather job, and Home right after a change). A
 * household with no place reads nothing. Only a database that can't store the read throws.
 */
export async function runWeather(
  db: SupabaseClient,
  householdId: string,
  options: { fetch?: Fetcher } = {},
): Promise<WeatherOutcome> {
  const { data, error } = await db
    .from('household_settings')
    .select('weather_latitude, weather_longitude, temperature_unit')
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`read the household's place: ${error.message}`);
  const lat = data?.weather_latitude;
  const lon = data?.weather_longitude;
  if (lat === null || lat === undefined || lon === null || lon === undefined) return 'no_place';
  return storeWeather(
    db,
    householdId,
    {
      latitude: Number(lat),
      longitude: Number(lon),
      unit: data?.temperature_unit === 'celsius' ? 'celsius' : 'fahrenheit',
    },
    options,
  );
}

/** A place an admin can choose: how it reads, and where (kept to two decimals once chosen). */
export interface FoundPlace {
  label: string;
  latitude: number;
  longitude: number;
}

/** What Home says when finding a place fails. */
export const SEARCH_ERRORS = {
  short: 'Type at least two letters of your town, or your ZIP or postal code.',
  failed: 'Couldn’t search for places just now. Try again in a moment.',
} as const;

/** Asks for JSON; null when the service fails, is slow or says no (a ZIP it doesn't know is a 404). */
async function getJson(url: string, fetcher: Fetcher): Promise<{ ok: boolean; body: unknown }> {
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) return { ok: true, body: null };
    if (!response.ok) return { ok: false, body: null };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, body: null };
  }
}

/**
 * [BRD-04] Finds places to choose from, at most five, each named as "Town, State, Country" without
 * repeats. A US ZIP code goes to Zippopotam.us, which knows each ZIP's own centre; a town's name (or
 * another country's postal code) to Open-Meteo's geocoding, whose results the admin picks from.
 * Both are free and need no key.
 */
export async function searchPlaces(
  query: string,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true; places: FoundPlace[] } | { ok: false; error: string }> {
  const name = query.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: SEARCH_ERRORS.short };
  const places: FoundPlace[] = [];
  const add = (parts: unknown[], lat: number | null, lon: number | null) => {
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    const label = parts
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .filter((x, i, all) => all.indexOf(x) === i)
      .join(', ')
      .slice(0, 120);
    if (label && !places.some((f) => f.label === label) && places.length < 5) {
      places.push({ label, latitude: roundCoordinate(lat), longitude: roundCoordinate(lon) });
    }
  };

  const zip = /^(\d{5})(-\d{4})?$/.exec(name)?.[1];
  if (zip) {
    const got = await getJson(`${ZIP_URL}${zip}`, fetcher);
    const found = (got.body as { places?: unknown } | null)?.places;
    for (const p of Array.isArray(found) ? found : []) {
      const r = (p ?? {}) as Record<string, unknown>;
      const parse = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : null);
      const [lat, lon] = [parse(r.latitude), parse(r.longitude)];
      add(
        [
          r['place name'],
          `${typeof r.state === 'string' ? r.state : ''} ${zip}`.trim(),
          'United States',
        ],
        lat !== null && Number.isFinite(lat) ? lat : null,
        lon !== null && Number.isFinite(lon) ? lon : null,
      );
    }
    if (places.length > 0) return { ok: true, places };
  }

  const q = new URLSearchParams({
    name: (zip ?? name).slice(0, 100),
    count: '5',
    language: 'en',
    format: 'json',
    ...(zip ? { countryCode: 'US' } : {}),
  });
  const got = await getJson(`${GEOCODING_URL}?${q}`, fetcher);
  if (!got.ok) return { ok: false, error: SEARCH_ERRORS.failed };
  // No match is an answer without "results".
  const results = (got.body as { results?: unknown } | null)?.results;
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object') continue;
    const p = r as Record<string, unknown>;
    if (typeof p.name !== 'string') continue;
    add([p.name, p.admin1, p.country], num(p.latitude), num(p.longitude));
  }
  return { ok: true, places };
}
