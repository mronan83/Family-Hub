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

/**
 * How long ago something happened, as a folded header says it (WP-91, WP-93): "just now",
 * "5 min ago", "7 h ago", then the day and time.
 */
export function agoWords(at: string, now: number, timeZone: string): string {
  const minutes = Math.floor((now - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return dayAndTime(at, timeZone);
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
