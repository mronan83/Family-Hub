import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardTheme, localMinutes, themeBootScript } from './theme';

const at = (iso: string) => new Date(iso);

describe('board theme', () => {
  it('[NFR-13] is Day from 06:30 to 19:00 household-local time, Evening otherwise', () => {
    const tz = 'America/New_York'; // UTC-4 in October
    expect(boardTheme(at('2026-10-08T10:29:00Z'), { timeZone: tz })).toBe('evening'); // 06:29
    expect(boardTheme(at('2026-10-08T10:30:00Z'), { timeZone: tz })).toBe('day'); // 06:30
    expect(boardTheme(at('2026-10-08T22:59:00Z'), { timeZone: tz })).toBe('day'); // 18:59
    expect(boardTheme(at('2026-10-08T23:00:00Z'), { timeZone: tz })).toBe('evening'); // 19:00
  });

  it('[NFR-13] follows the household timezone, not the device', () => {
    const now = at('2026-10-08T12:00:00Z');
    expect(boardTheme(now, { timeZone: 'America/Los_Angeles' })).toBe('evening'); // 05:00
    expect(boardTheme(now, { timeZone: 'Europe/London' })).toBe('day'); // 13:00
  });

  it('[NFR-13] a manual override wins over the clock', () => {
    const night = at('2026-10-08T03:00:00Z');
    expect(boardTheme(night, { timeZone: 'UTC', override: 'day' })).toBe('day');
    expect(boardTheme(at('2026-10-08T12:00:00Z'), { timeZone: 'UTC', override: 'evening' })).toBe(
      'evening',
    );
  });

  it('reads midnight as 0 minutes', () => {
    expect(localMinutes(at('2026-10-08T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('rejects a malformed schedule', () => {
    expect(() =>
      boardTheme(at('2026-10-08T12:00:00Z'), {
        schedule: { dayFrom: '6:30', eveningFrom: '19:00' },
      }),
    ).toThrow(/HH:MM/);
  });
});

describe('theme boot scripts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function run(script: string) {
    const root = { dataset: {} as Record<string, string> };
    new Function('document', script)({ documentElement: root });
    return root.dataset.theme;
  }

  it('[NFR-13] the board script picks the same theme as boardTheme on the device clock', () => {
    vi.useFakeTimers();
    for (const hour of [5, 7, 12, 18, 19, 23]) {
      vi.setSystemTime(new Date(2026, 9, 8, hour, 0));
      expect(run(themeBootScript('board'))).toBe(boardTheme(new Date()));
    }
  });

  it('[NFR-13] the admin script follows the device dark mode', () => {
    for (const dark of [true, false]) {
      vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: () => {} }));
      expect(run(themeBootScript('admin'))).toBe(dark ? 'evening' : 'day');
    }
  });
});
