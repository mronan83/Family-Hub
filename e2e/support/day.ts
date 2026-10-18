import { sql } from './db';
import { currentHousehold } from './household';

// [NFR-14][D-110] Dates in the household's own zone, never the runner's clock (CI runs in UTC; the
// spec's household, a copy of the demo family, lives in America/New_York). A spec reads "today" once,
// from the database, and does its date maths on calendar dates, so midnight UTC, a DST change and the
// runner's zone change nothing.

/** The household's today (the spec's own by default), as the database has it: 'YYYY-MM-DD'. */
export function householdToday(db: string, household = currentHousehold().id): string {
  return sql(
    db,
    `select (now() at time zone timezone)::date from public.household where id = '${household}'`,
  );
}

const utc = (date: string, plus = 0): Date => {
  const [y = NaN, m = NaN, d = NaN] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + plus));
};

/** A calendar date `n` days from `date` ('YYYY-MM-DD'), with no clock and no zone. */
export function addDays(date: string, n: number): string {
  return utc(date, n).toISOString().slice(0, 10);
}

/** The weekday of a calendar date: 0 is Sunday. */
export function weekday(date: string): number {
  return utc(date).getUTCDay();
}

/** The first day of the household's week holding `date`, for a week that starts on `weekStart` (0–6). */
export function weekStartOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/** The household's week start (household.week_start: 0 is Sunday). */
export function householdWeekStart(db: string, household = currentHousehold().id): number {
  return Number(sql(db, `select week_start from public.household where id = '${household}'`));
}
