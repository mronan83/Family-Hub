import type { DayType } from './chores';

// School years and day types (WP-21, 02 §3.5, D-44): pure helpers for the admin forms and the
// year timeline. The database decides day types (resolve_day_type); nothing here re-derives them.

export const CLOSURE_TYPES = ['break', 'holiday', 'teacher_day', 'snow_day', 'other'] as const;
export type ClosureType = (typeof CLOSURE_TYPES)[number];
export const CLOSURE_LABELS: Record<ClosureType, string> = {
  break: 'Break',
  holiday: 'Holiday',
  teacher_day: 'Teacher day',
  snow_day: 'Snow day',
  other: 'Other day off',
};

/** One day's type in words (06 §2: plain words). */
export const DAY_TYPE_NAMES: Record<DayType, string> = {
  school_day: 'School day',
  no_school: 'Day off school',
  break: 'Break',
  weekend: 'Weekend',
  summer: 'Summer',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const at = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === s;
}

/** Days from `a` to `b` (both "YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function range(form: FormData, single = false): Result<{ start: string; end: string }> {
  const start = String(form.get('startDate') ?? '').trim();
  const endText = String(form.get('endDate') ?? '').trim();
  const end = single && !endText ? start : endText;
  if (!isDate(start)) return { ok: false, message: 'Choose a start date.' };
  if (!isDate(end)) return { ok: false, message: 'Choose an end date.' };
  if (end < start) return { ok: false, message: 'The end date is before the start date.' };
  return { ok: true, value: { start, end } };
}

function name(form: FormData, max: number, what: string): Result<string> {
  const value = String(form.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > max) {
    return { ok: false, message: `Give the ${what} a name of up to ${max} characters.` };
  }
  return { ok: true, value };
}

export interface SchoolYearInput {
  name: string;
  schoolName: string | null;
  startDate: string;
  endDate: string;
  isDefault: boolean;
}

/** [SCH-01] A school year: a name, an optional school, first and last day, and whether it's a default. */
export function parseSchoolYear(form: FormData): Result<SchoolYearInput> {
  const n = name(form, 40, 'school year');
  if (!n.ok) return n;
  const school = String(form.get('schoolName') ?? '').trim();
  if (school.length > 80)
    return { ok: false, message: 'Keep the school’s name under 80 characters.' };
  const r = range(form);
  if (!r.ok) return r;
  if (r.value.end === r.value.start) {
    return { ok: false, message: 'The last day comes after the first day.' };
  }
  if (daysBetween(r.value.start, r.value.end) > 400) {
    return { ok: false, message: 'A school year can be up to about 13 months long.' };
  }
  return {
    ok: true,
    value: {
      name: n.value,
      schoolName: school || null,
      startDate: r.value.start,
      endDate: r.value.end,
      isDefault: form.get('isDefault') === 'on',
    },
  };
}

export interface ClosureInput {
  name: string;
  closureType: ClosureType;
  startDate: string;
  endDate: string;
}

/** [SCH-01] A break or day off: one day (no end date) or several. */
export function parseClosure(form: FormData): Result<ClosureInput> {
  const n = name(form, 60, 'day off');
  if (!n.ok) return n;
  const type = String(form.get('closureType') ?? '');
  if (!(CLOSURE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, message: 'Choose what kind of day off it is.' };
  }
  const r = range(form, true);
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      name: n.value,
      closureType: type as ClosureType,
      startDate: r.value.start,
      endDate: r.value.end,
    },
  };
}

export interface TermInput {
  name: string;
  startDate: string;
  endDate: string;
}

export function parseTerm(form: FormData): Result<TermInput> {
  const n = name(form, 40, 'term');
  if (!n.ok) return n;
  const r = range(form);
  if (!r.ok) return r;
  return { ok: true, value: { name: n.value, startDate: r.value.start, endDate: r.value.end } };
}

/** Database errors on a school-year save, as lines for the admin (hints from the migration). */
export function schoolSaveMessage(error: { code?: string | null; hint?: string | null }): string {
  switch (error.hint) {
    case 'default_year_overlap':
      return 'Another default school year covers some of these dates. Default years can’t overlap: change the dates, or untick Default.';
    case 'outside_school_year':
      return 'Those dates are outside the school year. Change them, or the school year’s dates first.';
    case 'year_excludes_dates':
      return 'A term or day off falls outside these dates. Move or remove it first.';
    case 'profile_overlap':
      return 'They already follow another school year on some of these dates.';
  }
  return 'That didn’t save. Try again in a moment.';
}

// ---------------------------------------------------------------------------------------------
// The timeline: a school year's days as month grids (SCH-01, US-601)
// ---------------------------------------------------------------------------------------------

export interface Day {
  day: string;
  dayType: DayType;
}

export interface Month {
  /** "August 2026" */
  label: string;
  /** Weeks of seven cells; null pads the first and last week. */
  weeks: (Day | null)[][];
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * [SCH-01] Days grouped into calendar months, weeks starting on the household's week start
 * (0 = Sunday … 6 = Saturday, as `household.week_start`).
 */
export function monthGrid(days: Day[], weekStart = 0): Month[] {
  const months: Month[] = [];
  let current: { key: string; cells: (Day | null)[] } | null = null;
  const flush = () => {
    if (!current) return;
    while (current.cells.length % 7 !== 0) current.cells.push(null);
    const weeks: (Day | null)[][] = [];
    for (let i = 0; i < current.cells.length; i += 7) weeks.push(current.cells.slice(i, i + 7));
    months.push({ label: MONTH.format(new Date(`${current.key}-01T12:00:00Z`)), weeks });
  };
  for (const d of days) {
    const key = d.day.slice(0, 7);
    if (!current || current.key !== key) {
      flush();
      const dow = new Date(`${d.day}T12:00:00Z`).getUTCDay();
      current = { key, cells: Array<null>((dow - weekStart + 7) % 7).fill(null) };
    }
    current.cells.push(d);
  }
  flush();
  return months;
}

/** Weekday headings for a grid starting on `weekStart`. */
export function weekdayHeadings(weekStart = 0): string[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names.map((_, i) => names[(i + weekStart) % 7]!);
}

/** How many days of each type, for the timeline's summary line. */
export function countDayTypes(days: Day[]): Record<DayType, number> {
  const counts: Record<DayType, number> = {
    school_day: 0,
    no_school: 0,
    break: 0,
    weekend: 0,
    summer: 0,
  };
  for (const d of days) counts[d.dayType] += 1;
  return counts;
}
