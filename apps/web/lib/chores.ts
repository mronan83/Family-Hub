import { ICON_NAMES, tileState, type IconName, type TileTone } from '@familywise/ui';
import type { OccurrenceStatus } from '@familywise/rules-engine';
import { z } from 'zod';

// The family list (WP-08, D-30..D-34): chores (routines) and tasks (to-dos) for any member, with
// schedules, an optional due time, tags and visibility. Pure functions for the admin forms and list.

export const KINDS = ['chore', 'task'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = { chore: 'Chore', task: 'Task' };

/**
 * [CHR-18] With several people (D-47): "each" makes one occurrence per person, so everyone does
 * their own; "shared" makes one, done by whoever gets to it (D-30). A new chore starts as each, a
 * new task as shared.
 */
export const ASSIGNMENTS = ['each', 'shared'] as const;
export type Assignment = (typeof ASSIGNMENTS)[number];
export const ASSIGNMENT_LABELS: Record<Assignment, string> = {
  each: 'Everyone does their own',
  shared: 'Any one of them',
};
export const defaultAssignment = (kind: Kind): Assignment => (kind === 'chore' ? 'each' : 'shared');

export const APPROVALS = ['inherit', 'required', 'none'] as const;
export type Approval = (typeof APPROVALS)[number];

/** Day types an item can apply on (02 §4.4); the school year arrives in WP-21. */
export const DAY_TYPES = ['school_day', 'no_school', 'break', 'weekend', 'summer'] as const;
export type DayType = (typeof DAY_TYPES)[number];
export const DAY_TYPE_LABELS: Record<DayType, string> = {
  school_day: 'School days',
  no_school: 'Days off school',
  break: 'School breaks',
  weekend: 'Weekends',
  summer: 'Summer',
};

/** ISO weekdays, as the database and resolve_day_type use them: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const FREQS = ['daily', 'weekly', 'monthly', 'once'] as const;
export type Freq = (typeof FREQS)[number];

/** The chore icons the picker shows first (06 §8); any icon in the set may be stored. */
export const CHORE_ICONS = ICON_NAMES.filter((n) => n.startsWith('chore-'));

const uniqueInts = (lo: number, hi: number) =>
  z
    .array(z.int().min(lo).max(hi))
    .min(1)
    .refine((a) => new Set(a).size === a.length, 'repeated day');

const isoDate = z.iso.date().refine((d) => {
  const at = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === d;
}, 'not a calendar date');

/**
 * [CHR-01] The `chore.schedule` shape (02 §3.2), the same rule as the database's
 * private.valid_schedule: a known frequency and only the keys it uses.
 */
export const scheduleSchema = z.discriminatedUnion('freq', [
  z.strictObject({ freq: z.literal('daily'), interval: z.int().min(1).max(52).optional() }),
  z.strictObject({
    freq: z.literal('weekly'),
    interval: z.int().min(1).max(52).optional(),
    by_weekday: uniqueInts(1, 7),
  }),
  z.strictObject({
    freq: z.literal('monthly'),
    interval: z.int().min(1).max(52).optional(),
    by_month_day: uniqueInts(1, 31),
  }),
  z.strictObject({ freq: z.literal('once'), on_date: isoDate }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export interface ChoreInput {
  kind: Kind;
  title: string;
  icon: IconName;
  assignees: string[];
  schedule: Schedule;
  /** Household-local "HH:MM", or null for anytime. */
  dueTime: string | null;
  dayTypes: DayType[];
  points: number;
  approval: Approval;
  assignment: Assignment;
  tags: string[];
  /** Left out when the form does not offer it (only an item's creator changes who sees it). */
  visibility?: 'family' | 'private';
}

export type Parsed = { ok: true; value: ChoreInput } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (form: FormData, name: string) =>
  [...new Set(form.getAll(name).map(String))].filter((v) => UUID.test(v));

/**
 * [CHR-01][CHR-09][CHR-11][CHR-13] A chore or task form, checked the way the database will check
 * it, so the admin gets one plain line instead of a constraint error.
 */
export function parseChore(
  form: FormData,
  { canSetVisibility }: { canSetVisibility: boolean },
): Parsed {
  const kind = form.get('kind');
  if (kind !== 'chore' && kind !== 'task') return { ok: false, message: 'Choose chore or task.' };
  const title = String(form.get('title') ?? '').trim();
  if (title.length < 1 || title.length > 80) {
    return { ok: false, message: 'Give it a name of up to 80 characters.' };
  }
  const iconText = String(form.get('icon') ?? '');
  if (iconText && !(ICON_NAMES as readonly string[]).includes(iconText)) {
    return { ok: false, message: 'Choose an icon.' };
  }
  const icon = (iconText || 'list-check') as IconName;
  const assignees = ids(form, 'assignees');
  if (assignees.length === 0) return { ok: false, message: 'Choose who it’s for.' };

  const schedule = readSchedule(form);
  if (typeof schedule === 'string') return { ok: false, message: schedule };

  const timeText = String(form.get('dueTime') ?? '').trim();
  const dueTime = timeText ? timeText.slice(0, 5) : null;
  if (dueTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
    return { ok: false, message: 'Enter a due time like 7:30 am, or leave it empty.' };
  }

  const dayTypes = DAY_TYPES.filter((d) => form.getAll('dayTypes').includes(d));
  if (dayTypes.length === 0) return { ok: false, message: 'Choose at least one kind of day.' };

  const pointsText = String(form.get('points') ?? '').trim();
  const points = pointsText ? Number(pointsText) : 0;
  if (!Number.isInteger(points) || points < 0 || points > 1000) {
    return { ok: false, message: 'Points are a whole number from 0 to 1,000.' };
  }
  const approvalText = String(form.get('approval') ?? 'inherit');
  const approval = (APPROVALS as readonly string[]).includes(approvalText)
    ? (approvalText as Approval)
    : 'inherit';
  const assignmentText = String(form.get('assignment') ?? '');
  const assignment = (ASSIGNMENTS as readonly string[]).includes(assignmentText)
    ? (assignmentText as Assignment)
    : defaultAssignment(kind);

  return {
    ok: true,
    value: {
      kind,
      title,
      icon,
      assignees,
      schedule,
      dueTime,
      dayTypes,
      points,
      approval,
      assignment,
      tags: ids(form, 'tags'),
      ...(canSetVisibility
        ? { visibility: form.get('private') === 'on' ? ('private' as const) : ('family' as const) }
        : {}),
    },
  };
}

/** The schedule fields of the form, or a line saying what to fix. */
function readSchedule(form: FormData): Schedule | string {
  const freq = String(form.get('freq') ?? '');
  let candidate: unknown;
  if (freq === 'daily') candidate = { freq };
  else if (freq === 'weekly') {
    const days = form.getAll('weekdays').map(Number);
    if (days.length === 0) return 'Choose at least one day of the week.';
    candidate = { freq, by_weekday: [...new Set(days)].sort((a, b) => a - b) };
  } else if (freq === 'monthly') {
    const day = Number(String(form.get('monthDay') ?? '').trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return 'Enter a day of the month from 1 to 31.';
    }
    candidate = { freq, by_month_day: [day] };
  } else if (freq === 'once') {
    const date = String(form.get('onDate') ?? '').trim();
    if (!date) return 'Choose a date.';
    candidate = { freq, on_date: date };
  } else return 'Choose how often it happens.';
  const parsed = scheduleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : 'Check the schedule: that date or day isn’t valid.';
}

/** What save_chore receives as p_item. */
export function chorePayload(input: ChoreInput): Record<string, unknown> {
  return {
    kind: input.kind,
    title: input.title,
    icon: input.icon,
    points: input.points,
    approval: input.approval,
    assignment: input.assignment,
    schedule: input.schedule,
    due_time: input.dueTime,
    day_types: input.dayTypes,
    ...(input.visibility ? { visibility: input.visibility } : {}),
  };
}

/** Database errors on a save, as lines for the admin (hints from the chores migration). */
export function choreSaveMessage(error: { code?: string | null; hint?: string | null }): string {
  if (error.hint === 'chore_needs_assignee') return 'Choose who it’s for.';
  if (error.hint === 'visibility_creator_only') {
    return 'Only the person who created this item can change who sees it.';
  }
  if (error.hint === 'chore_not_found' || error.code === 'P0002') {
    return 'That item isn’t there any more. Someone may have made it private.';
  }
  if (error.code === '23514') return 'Something in the form isn’t valid. Check the schedule.';
  return 'That didn’t save. Try again in a moment.';
}

// ---------------------------------------------------------------------------------------------
// Words for the list
// ---------------------------------------------------------------------------------------------

/** The parts of the day the board groups by (CHR-11, US-313). */
export const DAY_PARTS = ['morning', 'after_school', 'evening', 'anytime'] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: 'Morning',
  after_school: 'After school',
  evening: 'Evening',
  anytime: 'Anytime',
};

/** Morning before noon, after school from noon, evening from 5 pm; no due time is anytime. */
export function dayPart(dueTime: string | null): DayPart {
  if (!dueTime) return 'anytime';
  const hour = Number(dueTime.slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'after_school';
  return 'evening';
}

/** "07:30" or "07:30:00" → "7:30 am" (06 §2). */
export function clock(dueTime: string): string {
  const [h, m] = dueTime.split(':').map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** A date-only "2026-11-02" as the brand writes dates: "Mon, Nov 2". */
export function calendarDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function list(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** [CHR-01] A schedule in words: "Every day", "Weekdays", "Mon, Wed and Fri", "Due Mon, Nov 2". */
export function describeSchedule(s: Schedule, kind: Kind = 'chore'): string {
  const every = (n: number | undefined, unit: string) =>
    n && n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;
  switch (s.freq) {
    case 'daily':
      return every(s.interval, 'day');
    case 'weekly': {
      const days = [...s.by_weekday].sort((a, b) => a - b);
      const key = days.join(',');
      const words =
        key === '1,2,3,4,5,6,7'
          ? 'every day'
          : key === '1,2,3,4,5'
            ? 'weekdays'
            : key === '6,7'
              ? 'weekends'
              : list(days.map((d) => WEEKDAY_LABELS[d - 1]!));
      if (s.interval && s.interval > 1) return `Every ${s.interval} weeks: ${words}`;
      return words[0]!.toUpperCase() + words.slice(1);
    }
    case 'monthly': {
      const days = list([...s.by_month_day].sort((a, b) => a - b).map(ordinal));
      return s.interval && s.interval > 1
        ? `Every ${s.interval} months on the ${days}`
        : `Monthly on the ${days}`;
    }
    case 'once':
      return `${kind === 'task' ? 'Due' : 'Once,'} ${calendarDay(s.on_date)}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Filters (CHR-01: by person, tag, time of day, status and kind)
// ---------------------------------------------------------------------------------------------

export interface ListItem {
  id: string;
  title: string;
  kind: Kind;
  dueTime: string | null;
  assignees: string[];
  tags: string[];
  archivedAt: string | null;
}

export interface Filters {
  person: string | null;
  tag: string | null;
  kind: Kind | null;
  when: DayPart | null;
  status: 'active' | 'archived';
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Filters from the query string; anything unknown is ignored rather than refused. */
export function parseFilters(params: Params): Filters {
  const person = one(params.person);
  const tag = one(params.tag);
  const kind = one(params.kind);
  const when = one(params.when);
  return {
    person: UUID.test(person) ? person : null,
    tag: UUID.test(tag) ? tag : null,
    kind: (KINDS as readonly string[]).includes(kind) ? (kind as Kind) : null,
    when: (DAY_PARTS as readonly string[]).includes(when) ? (when as DayPart) : null,
    status: one(params.status) === 'archived' ? 'archived' : 'active',
  };
}

/** The items matching every filter: chores first, then tasks; each by due time, then name. */
export function filterItems<T extends ListItem>(items: T[], f: Filters): T[] {
  return items
    .filter((i) => (f.status === 'archived') === (i.archivedAt !== null))
    .filter((i) => !f.person || i.assignees.includes(f.person))
    .filter((i) => !f.tag || i.tags.includes(f.tag))
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => !f.when || dayPart(i.dueTime) === f.when)
    .sort(
      (a, b) =>
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
        (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') ||
        a.title.localeCompare(b.title),
    );
}

// ---------------------------------------------------------------------------------------------
// Occurrences (WP-09): when an item is next due, and tasks left open
// ---------------------------------------------------------------------------------------------

export interface OccurrenceDate {
  choreId: string;
  dueDate: string;
  kind: Kind;
  status: string;
}

/** "Today", "Tomorrow", or the brand's date: "Mon, Oct 12" (dates are "YYYY-MM-DD"). */
export function relativeDay(date: string, today: string): string {
  if (date === today) return 'Today';
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  if (date === day(1)) return 'Tomorrow';
  if (date === day(-1)) return 'Yesterday';
  return calendarDay(date);
}

/**
 * [CHR-07][CHR-09] One past day of an item, for a parent: its status in plain words (06 §7.1: an
 * icon and a word, never color alone) and who did it. An open task from before today is overdue
 * (D-31); an open routine from before today is open until day close marks it missed.
 */
export function historyLine(
  o: { status: OccurrenceStatus; doneBy: string[]; memberId?: string | null },
  kind: Kind,
  names: (id: string) => string,
): { icon: IconName; text: string; tone: TileTone } {
  const state = tileState(
    o.status,
    o.status === 'scheduled' && kind === 'task' ? 'overdue' : undefined,
  );
  const who = o.doneBy.map(names).join(' and ');
  // A person's own occurrence (D-47) leads with their name; "by" only when someone else did it.
  if (o.memberId) {
    const own = names(o.memberId);
    const by = o.doneBy.length === 1 && o.doneBy[0] === o.memberId ? '' : ` by ${who}`;
    const words =
      o.status === 'completed'
        ? `done${by}`
        : o.status === 'approved'
          ? `approved · done${by}`
          : o.status === 'pending_approval'
            ? `needs review · checked off${by}`
            : state.adminLabel.toLowerCase();
    return { icon: state.icon, text: `${own}: ${words}`, tone: state.tone };
  }
  const text =
    o.status === 'completed'
      ? `Done by ${who}`
      : o.status === 'approved'
        ? `Approved · done by ${who}`
        : o.status === 'pending_approval'
          ? `Needs review · checked off by ${who}`
          : state.adminLabel;
  return { icon: state.icon, text, tone: state.tone };
}

/**
 * [CHR-03][CHR-12] Per item: its next date from today on, and for a task the oldest date it was
 * left open before today (shown as overdue, D-31).
 */
export function dueSummary(
  occurrences: OccurrenceDate[],
  today: string,
): Map<string, { next: string | null; overdueSince: string | null }> {
  const out = new Map<string, { next: string | null; overdueSince: string | null }>();
  for (const o of occurrences) {
    const s = out.get(o.choreId) ?? { next: null, overdueSince: null };
    if (o.dueDate >= today && (!s.next || o.dueDate < s.next)) s.next = o.dueDate;
    if (
      o.kind === 'task' &&
      o.status === 'scheduled' &&
      o.dueDate < today &&
      (!s.overdueSince || o.dueDate < s.overdueSince)
    ) {
      s.overdueSince = o.dueDate;
    }
    out.set(o.choreId, s);
  }
  return out;
}
