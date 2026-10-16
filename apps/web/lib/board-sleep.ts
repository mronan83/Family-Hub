/**
 * [DEV-07][US-207] Sleep and wake per board (WP-34, D-116, D-117). Each board keeps its
 * choices in its settings (`device.board_config.sleep`):
 *   - when it counts as missed: Always, Only while awake, or Never (Home's "hasn't been seen");
 *   - its set times: a school night's sleep and wake, and a weekend's (none: it never sleeps at set
 *     times). A night takes its times from the day after it, so the night before a school day is a
 *     school night, and Friday night or the night before a day off is a weekend one (D-117);
 *   - how long untouched before it sleeps (none: never).
 * During its set times a touch wakes it for its idle time (5 minutes when it has none), then it
 * sleeps again. Times are the household's own clock, so they hold across a change of clocks.
 * The board, Boards and Home all decide from these functions.
 */

export const MISSED_CHOICES = [
  { value: 'always', label: 'Always', hint: 'Home says so after a day without it, at any hour.' },
  {
    value: 'awake',
    label: 'Only while awake',
    hint: 'Its hours asleep don’t count, and Home never says so while it is asleep.',
  },
  { value: 'never', label: 'Never', hint: 'For a board that is often off. Home never lists it.' },
] as const;
export type Missed = (typeof MISSED_CHOICES)[number]['value'];

/** How long untouched before a board sleeps, in minutes. */
export const IDLE_CHOICES = [5, 10, 15, 30, 60, 120] as const;
/** [D-117] How long a touch during the set times wakes a board that has no idle time. */
export const NIGHT_TOUCH_MINUTES = 5;

/** A night's times, in minutes after midnight. */
export interface NightTimes {
  sleep: number;
  wake: number;
}

export interface BoardSleep {
  missed: Missed;
  /** The set times; null: it never sleeps at set times. */
  schedule: { school: NightTimes; weekend: NightTimes } | null;
  /** Minutes untouched before it sleeps; null: never. */
  idleMinutes: number | null;
}

export const NO_SLEEP: BoardSleep = { missed: 'always', schedule: null, idleMinutes: null };

/** The household's school days over a span of dates (`school_days()`). */
export interface SchoolDays {
  from: string;
  to: string;
  days: ReadonlySet<string>;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "21:30" as minutes after midnight; null for anything else. */
export function minutesOf(hhmm: unknown): number | null {
  if (typeof hhmm !== 'string') return null;
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes after midnight as "21:30". */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function nightOf(raw: unknown): NightTimes | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const sleep = minutesOf((raw as { sleep?: unknown }).sleep);
  const wake = minutesOf((raw as { wake?: unknown }).wake);
  return sleep === null || wake === null || sleep === wake ? null : { sleep, wake };
}

/** A board's sleep settings as stored (board_config.sleep); anything missing or unknown: none. */
export function readBoardSleep(raw: unknown): BoardSleep {
  if (typeof raw !== 'object' || raw === null) return { ...NO_SLEEP };
  const r = raw as { missed?: unknown; schedule?: unknown; idle_minutes?: unknown };
  const missed = MISSED_CHOICES.find((c) => c.value === r.missed)?.value ?? 'always';
  const s = r.schedule as { school?: unknown; weekend?: unknown } | null | undefined;
  const school = s ? nightOf(s.school) : null;
  const weekend = s ? nightOf(s.weekend) : null;
  const idle = IDLE_CHOICES.find((m) => m === r.idle_minutes) ?? null;
  return {
    missed,
    schedule: school && weekend ? { school, weekend } : null,
    idleMinutes: idle,
  };
}

/** The settings as they are stored. */
export function sleepToConfig(s: BoardSleep): Record<string, unknown> {
  return {
    missed: s.missed,
    ...(s.schedule
      ? {
          schedule: {
            school: { sleep: hhmm(s.schedule.school.sleep), wake: hhmm(s.schedule.school.wake) },
            weekend: { sleep: hhmm(s.schedule.weekend.sleep), wake: hhmm(s.schedule.weekend.wake) },
          },
        }
      : {}),
    ...(s.idleMinutes ? { idle_minutes: s.idleMinutes } : {}),
  };
}

/** `school_days()`'s answer as the board and the admin app keep it. */
export function readSchoolDays(raw: unknown): SchoolDays | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { from?: unknown; to?: unknown; days?: unknown };
  if (typeof r.from !== 'string' || typeof r.to !== 'string' || !Array.isArray(r.days)) return null;
  return {
    from: r.from,
    to: r.to,
    days: new Set(r.days.filter((d): d is string => typeof d === 'string')),
  };
}

// Calendar dates ------------------------------------------------------------------------------------

/** A calendar date ("YYYY-MM-DD") moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The calendar date in a time zone at an instant. */
export function localDate(timeZone: string, at: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at));
}

/** How far a time zone's clock is ahead of UTC at an instant, in minutes. */
function offsetMinutes(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/**
 * The instant a household's clock shows a time on a date. A time the clocks skip (2:30 am on the
 * night they go forward) is the same time into the new hour (3:30 am); a time shown twice (the
 * night they go back) is the first of the two.
 */
export function localInstant(timeZone: string, date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d) + minutes * 60_000;
  // The offset just before and just after: they differ only across a change of clocks.
  const before = offsetMinutes(timeZone, wall - 14 * 3_600_000);
  const after = offsetMinutes(timeZone, wall + 14 * 3_600_000);
  const first = wall - before * 60_000;
  if (offsetMinutes(timeZone, first) === before) return first;
  const second = wall - after * 60_000;
  if (offsetMinutes(timeZone, second) === after) return second;
  // Skipped: neither reading exists, so it falls as far after the jump as it was into the gap.
  return first;
}

/** Whether a date has school: from the household's school days, else Monday to Friday. */
export function isSchoolDay(date: string, school: SchoolDays | null): boolean {
  if (school && date >= school.from && date <= school.to) return school.days.has(date);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// When a board sleeps ---------------------------------------------------------------------------------

export interface Night {
  /** When it sleeps and wakes, ms since 1970. */
  from: number;
  to: number;
  /** The day it wakes on, and whether that day's times were a school night's. */
  wakeDate: string;
  school: boolean;
}

/**
 * [D-117] The night that ends on the morning of a date: its times are that date's (a school night
 * before a school day). A sleep time later than the wake time is the evening before; an earlier one
 * (after midnight) is the same date.
 */
export function nightBefore(
  schedule: NonNullable<BoardSleep['schedule']>,
  wakeDate: string,
  timeZone: string,
  school: SchoolDays | null,
): Night {
  const isSchool = isSchoolDay(wakeDate, school);
  const t = isSchool ? schedule.school : schedule.weekend;
  const sleepDate = t.sleep > t.wake ? addDays(wakeDate, -1) : wakeDate;
  return {
    from: localInstant(timeZone, sleepDate, t.sleep),
    to: localInstant(timeZone, wakeDate, t.wake),
    wakeDate,
    school: isSchool,
  };
}

/** The set times' night a moment falls in, or null when it falls in none. */
export function scheduledNight(
  sleep: BoardSleep,
  at: number,
  timeZone: string,
  school: SchoolDays | null,
): Night | null {
  if (!sleep.schedule) return null;
  const today = localDate(timeZone, at);
  for (const wakeDate of [today, addDays(today, 1)]) {
    const n = nightBefore(sleep.schedule, wakeDate, timeZone, school);
    if (at >= n.from && at < n.to) return n;
  }
  return null;
}

/** The next night to start after a moment, or null with no set times. */
export function nextNight(
  sleep: BoardSleep,
  at: number,
  timeZone: string,
  school: SchoolDays | null,
): Night | null {
  if (!sleep.schedule) return null;
  const today = localDate(timeZone, at);
  for (let i = 0; i <= 3; i++) {
    const n = nightBefore(sleep.schedule, addDays(today, i), timeZone, school);
    if (n.from > at) return n;
  }
  return null;
}

export interface Activity {
  /** Now, ms since 1970. */
  now: number;
  /** The last touch, click or mouse movement; null when none since the board opened. */
  lastTouch: number | null;
  /** When the board opened. */
  since: number;
}

/**
 * [DEV-07][US-207] Whether the board is asleep. During its set times it is, unless it was touched
 * during them within its idle time (5 minutes without one, D-117); outside them, only once it has
 * been untouched for its idle time since it woke. A board opened during its set times sleeps until
 * touched.
 */
export function boardAsleep(
  sleep: BoardSleep,
  a: Activity,
  timeZone: string,
  school: SchoolDays | null,
): boolean {
  const night = scheduledNight(sleep, a.now, timeZone, school);
  if (night) {
    const window = (sleep.idleMinutes ?? NIGHT_TOUCH_MINUTES) * 60_000;
    return a.lastTouch === null || a.lastTouch < night.from || a.now - a.lastTouch >= window;
  }
  if (sleep.idleMinutes === null) return false;
  // Waking at its time counts as a touch: it is on for its idle time at least.
  const woke = lastWake(sleep, a.now, timeZone, school) ?? -Infinity;
  return a.now - Math.max(a.lastTouch ?? a.since, woke) >= sleep.idleMinutes * 60_000;
}

/** When the board last woke at its set times, at or before a moment; null with no set times. */
export function lastWake(
  sleep: BoardSleep,
  at: number,
  timeZone: string,
  school: SchoolDays | null,
): number | null {
  if (!sleep.schedule) return null;
  const today = localDate(timeZone, at);
  for (const wakeDate of [today, addDays(today, -1)]) {
    const n = nightBefore(sleep.schedule, wakeDate, timeZone, school);
    if (n.to <= at) return n.to;
  }
  return null;
}

// When a board counts as missed ------------------------------------------------------------------------

/** How long a board may go unseen before Home says so (a dark board is usually just switched off). */
export const MISSED_AFTER_MINUTES = 24 * 60;
/** How far back Home counts a board's hours awake (and reads the school days for it). */
export const MISSED_LOOKBACK_DAYS = 60;

/** Minutes between two moments that fall outside the board's set times (its hours awake). */
export function awakeMinutesBetween(
  sleep: BoardSleep,
  from: number,
  to: number,
  timeZone: string,
  school: SchoolDays | null,
): number {
  let total = Math.max(0, to - from);
  if (!sleep.schedule || total === 0) return total / 60_000;
  // Each night that ends on a date from the first day to the day after the last.
  const last = addDays(localDate(timeZone, to), 1);
  for (let d = localDate(timeZone, from); d <= last; d = addDays(d, 1)) {
    const n = nightBefore(sleep.schedule, d, timeZone, school);
    total -= Math.max(0, Math.min(n.to, to) - Math.max(n.from, from));
  }
  return Math.max(0, total) / 60_000;
}

/**
 * [DEV-07][US-207] Whether Home lists a board as not seen: Always, after a day unseen; Only while
 * awake, after a day of its hours awake unseen, and never while it is asleep (D-117); Never, never.
 * A board never seen at all isn't listed (it is new, on Boards as "Not seen yet").
 */
export function boardMissed(
  sleep: BoardSleep,
  lastSeenAt: string | null,
  now: number,
  timeZone: string,
  school: SchoolDays | null,
): boolean {
  if (!lastSeenAt || sleep.missed === 'never') return false;
  const seen = new Date(lastSeenAt).getTime();
  if (sleep.missed === 'always' || !sleep.schedule) {
    return now - seen >= MISSED_AFTER_MINUTES * 60_000;
  }
  if (scheduledNight(sleep, now, timeZone, school)) return false;
  // Counted over the last 60 days at most: any board awake an hour a day has a day awake by then.
  const from = Math.max(seen, now - MISSED_LOOKBACK_DAYS * 86_400_000);
  return awakeMinutesBetween(sleep, from, now, timeZone, school) >= MISSED_AFTER_MINUTES;
}

// Burn-in -------------------------------------------------------------------------------------------------

/** How often the picture moves, and how far it may go each way (a 4 px square). */
export const DRIFT_STEP_MINUTES = 5;
export const DRIFT_PX = 2;

const triangle = (k: number, half: number) => {
  const period = 4 * half;
  const p = ((k % period) + period) % period;
  return p <= half ? p : p <= 3 * half ? 2 * half - p : p - period;
};

/**
 * [DEV-07] Where the board's picture sits now, in px from its place, so nothing stays on the same
 * pixels all day: one px every 5 minutes, sweeping a 4 px square (x every step, y once a sweep).
 */
export function drift(at: number): { x: number; y: number } {
  const k = Math.floor(at / (DRIFT_STEP_MINUTES * 60_000));
  const sweep = 4 * DRIFT_PX;
  return { x: triangle(k, DRIFT_PX), y: triangle(Math.floor(k / sweep), DRIFT_PX) };
}

// Boards (the admin app) ------------------------------------------------------------------------------

/** Minutes after midnight as the brand writes a time: "9:30 pm", "12 am" (06 §2). */
export function clockTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** An idle time as a person says it: "15 minutes", "1 hour", "2 hours". */
export function idleLabel(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/**
 * [DEV-07][US-207] Boards' "Sleep and wake" form as settings; null when a time is missing or a
 * night would sleep and wake at the same time. Set times are kept only with the box ticked.
 */
export function sleepFromForm(form: FormData): BoardSleep | null {
  const missed = MISSED_CHOICES.find((c) => c.value === form.get('missed'))?.value ?? 'always';
  const idle = IDLE_CHOICES.find((m) => String(m) === form.get('idle')) ?? null;
  if (form.get('idle') && form.get('idle') !== 'never' && idle === null) return null;
  if (form.get('scheduled') !== 'on') return { missed, schedule: null, idleMinutes: idle };
  const night = (prefix: string): NightTimes | null =>
    nightOf({ sleep: form.get(`${prefix}_sleep`), wake: form.get(`${prefix}_wake`) });
  const school = night('school');
  const weekend = night('weekend');
  if (!school || !weekend) return null;
  return { missed, schedule: { school, weekend }, idleMinutes: idle };
}

/** The summary line of a board's "Sleep and wake" (Boards). */
export function sleepSummary(s: BoardSleep): string {
  const parts: string[] = [];
  if (s.schedule) {
    const t = (n: NightTimes) => `${clockTime(n.sleep)} to ${clockTime(n.wake)}`;
    parts.push(`school nights ${t(s.schedule.school)}, weekends ${t(s.schedule.weekend)}`);
  }
  if (s.idleMinutes) parts.push(`sleeps after ${idleLabel(s.idleMinutes)} untouched`);
  if (s.missed === 'never') parts.push('never missed');
  else if (s.missed === 'awake' && s.schedule) parts.push('missed only while awake');
  return parts.length ? parts.join('; ') : 'always awake';
}

/**
 * [DEV-07] Whether a board is asleep at its set times now, and when that changes: "Asleep · wakes
 * at 6:30 am", "Awake · sleeps at 9:30 pm"; null without set times. (Asleep untouched is the
 * board's own to know: the admin app can't see who touches it.)
 */
export function sleepStatus(
  s: BoardSleep,
  now: number,
  timeZone: string,
  school: SchoolDays | null,
): { asleep: boolean; text: string } | null {
  if (!s.schedule) return null;
  const at = (ms: number) => {
    const [h, m] = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(ms))
      .split(':')
      .map(Number) as [number, number];
    return clockTime(h * 60 + m);
  };
  const night = scheduledNight(s, now, timeZone, school);
  if (night) return { asleep: true, text: `Asleep · wakes at ${at(night.to)}` };
  const next = nextNight(s, now, timeZone, school);
  return next ? { asleep: false, text: `Awake · sleeps at ${at(next.from)}` } : null;
}
