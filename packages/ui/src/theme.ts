// Day and Evening themes (06 §4.1, §11). The theme is `data-theme` on <html>. The board follows
// household-local time with a manual override; the admin app follows the device's dark mode.

export type Theme = 'day' | 'evening';
export type ThemeOverride = 'auto' | Theme;

/** When the board changes theme, in household-local 24-hour time. */
export const BOARD_THEME_SCHEDULE = { dayFrom: '06:30', eveningFrom: '19:00' } as const;

export interface BoardThemeOptions {
  /** IANA timezone of the household; the device's own zone when omitted. */
  timeZone?: string;
  override?: ThemeOverride;
  schedule?: { dayFrom: string; eveningFrom: string };
}

function minutesOf(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`expected HH:MM, got ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(now: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

export function boardTheme(now: Date, options: BoardThemeOptions = {}): Theme {
  const { timeZone, override = 'auto', schedule = BOARD_THEME_SCHEDULE } = options;
  if (override !== 'auto') return override;
  const t = localMinutes(now, timeZone);
  return t >= minutesOf(schedule.dayFrom) && t < minutesOf(schedule.eveningFrom)
    ? 'day'
    : 'evening';
}

/**
 * A tiny script for the top of the page, so the first paint already has the right theme. The
 * board uses the device clock until the household timezone is known; the admin app reads the
 * device's dark mode and follows changes.
 */
export function themeBootScript(kind: 'board' | 'admin'): string {
  if (kind === 'admin') {
    return `(function(){var q=matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.dataset.theme=q.matches?'evening':'day'}a();q.addEventListener('change',a)})()`;
  }
  const day = minutesOf(BOARD_THEME_SCHEDULE.dayFrom);
  const evening = minutesOf(BOARD_THEME_SCHEDULE.eveningFrom);
  return `(function(){var d=new Date(),m=d.getHours()*60+d.getMinutes();document.documentElement.dataset.theme=m>=${day}&&m<${evening}?'day':'evening'})()`;
}
