// [NFR-12-e][NFR-14][D-110] Calendar-date maths for the e2e specs (e2e/support/day.ts), with no clock
// and no zone: a spec reads its household's today once, from the database, and works from that, so
// midnight UTC, a DST change and the runner's zone change nothing. Here so it can be unit-tested
// without Playwright (scripts/e2e-dates.test.mjs).

const utc = (date, plus = 0) => {
  const [y = NaN, m = NaN, d = NaN] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + plus));
};

/** A calendar date `n` days from `date` ('YYYY-MM-DD'), with no clock and no zone. */
export function addDays(date, n) {
  return utc(date, n).toISOString().slice(0, 10);
}

/** The weekday of a calendar date: 0 is Sunday. */
export function weekday(date) {
  return utc(date).getUTCDay();
}

/** The first day of the household's week holding `date`, for a week that starts on `weekStart` (0–6). */
export function weekStartOf(date, weekStart) {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}
