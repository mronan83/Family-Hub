import type { IconName } from '@familywise/ui';

// [BRD-04] The sky in a word and an icon, from the WMO weather code Open-Meteo reports (WP-45). Since
// WP-46 the icons include Lucide's weather (D-70), so fog, drizzle, snow and storms each have their
// own; partly cloudy shows the sun or the moon behind the cloud.

export interface Sky {
  /** A stable name, for tests and styling. */
  key: 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'storm';
  word: string;
  icon: IconName;
}

export function skyFor(code: number, day: boolean): Sky {
  const clear: IconName = day ? 'sun' : 'moon';
  if (code === 0) return { key: 'clear', word: day ? 'Sunny' : 'Clear', icon: clear };
  if (code === 1) return { key: 'clear', word: day ? 'Mostly sunny' : 'Mostly clear', icon: clear };
  if (code === 2)
    return { key: 'partly', word: 'Partly cloudy', icon: day ? 'cloud-sun' : 'cloud-moon' };
  if (code === 3) return { key: 'cloudy', word: 'Cloudy', icon: 'cloudy' };
  if (code === 45 || code === 48) return { key: 'fog', word: 'Fog', icon: 'cloud-fog' };
  if (code === 56 || code === 57)
    return { key: 'drizzle', word: 'Freezing drizzle', icon: 'cloud-drizzle' };
  if (code >= 51 && code <= 55) return { key: 'drizzle', word: 'Drizzle', icon: 'cloud-drizzle' };
  if (code === 66 || code === 67) return { key: 'rain', word: 'Freezing rain', icon: 'rain' };
  if (code >= 61 && code <= 65) return { key: 'rain', word: 'Rain', icon: 'rain' };
  if (code >= 71 && code <= 77) return { key: 'snow', word: 'Snow', icon: 'cloud-snow' };
  if (code >= 80 && code <= 82) return { key: 'showers', word: 'Showers', icon: 'rain' };
  if (code === 85 || code === 86) return { key: 'snow', word: 'Snow showers', icon: 'cloud-snow' };
  if (code >= 95 && code <= 99)
    return { key: 'storm', word: 'Thunderstorms', icon: 'cloud-lightning' };
  return { key: 'cloudy', word: 'Cloudy', icon: 'cloudy' };
}
