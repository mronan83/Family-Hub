// Household-local calendar dates (YYYY-MM-DD) as plain day numbers, so nothing depends on the
// machine's time zone or on daylight-saving changes: a day is always one step (02 §5).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date; throws on anything else. */
export function dayNumber(date: string): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`not a date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (toDate(ms / DAY_MS) !== date) throw new RangeError(`not a date: ${date}`);
  return ms / DAY_MS;
}

/** The YYYY-MM-DD date of a day number. */
export function toDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both included; empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = dayNumber(from), end = dayNumber(to); d <= end; d++) out.push(toDate(d));
  return out;
}

/**
 * The first day of the household week holding `date`. `weekStart` is the day the household's
 * week starts on: 0 Sunday … 6 Saturday (household.week_start).
 */
export function weekOf(date: string, weekStart: number): string {
  const day = dayNumber(date);
  // 1970-01-01 was a Thursday (4).
  const weekday = (((day + 4) % 7) + 7) % 7;
  return toDate(day - ((weekday - weekStart + 7) % 7));
}
