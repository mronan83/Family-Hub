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

export { addDays, weekday, weekStartOf } from '../../scripts/e2e-dates.mjs';

/** The household's week start (household.week_start: 0 is Sunday). */
export function householdWeekStart(db: string, household = currentHousehold().id): number {
  return Number(sql(db, `select week_start from public.household where id = '${household}'`));
}
