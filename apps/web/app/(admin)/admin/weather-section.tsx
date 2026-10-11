import { Banner, Button } from '@familywise/ui';
import { time } from '@/lib/format';
import { skyFor } from '@/lib/sky';
import type { FoundPlace, TemperatureUnit } from '@/lib/weather';
import { setTemperatureUnit, setWeatherPlace } from './actions';

/** The household's last read, as Home shows how it went. */
export interface LastRead {
  temperature: number;
  high: number;
  code: number;
  isDay: boolean;
  unit: TemperatureUnit;
  readAt: string;
  failedAt: string | null;
  error: string | null;
}

export type WeatherNotice = 'saved' | 'cleared' | 'unit' | 'failed';

const NOTICES: Record<WeatherNotice, string> = {
  saved: 'Saved. The boards show the weather in a moment.',
  cleared: 'The boards no longer show the weather.',
  unit: 'Saved. The boards show temperatures in the new unit in a moment.',
  failed: 'That wasn’t saved. Try again in a moment.',
};

const deg = (t: number, unit: TemperatureUnit) =>
  `${Math.round(t)}°${unit === 'celsius' ? 'C' : 'F'}`;

/**
 * [BRD-04][US-1003] Weather on the boards, on Home (WP-45, D-69): the household's place (found by a
 * town's name or a postal code, then chosen from what matches), °F or °C, and how the last read
 * went. Boards show it beside the clock; a board's layout can turn it off (Boards).
 */
export function WeatherSection({
  place,
  unit,
  last,
  timezone,
  query,
  found,
  notice,
}: {
  place: string | null;
  unit: TemperatureUnit;
  last: LastRead | null;
  timezone: string;
  /** What was searched for, if anything. */
  query: string | null;
  /** What matched it, or why the search failed. */
  found: { places: FoundPlace[] } | { error: string } | null;
  notice: WeatherNotice | null;
}) {
  return (
    <section id="weather" className="fw-card" aria-labelledby="weather-heading">
      <h2 id="weather-heading">Weather on the boards</h2>
      {notice ? (
        <Banner kind={notice === 'failed' ? 'notice' : 'info'}>{NOTICES[notice]}</Banner>
      ) : null}
      {place ? (
        <p>
          The boards show the weather for <strong>{place}</strong> beside the clock.
        </p>
      ) : (
        <p className="fw-muted">
          Set your town or ZIP code and the boards show the temperature now and today’s high beside
          the clock. FamilyWise keeps your place to about a kilometre.
        </p>
      )}
      {place && last ? (
        last.failedAt ? (
          <Banner kind="notice">
            Couldn’t read the weather at {time(new Date(last.failedAt), timezone)}: {last.error} The
            boards show no weather until it can.
          </Banner>
        ) : (
          <p className="fw-muted" data-weather-status>
            Last read at {time(new Date(last.readAt), timezone)}: {deg(last.temperature, last.unit)}
            , {skyFor(last.code, last.isDay).word.toLowerCase()}, high {deg(last.high, last.unit)}.
          </p>
        )
      ) : null}

      <form method="get" action="/admin#weather" className="fw-form" aria-label="Find your place">
        <label className="fw-field">
          <span className="fw-field__label">{place ? 'Change the place' : 'Town or ZIP code'}</span>
          <input
            className="fw-input"
            name="place"
            type="search"
            defaultValue={query ?? ''}
            autoComplete="postal-code"
            maxLength={100}
            required
          />
        </label>
        <div className="fw-actions">
          <Button type="submit" variant="secondary" icon="search">
            Find
          </Button>
        </div>
      </form>

      {query && found ? (
        'error' in found ? (
          <Banner kind="notice">{found.error}</Banner>
        ) : found.places.length === 0 ? (
          <p className="fw-muted">
            No places found for “{query}”. Try the town’s name or another code.
          </p>
        ) : (
          <ul className="fw-list" aria-label="Places found">
            {found.places.map((p) => (
              <li key={p.label} className="fw-list__row">
                <span>{p.label}</span>
                <form action={setWeatherPlace}>
                  <input type="hidden" name="name" value={p.label} />
                  <input type="hidden" name="latitude" value={p.latitude} />
                  <input type="hidden" name="longitude" value={p.longitude} />
                  <Button type="submit" variant="ghost" icon="check" aria-label={`Use ${p.label}`}>
                    Use this
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <form action={setTemperatureUnit} className="fw-form" aria-label="Temperatures">
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Show temperatures in</legend>
          <div className="fw-picker">
            <label className="fw-picker__item">
              <input
                type="radio"
                name="unit"
                value="fahrenheit"
                defaultChecked={unit === 'fahrenheit'}
              />
              Fahrenheit (°F)
            </label>
            <label className="fw-picker__item">
              <input type="radio" name="unit" value="celsius" defaultChecked={unit === 'celsius'} />
              Celsius (°C)
            </label>
          </div>
        </fieldset>
        <div className="fw-actions">
          <Button type="submit" variant="secondary" icon="check">
            Save
          </Button>
        </div>
      </form>

      <p className="fw-muted">
        <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>; places from GeoNames
        through Open-Meteo, and US ZIP codes from Zippopotam.us.
      </p>
      {place ? (
        <form action={setWeatherPlace}>
          <input type="hidden" name="clear" value="1" />
          <Button type="submit" variant="ghost" icon="close">
            Stop showing the weather
          </Button>
        </form>
      ) : null}
    </section>
  );
}
