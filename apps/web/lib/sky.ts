import type { IconName } from '@familywise/ui';

// [BRD-04] The sky in a word and an icon, from the WMO weather code Open-Meteo reports (WP-45). The
// brand's icons have a sun, a moon, a cloud and rain; snow, fog and storms take the nearest icon
// and say what they are in the word.

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
  if (code === 2) return { key: 'partly', word: 'Partly cloudy', icon: 'cloud' };
  if (code === 3) return { key: 'cloudy', word: 'Cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { key: 'fog', word: 'Fog', icon: 'cloud' };
  if (code === 56 || code === 57) return { key: 'drizzle', word: 'Freezing drizzle', icon: 'rain' };
  if (code >= 51 && code <= 55) return { key: 'drizzle', word: 'Drizzle', icon: 'rain' };
  if (code === 66 || code === 67) return { key: 'rain', word: 'Freezing rain', icon: 'rain' };
  if (code >= 61 && code <= 65) return { key: 'rain', word: 'Rain', icon: 'rain' };
  if (code >= 71 && code <= 77) return { key: 'snow', word: 'Snow', icon: 'cloud' };
  if (code >= 80 && code <= 82) return { key: 'showers', word: 'Showers', icon: 'rain' };
  if (code === 85 || code === 86) return { key: 'snow', word: 'Snow showers', icon: 'cloud' };
  if (code >= 95 && code <= 99) return { key: 'storm', word: 'Thunderstorms', icon: 'rain' };
  return { key: 'cloudy', word: 'Cloudy', icon: 'cloud' };
}
