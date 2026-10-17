/** Dates and times as the brand writes them (06 §2): "Tue, Oct 7" and "7:42 am", in a timezone. */
export function day(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(at));
}

/**
 * [NFR-16][D-128] A whole date as the goal screens' mockups write it: "Mon, Oct 12, 2026", for a
 * timestamp in a timezone (a household-local "YYYY-MM-DD" goes through `dateWords`).
 */
export function fullDay(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(at));
}

export function time(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(new Date(at))
    .replace(/\s?([AP])M$/, (_m, h: string) => ` ${h.toLowerCase()}m`);
}

export function dayAndTime(at: string | Date, timeZone: string): string {
  return `${day(at, timeZone)} at ${time(at, timeZone)}`;
}

/** Today's date in a timezone, as "YYYY-MM-DD" (a household's business date, 02 §1). */
export function isoDay(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

/** "Maya and Leo", "Alex, Maya and Leo": names as a list in words. */
export function andList(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
