import { itemKey } from './grocery-merge';

/**
 * [MEAL-21][US-716] Staples by how often they run out (WP-106, D-138 (7), D-150). From the ticks in
 * each thing's history FamilyWise learns its usual gap; a thing due again and not on the list is
 * suggested under Running low? on Groceries, and Home's card says how many. Nothing is added by
 * itself. All the day maths is on the household's calendar dates ("YYYY-MM-DD"), never on the clock.
 */

/** A thing needs this many buys before it can be suggested. */
export const MIN_BUYS = 4;
/** The gap is worked out from the gaps between this many latest buys. */
export const LAST_BUYS = 8;
/** It stops being suggested once this many gaps pass with no buy. */
export const STOP_AFTER_GAPS = 3;

/**
 * A thing's buys, as `grocery_buys()` reads them from its history (D-150): a tick is a buy, at a
 * board too; an untick takes it back; one a household day; a removal never.
 */
export interface Bought {
  /** Its merge key (capitals, plural and amount set aside), and the name at its latest buy. */
  key: string;
  name: string;
  /** How many buys, and the days of the latest 8, oldest first ("YYYY-MM-DD"). */
  buys: number;
  days: string[];
}

/** Days from one calendar date to another ("2026-10-09" → "2026-10-18" is 9), DST or not. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A calendar date plus some days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export type Learned =
  | { state: 'learning'; buys: number }
  | { state: 'irregular'; buys: number }
  | { state: 'learned'; buys: number; gap: number; last: string };

/**
 * [MEAL-21] What a thing's buys teach (D-138 (7), D-150): with fewer than 4 buys it is still being
 * learned. Its gap is the median of the gaps between its last 8 buys, to the nearest day; the gaps
 * must be steady, the middle half of them (a quarter dropped at each end) spanning no more than half
 * the median. Otherwise it was bought at no set gap and is never suggested.
 */
export function learn(days: readonly string[], buys: number = days.length): Learned {
  if (buys < MIN_BUYS) return { state: 'learning', buys };
  const last8 = days.slice(-LAST_BUYS);
  const gaps = last8.slice(1).map((d, i) => daysBetween(last8[i]!, d));
  const mid = median(gaps);
  const sorted = [...gaps].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length / 4);
  const middle = sorted.slice(cut, sorted.length - cut);
  if (mid < 1 || middle.at(-1)! - middle[0]! > mid / 2) return { state: 'irregular', buys };
  return { state: 'learned', buys, gap: Math.round(mid), last: days.at(-1)! };
}

/** [MEAL-21] Due a day before the gap is up; two days before for a gap over a week (D-138 (7)). */
export function dueDay(last: string, gap: number): string {
  return addDays(last, gap - (gap > 7 ? 2 : 1));
}

/** [MEAL-21] "every 5 days", "every week", "every 2 weeks": a gap as Groceries says it. */
export function gapWords(gap: number): string {
  if (gap === 1) return 'every day';
  if (gap === 7) return 'every week';
  if (gap < 14) return `every ${gap} days`;
  return `every ${Math.round(gap / 7)} weeks`;
}

/** The household's choice for a thing (`grocery_staple`): Not now until a day, or Don't suggest. */
export interface StapleChoice {
  key: string;
  /** Not now: hidden until this day (D-150: one more gap). */
  notNowUntil: string | null;
  /** Don't suggest: when it was chosen; none while suggested. */
  offAt: string | null;
}

export type StapleStatus =
  | { kind: 'on-list' }
  | { kind: 'asked' }
  | { kind: 'running-low'; due: string }
  | { kind: 'due'; due: string }
  | { kind: 'not-now'; until: string }
  | { kind: 'stopped' };

export interface Staple {
  key: string;
  name: string;
  gap: number;
  last: string;
  status: StapleStatus;
}

export interface StaplesView {
  /** Running low?: due, not on the list, not asked for, not Not now, most overdue first. */
  runningLow: Staple[];
  /** Every thing learned, A to Z, with its status; those turned off are in `off` instead. */
  learned: Staple[];
  /** Still learning: fewer than 4 buys, or bought at no set gap; most bought first. */
  learning: { key: string; name: string; buys: number; irregular: boolean }[];
  /** Don't suggest: until Suggest again. */
  off: { key: string; name: string; offAt: string }[];
}

/**
 * [MEAL-21] Every thing's state on a day. `open` and `asked` are the merge keys open on the list and
 * of the asks waiting for a grown-up (a waiting ask holds its thing back, D-150 Q4). A thing is
 * running low once its due day has come, until 3 gaps pass with no buy (stopped; its next buy starts
 * it again). Not now hides it until its day; Don't suggest until Suggest again.
 */
export function staples(
  bought: readonly Bought[],
  choices: readonly StapleChoice[],
  today: string,
  open: ReadonlySet<string>,
  asked: ReadonlySet<string> = new Set(),
): StaplesView {
  const choiceOf = new Map(choices.map((c) => [c.key, c]));
  const out: StaplesView = { runningLow: [], learned: [], learning: [], off: [] };
  for (const b of bought) {
    const l = learn(b.days, b.buys);
    const choice = choiceOf.get(b.key);
    if (choice?.offAt) {
      out.off.push({ key: b.key, name: b.name, offAt: choice.offAt });
      continue;
    }
    if (l.state !== 'learned') {
      out.learning.push({
        key: b.key,
        name: b.name,
        buys: l.buys,
        irregular: l.state === 'irregular',
      });
      continue;
    }
    const due = dueDay(l.last, l.gap);
    const status: StapleStatus = open.has(b.key)
      ? { kind: 'on-list' }
      : asked.has(b.key)
        ? { kind: 'asked' }
        : daysBetween(l.last, today) >= STOP_AFTER_GAPS * l.gap
          ? { kind: 'stopped' }
          : today < due
            ? { kind: 'due', due }
            : choice?.notNowUntil && today < choice.notNowUntil
              ? { kind: 'not-now', until: choice.notNowUntil }
              : { kind: 'running-low', due };
    const s: Staple = { key: b.key, name: b.name, gap: l.gap, last: l.last, status };
    out.learned.push(s);
    if (status.kind === 'running-low') out.runningLow.push(s);
  }
  const az = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  out.learned.sort(az);
  out.off.sort(az);
  out.learning.sort((a, b) => b.buys - a.buys || az(a, b));
  out.runningLow.sort((a, b) => {
    const da = a.status.kind === 'running-low' ? a.status.due : '';
    const db = b.status.kind === 'running-low' ? b.status.due : '';
    return da.localeCompare(db) || az(a, b);
  });
  return out;
}

/** [MEAL-21] Not now hides a thing until one more gap has passed, from today (D-138 (7)). */
export function notNowUntil(today: string, gap: number): string {
  return addDays(today, gap);
}

/** [MEAL-21] Home's Groceries card: "3 running low", or nothing when none is due (D-150 Q2). */
export function runningLowLine(n: number): string | null {
  return n > 0 ? `${n} running low` : null;
}

/** [MEAL-21] Staples' fold while closed: "8 learned · 23 still learning · 1 not suggested". */
export function staplesSummary(v: StaplesView): string {
  const parts = [`${v.learned.length} learned`, `${v.learning.length} still learning`];
  if (v.off.length) parts.push(`${v.off.length} not suggested`);
  return parts.join(' · ');
}

const dayFormat = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
/** "Fri, Oct 9" for "2026-10-09". */
export const shortDay = (iso: string) =>
  dayFormat(iso, { weekday: 'short', month: 'short', day: 'numeric' });
/** "Oct 29" for "2026-10-29". */
export const monthDay = (iso: string) => dayFormat(iso, { month: 'short', day: 'numeric' });

/** [MEAL-21] A Running low? row's second line: "Usually every 9 days · last got Fri, Oct 9 · Kroger". */
export function runningLowWords(s: Pick<Staple, 'gap' | 'last'>, store: string | null): string {
  return [`Usually ${gapWords(s.gap)}`, `last got ${shortDay(s.last)}`, store]
    .filter(Boolean)
    .join(' · ');
}

/** [MEAL-21] A learned staple's state in Staples: "On the list", "Due Oct 29", … */
export function statusWords(s: Pick<Staple, 'status' | 'last'>): string {
  const st = s.status;
  switch (st.kind) {
    case 'on-list':
      return 'On the list';
    case 'asked':
      return 'Asked for';
    case 'running-low':
      return 'Running low';
    case 'due':
      return `Due ${monthDay(st.due)}`;
    case 'not-now':
      return `Not now, until ${monthDay(st.until)}`;
    case 'stopped':
      return `Not got since ${monthDay(s.last)}, so not suggested`;
  }
}

/**
 * [MEAL-21] How many staples are running low for Home's line (D-150 Q2), from Groceries' data: its
 * open items and waiting asks hold their things back.
 */
export function runningLowCount(
  data: {
    items: readonly { name: string; status: string }[];
    asks?: readonly { name: string }[];
    bought?: readonly Bought[];
    stapleChoices?: readonly StapleChoice[];
  },
  today: string,
): number {
  return staples(
    data.bought ?? [],
    data.stapleChoices ?? [],
    today,
    new Set(data.items.filter((i) => i.status === 'open').map((i) => itemKey(i.name))),
    new Set((data.asks ?? []).map((a) => itemKey(a.name))),
  ).runningLow.length;
}
