import { Icon } from '@familywise/ui';
import { skyFor } from '@/lib/sky';
import type { BoardWeather } from '@/lib/snapshot';

/**
 * [BRD-04][US-1003] The weather beside the clock (WP-45, D-69): the sky, the temperature now and
 * today's high, in whole degrees of the household's unit. Nothing at all when there is no reading
 * (no place, the source failing), when the layout turns it off, or when the reading is for another
 * day than the board's (offline overnight): the bar then is as it was without weather.
 */
export function WeatherNow({ weather, today }: { weather: BoardWeather | null; today: string }) {
  if (!weather || weather.forDate !== today) return null;
  const sky = skyFor(weather.code, weather.day);
  const now = Math.round(weather.temperature);
  const high = Math.round(weather.high);
  const unit = weather.unit === 'celsius' ? 'Celsius' : 'Fahrenheit';
  return (
    <div
      className="fw-weather"
      role="group"
      aria-label={`Weather: ${now} degrees ${unit}, ${sky.word.toLowerCase()}, high ${high}`}
      data-sky={sky.key}
    >
      <Icon name={sky.icon} size={64} className="fw-weather__icon" />
      <span className="fw-weather__now" aria-hidden>
        {now}°
      </span>
      <span className="fw-weather__more">
        <span aria-hidden>{sky.word}</span>
        <span aria-hidden>High {high}°</span>
        {/* Open-Meteo's licence (CC BY 4.0) asks for credit next to its data. */}
        <span className="fw-weather__credit">Weather by Open-Meteo.com</span>
      </span>
    </div>
  );
}
