// [CHR-21][CHR-22][CHR-23][D-132] The Chores page in four sections (WP-96): which section an item is
// in, its date heading in Scheduled, the order inside each section, the person chips and More
// filters, Duplicate's filled form and Do again's dates. Dates are household-local "YYYY-MM-DD"
// calendar dates, so midnight, a week's end and DST never move an item.
import { weekStartOf } from './board-calendar';
import {
  calendarDay,
  DAY_PART_LABELS,
  DAY_PARTS,
  dayPart,
  KINDS,
  type ChoreInput,
  type DayPart,
  type Kind,
  type ListItem,
  type Schedule,
} from './chores';
import { isoDay } from './format';

export const SECTIONS = ['scheduled', 'recurring', 'completed', 'archived'] as const;
export type Section = (typeof SECTIONS)[number];

/** Scheduled's date headings, in their order on the page (Q9). */
export const HEADINGS = ['overdue', 'today', 'week', 'later'] as const;
export type Heading = (typeof HEADINGS)[number];
export const HEADING_LABELS: Record<Heading, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
};

/** An item as the sections read it: the list's fields, its schedule and when it was archived. */
export interface SectionItem extends ListItem {
  schedule: Schedule;
  assignment: 'each' | 'shared';
}

/** One occurrence of a one-time item: whose it is (an "each" item, D-47), its state, and when it changed. */
export interface OnceOccurrence {
  choreId: string;
  dueDate: string;
  memberId: string | null;
  status: string;
  /** When its status last changed (a timestamp), for the day it was done. */
  changedAt: string | null;
}

export type Outcome = 'done' | 'missed' | 'skipped';

export interface Placed<T extends SectionItem> {
  item: T;
  section: Section;
  /** Scheduled only: its date heading. */
  heading?: Heading;
  /** A one-time item's date. */
  date?: string;
  /** Scheduled, an item for several people each their own: how many have done theirs (Q4). */
  progress?: { done: number; of: number };
  /** Completed only: done, missed (a chore not done on its day, Q3) or skipped. */
  outcome?: Outcome;
  /** Completed only: the household-local day it was finished. */
  finishedOn?: string;
}

const DONE = new Set(['completed', 'approved']);

/** Over for good: done, skipped, or (a chore) missed. A task is never missed; it stays open (D-31). */
function finished(status: string, kind: Kind): boolean {
  return DONE.has(status) || status === 'skipped' || (kind === 'chore' && status === 'missed');
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * [CHR-21] Scheduled's heading for a date: before today is Overdue, then Today, This week (to the
 * last day of the household's week) and Later.
 */
export function headingFor(date: string, today: string, weekStart: number): Heading {
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  const weekEnd = addDays(weekStartOf(today, weekStart), 6);
  return date <= weekEnd ? 'week' : 'later';
}

/**
 * [CHR-21][D-132] Which section each item is in. Archived wins; anything that repeats is Recurring
 * and is never completed; a one-time item is Completed once every occurrence on its date is over
 * (done, skipped, or a chore missed), else Scheduled under its date's heading. A one-time item not
 * planned yet (more than two weeks ahead) is Scheduled.
 */
export function place<T extends SectionItem>(
  items: T[],
  occurrences: OnceOccurrence[],
  today: string,
  weekStart: number,
  timeZone: string,
): Placed<T>[] {
  const byItem = new Map<string, OnceOccurrence[]>();
  for (const o of occurrences) byItem.set(o.choreId, [...(byItem.get(o.choreId) ?? []), o]);
  return items.map((item) => {
    if (item.archivedAt) return { item, section: 'archived' };
    if (item.schedule.freq !== 'once') return { item, section: 'recurring' };
    const date = item.schedule.on_date;
    const own = (byItem.get(item.id) ?? []).filter((o) => o.dueDate === date);
    const over = own.filter((o) => finished(o.status, item.kind));
    if (own.length > 0 && over.length === own.length) {
      const outcome: Outcome = own.some((o) => DONE.has(o.status))
        ? 'done'
        : own.some((o) => o.status === 'missed')
          ? 'missed'
          : 'skipped';
      const last = own
        .map((o) => o.changedAt)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1);
      return {
        item,
        section: 'completed',
        date,
        outcome,
        finishedOn: last ? isoDay(timeZone, new Date(last)) : date,
      };
    }
    const placed: Placed<T> = {
      item,
      section: 'scheduled',
      date,
      heading: headingFor(date, today, weekStart),
    };
    if (own.length > 1) {
      placed.progress = { done: own.filter((o) => DONE.has(o.status)).length, of: own.length };
    }
    return placed;
  });
}

const byName = (a: SectionItem, b: SectionItem) => a.title.localeCompare(b.title);
const byTime = (a: SectionItem, b: SectionItem) =>
  (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99');

/**
 * [CHR-21] Each section in its order (Q9): Scheduled by date then time; Recurring by time of day
 * (morning first, anytime last) then name; Completed newest done first; Archived newest archived
 * first.
 */
export function sections<T extends SectionItem>(placed: Placed<T>[]): Record<Section, Placed<T>[]> {
  const of = (s: Section) => placed.filter((p) => p.section === s);
  return {
    scheduled: of('scheduled').sort(
      (a, b) => a.date!.localeCompare(b.date!) || byTime(a.item, b.item) || byName(a.item, b.item),
    ),
    recurring: of('recurring').sort(
      (a, b) =>
        DAY_PARTS.indexOf(dayPart(a.item.dueTime)) - DAY_PARTS.indexOf(dayPart(b.item.dueTime)) ||
        byTime(a.item, b.item) ||
        byName(a.item, b.item),
    ),
    completed: of('completed').sort(
      (a, b) => b.finishedOn!.localeCompare(a.finishedOn!) || byName(a.item, b.item),
    ),
    archived: of('archived').sort(
      (a, b) => b.item.archivedAt!.localeCompare(a.item.archivedAt!) || byName(a.item, b.item),
    ),
  };
}

/** Scheduled's items under their headings, in order, leaving out a heading with nothing under it. */
export function byHeading<T extends SectionItem>(
  scheduled: Placed<T>[],
): { heading: Heading; items: Placed<T>[] }[] {
  return HEADINGS.map((heading) => ({
    heading,
    items: scheduled.filter((p) => p.heading === heading),
  })).filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------------------------------------
// Person chips and More filters (Q1, Q2)
// ---------------------------------------------------------------------------------------------

export interface ChoreFilters {
  /** The chosen faces: an item shows when it is for any of them (Q2). None is everyone. */
  people: string[];
  tag: string | null;
  kind: Kind | null;
  when: DayPart | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The filters from the query string (`who` is the chosen faces' ids, comma separated). */
export function parseChoreFilters(params: Params): ChoreFilters {
  const people = [...new Set(`${one(params.who)},${one(params.person)}`.split(','))].filter((id) =>
    UUID.test(id),
  );
  const tag = one(params.tag);
  const kind = one(params.kind);
  const when = one(params.when);
  return {
    people,
    tag: UUID.test(tag) ? tag : null,
    kind: (KINDS as readonly string[]).includes(kind) ? (kind as Kind) : null,
    when: (DAY_PARTS as readonly string[]).includes(when) ? (when as DayPart) : null,
  };
}

/** The page's address for a set of filters; only what is set, so a clear page is `/admin/chores`. */
export function filtersHref(f: ChoreFilters, base = '/admin/chores'): string {
  const q = new URLSearchParams();
  if (f.people.length) q.set('who', f.people.join(','));
  if (f.tag) q.set('tag', f.tag);
  if (f.kind) q.set('kind', f.kind);
  if (f.when) q.set('when', f.when);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** [CHR-21] A face tapped: on if it was off, off if it was on (Q2). */
export function togglePerson(f: ChoreFilters, id: string): ChoreFilters {
  return {
    ...f,
    people: f.people.includes(id) ? f.people.filter((p) => p !== id) : [...f.people, id],
  };
}

/** [CHR-21] The items every filter lets through: for any chosen face, and the More filters set. */
export function applyFilters<T extends ListItem>(items: T[], f: ChoreFilters): T[] {
  return items.filter(
    (i) =>
      (f.people.length === 0 || i.assignees.some((a) => f.people.includes(a))) &&
      (!f.tag || i.tags.includes(f.tag)) &&
      (!f.kind || i.kind === f.kind) &&
      (!f.when || dayPart(i.dueTime) === f.when),
  );
}

/** One line of words, the key facts as `{ b }` (the fold's summary, WP-94's FoldLine). */
export type Words = (string | { b: string })[];

const KIND_FILTER: Record<Kind, string> = { chore: 'Chores', task: 'Tasks' };

/**
 * [CHR-21] More filters' folded line (Q1): what is set, in bold, and how many show of all, so a
 * filtered page reads as filtered; or the defaults when nothing is set.
 */
export function moreFiltersLine(
  f: ChoreFilters,
  tagName: (id: string) => string,
  shown: number,
  total: number,
): Words {
  const set: string[] = [];
  if (f.tag) set.push(`Tag: ${tagName(f.tag)}`);
  if (f.kind) set.push(`Kind: ${KIND_FILTER[f.kind]}`);
  if (f.when) set.push(`Time of day: ${DAY_PART_LABELS[f.when]}`);
  if (set.length === 0) return ['Any tag · Chores and tasks · Any time'];
  return [{ b: set.join(' · ') }, ` · ${shown} of ${total} ${shown === 1 ? 'shows' : 'show'}`];
}

/** [CHR-21] Completed's count, as its header says it: "12 done · 1 missed" (Q3). */
export function completedCount(completed: Placed<SectionItem>[]): string {
  const done = completed.filter((p) => p.outcome !== 'missed').length;
  const missed = completed.length - done;
  return missed > 0 ? `${done} done · ${missed} missed` : `${done} done`;
}

/** Completed shows the newest 20, then 20 more for each Show older. */
export const COMPLETED_PAGE = 20;

// ---------------------------------------------------------------------------------------------
// Duplicate and Do again (CHR-22, CHR-23)
// ---------------------------------------------------------------------------------------------

const COPY = ' (copy)';

/**
 * [CHR-22] Duplicate's form, filled in from the original: everything as it is, the name marked
 * "(copy)" (cut so it still fits 80 characters). [CHR-23] Do again's "Change more first" gives a
 * date: the copy is then a one-time item on that date, under the original's own name.
 */
export function duplicateOf(original: ChoreInput, onDate?: string): ChoreInput {
  const title = onDate ? original.title : `${original.title.slice(0, 80 - COPY.length)}${COPY}`;
  return {
    ...original,
    title,
    assignees: [...original.assignees],
    tags: [...original.tags],
    dayTypes: [...original.dayTypes],
    schedule: onDate ? { freq: 'once', on_date: onDate } : original.schedule,
  };
}

/**
 * [CHR-23] Do again's quick dates (Q7): Tomorrow, the next Saturday after tomorrow, In a week; a
 * date already offered is offered once.
 */
export function doAgainDates(today: string): { label: string; date: string }[] {
  const tomorrow = addDays(today, 1);
  const toSaturday = (6 - new Date(`${tomorrow}T12:00:00Z`).getUTCDay() + 7) % 7 || 7;
  const saturday = addDays(tomorrow, toSaturday);
  const week = addDays(today, 7);
  const out = [{ label: 'Tomorrow', date: tomorrow }];
  if (saturday !== week) out.push({ label: calendarDay(saturday), date: saturday });
  out.push({ label: 'In a week', date: week });
  return out;
}

// ---------------------------------------------------------------------------------------------
// A row's second line, and an item's page folded (NFR-18)
// ---------------------------------------------------------------------------------------------

/** A piece of a row's second line, in its tone: late (the missed colour), done, or points. */
export interface Part {
  text: string;
  tone?: 'late' | 'done' | 'pts';
}

/** "Oct 2": a date-only "YYYY-MM-DD" without its weekday, for a date long past. */
export function monthDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

/**
 * [CHR-21] A row's second line (two-line rows, D-132): when, its time, who and its points; in
 * Scheduled its date ("Due today", late when overdue) and "1 of 2 done"; in Recurring a task's
 * "Overdue since" first; in Completed "Done Sun, Oct 11" or "Missed"; in Archived when.
 */
export function rowParts<T extends SectionItem & { points: number; lunchNote?: string | null }>(
  p: Placed<T>,
  ctx: {
    today: string;
    timeZone: string;
    who: string;
    describe: (s: Schedule, kind: Kind) => string;
    clock: (t: string) => string;
    overdueSince?: string | null;
  },
): Part[] {
  const { item } = p;
  const parts: Part[] = [];
  const time = item.dueTime ? [{ text: ctx.clock(item.dueTime) }] : [];
  const points = item.points > 0 ? [{ text: `+${item.points}`, tone: 'pts' as const }] : [];
  const who = ctx.who ? [{ text: ctx.who }] : [];
  if (p.section === 'scheduled') {
    const lead = item.kind === 'task' ? 'Due' : 'Once,';
    const when = p.date === ctx.today ? 'today' : calendarDay(p.date!);
    parts.push({ text: `${lead} ${when}`, ...(p.heading === 'overdue' ? { tone: 'late' } : {}) });
    parts.push(...time, ...who);
    if (p.progress) parts.push({ text: `${p.progress.done} of ${p.progress.of} done` });
    parts.push(...points);
  } else if (p.section === 'recurring') {
    if (ctx.overdueSince) {
      parts.push({ text: `Overdue since ${calendarDay(ctx.overdueSince)}`, tone: 'late' });
    }
    parts.push({ text: ctx.describe(item.schedule, item.kind) });
    if (item.lunchNote) parts.push({ text: item.lunchNote });
    parts.push(...time, ...who, ...points);
  } else if (p.section === 'completed') {
    const word = p.outcome === 'done' ? 'Done' : p.outcome === 'missed' ? 'Missed' : 'Skipped';
    parts.push({
      text: `${word} ${calendarDay(p.finishedOn!)}`,
      tone: p.outcome === 'done' ? 'done' : p.outcome === 'missed' ? 'late' : undefined,
    });
    parts.push(...who, ...points);
  } else {
    parts.push({ text: ctx.describe(item.schedule, item.kind) }, ...who);
    parts.push({ text: `Archived ${monthDay(isoDay(ctx.timeZone, new Date(item.archivedAt!)))}` });
  }
  return parts.map((x) => (x.tone ? x : { text: x.text }));
}

/** [NFR-18] More options' folded line on an item (the fold audit): approval, days and lunch, as set. */
export function moreOptionsLine(
  item: { approval: 'inherit' | 'required' | 'none'; dayTypes: string[]; lunchDays: string | null },
  approvalMode: 'on' | 'off',
  dayLabel: (d: string) => string,
  lunchLabel: (l: string) => string,
): string {
  const approval =
    item.approval === 'inherit'
      ? `Approval: family setting (${approvalMode})`
      : item.approval === 'required'
        ? 'Always needs a parent’s OK'
        : 'Never needs a parent’s OK';
  const days =
    item.dayTypes.length >= 5
      ? 'every kind of day'
      : item.dayTypes.length === 1
        ? `${dayLabel(item.dayTypes[0]!)} only`
        : item.dayTypes.map(dayLabel).join(', ');
  const lunch = item.lunchDays ? `on ${lunchLabel(item.lunchDays).toLowerCase()}` : 'any lunch day';
  return `${approval} · ${days} · ${lunch}`;
}

/** [NFR-18] Coming up's folded line: the next one, when and who, and how many in two weeks. */
export function comingUpLine(
  days: { dueDate: string; members: string[] }[],
  ctx: {
    today: string;
    time: string | null;
    name: (id: string) => string;
    relative: (d: string, t: string) => string;
  },
): Words {
  const next = days[0];
  if (!next) return ['Nothing in the next two weeks'];
  const when = ctx.relative(next.dueDate, ctx.today);
  const at = `${/^(Today|Tomorrow|Yesterday)$/.test(when) ? when.toLowerCase() : when}${ctx.time ? ` ${ctx.time}` : ''}`;
  const who = next.members.map(ctx.name).join(' and ');
  return [{ b: 'Next:' }, ` ${at}${who ? `, ${who}` : ''} · ${days.length} in the next two weeks`];
}

/** [NFR-18] Last 7 days' folded line: how many done, missed and skipped (D-120). */
export function lastWeekLine(days: { occurrences: { status: string }[] }[], kind: Kind): Words {
  const all = days.flatMap((d) => d.occurrences);
  if (all.length === 0) return ['Nothing was due'];
  const done = all.filter((o) => DONE.has(o.status)).length;
  const missed = all.filter(
    (o) => o.status === 'missed' || (kind === 'task' && o.status === 'scheduled'),
  ).length;
  const skipped = all.filter((o) => o.status === 'skipped').length;
  const rest: string[] = [];
  if (missed) rest.push(`${missed} ${kind === 'task' ? 'left open' : 'missed'}`);
  if (skipped) rest.push(`${skipped} skipped`);
  return [{ b: `${done} done` }, ...(rest.length ? [` · ${rest.join(' · ')}`] : [])];
}
