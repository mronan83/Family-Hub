// [NFR-18][D-120] The set-up pages folded (WP-94): what each section's folded header says, so a page
// set once reads as it is set while folded. A line is its parts, the key facts in bold (<b>), as the
// fold audit draws them; a warning stays on the header, open or closed.
import { calendarDay } from './chores';
import { cutoffWords } from './lunch-picks';
import { dayAndTime, isoDay, time } from './format';
import { clockWords, leadWords, type ReminderSettings } from './reminder-settings';

/** A folded header's line: plain words, and the key facts in bold. */
export type FoldLine = (string | { b: string })[];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Days from one "YYYY-MM-DD" to another. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export const WEEK_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const LONG = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
/** "Monday, Oct 19" for a YYYY-MM-DD. */
export const switchDay = (d: string) => LONG.format(new Date(`${d}T12:00:00Z`));

const WITH_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "Aug 26, 2026" for a YYYY-MM-DD. */
const withYear = (d: string) => WITH_YEAR.format(new Date(`${d}T12:00:00Z`));

/** When something happened, as a header says it: its time today, "yesterday", else its day and time. */
function whenWords(at: string, now: Date, timeZone: string): string {
  const days = daysBetween(isoDay(timeZone, new Date(at)), isoDay(timeZone, now));
  if (days <= 0) return time(at, timeZone);
  if (days === 1) return 'yesterday';
  return dayAndTime(at, timeZone);
}

// Family options

/** [ACC-08] The week: its start day, and a change waiting with the day it starts. */
export function weekLine(weekStart: number, next: { day: number; on: string } | null): FoldLine {
  const line: FoldLine = [{ b: `Starts on ${WEEK_DAYS[weekStart]}` }];
  if (next) line.push(` · from ${switchDay(next.on)} it starts on ${WEEK_DAYS[next.day]}`);
  return line;
}

/** [CHR-05] Check-offs: the choice, in words. */
export function checkOffsLine(mode: 'on' | 'off'): FoldLine {
  return mode === 'on'
    ? [{ b: 'A child’s check-off waits for a parent' }, ' to approve it']
    : [{ b: 'A child’s check-off counts straight away' }, '; a parent can uncheck it later'];
}

/** [ACC-03] The admins: each by name (their email when no member is theirs) and role. */
export function adminsLine(admins: { name: string; role: string }[]): FoldLine {
  return admins.flatMap((a, i) => [
    ...(i ? [' · '] : []),
    { b: a.name },
    ` (${a.role === 'owner' ? 'Owner' : 'Admin'})`,
  ]);
}

/**
 * [ACC-03] The invites waiting to be used, and when the soonest runs out, by the household's days:
 * "1 waiting · runs out in 2 days". Null when none waits.
 */
export function invitesWaiting(expiries: string[], now: Date, timeZone: string): string | null {
  if (!expiries.length) return null;
  const soonest = expiries.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b));
  const days = daysBetween(isoDay(timeZone, now), isoDay(timeZone, new Date(soonest)));
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `${expiries.length} waiting · runs out ${when}`;
}

export interface WeatherFact {
  place: string | null;
  unit: 'fahrenheit' | 'celsius';
  last: {
    temperature: number;
    unit: 'fahrenheit' | 'celsius';
    readAt: string;
    failedAt: string | null;
  } | null;
}

const deg = (t: number, unit: 'fahrenheit' | 'celsius') =>
  `${Math.round(t)}°${unit === 'celsius' ? 'C' : 'F'}`;

/**
 * [BRD-04] Weather on the boards: the place, the unit and the last reading; a failed read is the
 * warning, with when it last read well.
 */
export function weatherFacts(
  w: WeatherFact,
  now: Date,
  timeZone: string,
): { line: FoldLine; warning: string | null } {
  if (!w.place) return { line: ['Not shown on the boards'], warning: null };
  const line: FoldLine = [{ b: w.place }, ` · °${w.unit === 'celsius' ? 'C' : 'F'}`];
  line.push(w.last ? ` · last reading ${deg(w.last.temperature, w.last.unit)}` : ' · not read yet');
  const warning = w.last?.failedAt
    ? `Not updated since ${whenWords(w.last.readAt, now, timeZone)}`
    : null;
  return { line, warning };
}

// School

/** [MEAL-09] Lunch changes: the morning cut-off. */
export const cutoffLine = (cutoff: string): FoldLine => [
  { b: `Today’s lunch can change until ${cutoffWords(cutoff)}` },
];

/** Archived: how many, and their names. */
export const archivedLine = (names: string[]): FoldLine => [
  { b: `${names.length} archived:` },
  ` ${names.join(', ')}`,
];

/**
 * [SCH-01] A school year's breaks and days off: how many weekdays they take off school, and the next
 * one from the household's today.
 */
export function closuresLine(
  days: { day: string; dayType: string }[],
  closures: { name: string; startDate: string; endDate: string }[],
  today: string,
): FoldLine {
  if (!closures.length) return ['None yet'];
  const off = days.filter((d) => d.dayType === 'no_school' || d.dayType === 'break').length;
  const next = closures
    .filter((c) => c.endDate >= today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  return [
    { b: plural(off, 'day off', 'days off') },
    next
      ? ` · ${next.startDate <= today ? 'now' : 'next'}: ${next.name}, ${calendarDay(next.startDate)}`
      : ' · none still to come',
  ];
}

/** [SCH-01] Terms: how many, by name. */
export const termsLine = (names: string[]): FoldLine =>
  names.length ? [{ b: `${plural(names.length, 'term')}:` }, ` ${names.join(', ')}`] : ['None yet'];

/** [SCH-02] Who follows a school year. */
export function followersLine(names: string[], isDefault: boolean): FoldLine {
  if (names.length) return [{ b: names.join(', ') }];
  return [isDefault ? 'Everyone not given another year' : 'Nobody yet'];
}

/** [SCH-01] A school year's dates and school. */
export const yearLine = (y: { startDate: string; endDate: string; schoolName: string | null }) =>
  `${withYear(y.startDate)} to ${withYear(y.endDate)}${y.schoolName ? ` · ${y.schoolName}` : ''}`;

/** [SCH-01] What archiving a school year does, or restoring it. */
export const archiveLine = (archived: boolean) =>
  archived
    ? 'It applies again; anyone given it follows it again'
    : 'Stops it applying; its days off stay as a record';

// Reminders

/**
 * [CHR-15] My devices: how many, on or off, and when one was last reached; a device just removed
 * (it could no longer get notifications) is the warning.
 */
export function devicesFacts(
  devices: { enabled: boolean; lastSuccessAt: string | null }[],
  removed: boolean,
  now: Date,
  timeZone: string,
): { line: FoldLine; warning: string | null } {
  const warning = removed ? '1 removed' : null;
  if (!devices.length) return { line: ['None yet'], warning };
  const n = devices.length;
  const on = devices.filter((d) => d.enabled).length;
  const all = n === 2 ? 'both' : 'all';
  const state =
    n === 1
      ? on
        ? 'on'
        : 'off'
      : on === n
        ? `${all} on`
        : on === 0
          ? `${all} off`
          : `${on} on, ${n - on} off`;
  const reached = devices
    .map((d) => d.lastSuccessAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  const line: FoldLine = [{ b: plural(n, 'device') }, `, ${state}`];
  line.push(
    reached ? ` · last reached ${whenWords(reached, now, timeZone)}` : ' · not reached yet',
  );
  return { line, warning };
}

/** [CHR-16][CHR-17][CHR-20] When to remind me: each setting as set, in one line. */
export function remindLine(s: ReminderSettings): string {
  return [
    s.defaultLeadMinutes === 0 ? 'at the due time' : leadWords(s.defaultLeadMinutes),
    `no due time at ${clockWords(s.morningTime)}`,
    s.digestTime ? `digest at ${clockWords(s.digestTime)}` : 'no digest',
    s.quietStart && s.quietEnd
      ? `quiet ${clockWords(s.quietStart)} to ${clockWords(s.quietEnd)}`
      : 'no quiet hours',
    `approvals ${s.approvalAlerts ? 'on' : 'off'}`,
  ].join(' · ');
}

// Health

export type JobStateName = 'ok' | 'running' | 'stale' | 'failing' | 'never';

/**
 * [NFR-07] Background jobs: how many run fine and how many fail, are late or haven't run; each
 * failing or late job by name is the warning.
 */
export function jobsFacts(jobs: { label: string; state: JobStateName }[]): {
  line: FoldLine;
  warning: string | null;
} {
  if (!jobs.length) return { line: ['None scheduled yet'], warning: null };
  const count = (...states: JobStateName[]) => jobs.filter((j) => states.includes(j.state)).length;
  const line: FoldLine = [{ b: `${count('ok', 'running')} running fine` }];
  if (count('failing')) line.push(` · ${count('failing')} failing`);
  if (count('stale')) line.push(` · ${count('stale')} late`);
  if (count('never')) line.push(` · ${count('never')} not run yet`);
  const bad = jobs.filter((j) => j.state === 'failing' || j.state === 'stale');
  const warning = bad.length
    ? bad.map((j) => `${j.label}: ${j.state === 'failing' ? 'Failing' : 'Late'}`).join(' · ')
    : null;
  return { line, warning };
}

const MONTH_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone });

/**
 * [NFR-07] Server errors: how many in the last 30 days and the day of the latest, in the household's
 * zone. The page reads at most `limit`, so a full page says "or more".
 */
export function errorsLine(occurredAt: string[], limit: number, timeZone: string): FoldLine {
  if (!occurredAt.length) return ['None in the last 30 days'];
  const latest = occurredAt.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
  const n = occurredAt.length >= limit ? `${occurredAt.length} or more` : `${occurredAt.length}`;
  return [
    { b: `${n} in the last 30 days` },
    ` · latest ${MONTH_DAY(timeZone).format(new Date(latest))}`,
  ];
}

/** [NFR-08] Usage: the highest share of a free plan; a limit near is the warning. */
export function usageFacts(lines: { label: string; share: number | null; warn: boolean }[]): {
  line: FoldLine;
  warning: string | null;
} {
  const top = lines
    .filter((l): l is { label: string; share: number; warn: boolean } => l.share !== null)
    .sort((a, b) => b.share - a.share)[0];
  const near = lines.filter((l) => l.warn).map((l) => l.label);
  return {
    line: top
      ? [{ b: `Highest: ${top.label}` }, `, ${Math.round(top.share * 100)}% of the free plan`]
      : ['Not read yet'],
    warning: near.length ? `Near a limit: ${near.join(', ')}` : null,
  };
}
