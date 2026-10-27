import { relativeDay } from './chores';
import { isoDay } from './format';
import type { FoldLine } from './setup-facts';

/**
 * [PTS-08] The household points register (WP-115, D-147): every points ledger entry for every child in
 * one list, filtered by child, type, bonus rule and dates, as `points_register()` reads it through RLS.
 * A type is the ledger's own, but a bonus a goal paid is a Goal payout, apart from a rule's Bonus.
 */
export type RegisterKind =
  'earn' | 'bonus' | 'goal' | 'adjustment' | 'spend' | 'refund' | 'reversal';

/** The types in the order the filter shows them, with their words (the approved mockup's). */
export const REGISTER_KINDS: { kind: RegisterKind; label: string }[] = [
  { kind: 'earn', label: 'Earned' },
  { kind: 'bonus', label: 'Bonus' },
  { kind: 'goal', label: 'Goal payout' },
  { kind: 'adjustment', label: 'By hand' },
  { kind: 'spend', label: 'Spent' },
  { kind: 'refund', label: 'Refunded' },
  { kind: 'reversal', label: 'Reversed' },
];

export const KIND_LABEL = Object.fromEntries(
  REGISTER_KINDS.map((k) => [k.kind, k.label]),
) as Record<RegisterKind, string>;

/** How many entries the register shows at first, and how many more each Show older adds. */
export const REGISTER_PAGE = 50;

/** The database answers at most this many rows a call (`max_rows`), so a long list is read in parts. */
export const READ_CHUNK = 1000;

/** The furthest Show older goes in one address: 200 taps, 10,050 entries. */
const MAX_OLDER = 200;

export interface RegisterEntry {
  id: string;
  memberId: string;
  kind: RegisterKind;
  /** Signed. */
  amount: number;
  /** When it was posted (ISO timestamp). */
  at: string;
  /** The ledger's reason: an adjustment's, a bonus's, a reward's title. */
  reason: string | null;
  /** True when it is for an item (an earn, or its reversal). */
  forItem: boolean;
  /** The item's title, or null when this parent may not see the item (D-34). */
  itemTitle: string | null;
  goalId: string | null;
  goalTitle: string | null;
  /** The bonus rule that paid it. */
  ruleId: string | null;
  byType: 'system' | 'admin' | 'device';
  /** The parent who posted it (their user id). */
  by: string | null;
}

export interface RegisterFilters {
  /** Member ids; none is everyone. */
  who: string[];
  /** Types; none is any. */
  types: RegisterKind[];
  /** One bonus rule's payouts. */
  rule: string | null;
  /** The household's own days, "YYYY-MM-DD", both ends included. */
  from: string | null;
  to: string | null;
  /** How many times Show older was tapped. */
  older: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Query = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const list = (v: string | string[] | undefined) =>
  first(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const realDate = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return ISO_DATE.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
    ? s
    : null;
};

/**
 * [PTS-08] The register's address as filters. Anything not valid is left out, so an old or mistyped
 * link still opens the register; dates the wrong way round are swapped.
 */
export function parseRegisterQuery(q: Query): RegisterFilters {
  const who = [...new Set(list(q.who).filter((id) => UUID.test(id)))];
  const types = REGISTER_KINDS.map((k) => k.kind).filter((k) => list(q.type).includes(k));
  const rule = UUID.test(first(q.rule)) ? first(q.rule) : null;
  let from = realDate(first(q.from));
  let to = realDate(first(q.to));
  if (from && to && from > to) [from, to] = [to, from];
  const n = Number(first(q.older));
  const older = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_OLDER) : 0;
  return { who, types, rule, from, to, older };
}

/** Where the register is. */
export const REGISTER_PATH = '/admin/rewards/points';

/** [PTS-08] The register's address for these filters; the defaults are left out. */
export function registerHref(f: Partial<RegisterFilters> = {}, base = REGISTER_PATH): string {
  const p = new URLSearchParams();
  if (f.who?.length) p.set('who', f.who.join(','));
  if (f.types?.length) p.set('type', f.types.join(','));
  if (f.rule) p.set('rule', f.rule);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.older) p.set('older', String(f.older));
  const s = p.toString();
  return `${base}${s ? `?${s.replace(/%2C/g, ',')}` : ''}`;
}

/** A filter change starts the list from the newest again. */
export function toggleWho(f: RegisterFilters, id: string): RegisterFilters {
  const who = f.who.includes(id) ? f.who.filter((w) => w !== id) : [...f.who, id];
  return { ...f, who, older: 0 };
}

export function toggleType(f: RegisterFilters, kind: RegisterKind): RegisterFilters {
  const types = f.types.includes(kind) ? f.types.filter((t) => t !== kind) : [...f.types, kind];
  return {
    ...f,
    types: REGISTER_KINDS.map((k) => k.kind).filter((k) => types.includes(k)),
    older: 0,
  };
}

/** How many entries this address shows: the first 50, and 50 more for each Show older. */
export function shownCount(f: Pick<RegisterFilters, 'older'>): number {
  return REGISTER_PAGE * (f.older + 1);
}

/**
 * [PTS-08] The parts of a list longer than a call may answer: offsets and sizes, in order, for the
 * first `count` entries.
 */
export function readParts(count: number, chunk = READ_CHUNK): { offset: number; limit: number }[] {
  const parts: { offset: number; limit: number }[] = [];
  for (let offset = 0; offset < count; offset += chunk) {
    parts.push({ offset, limit: Math.min(chunk, count - offset) });
  }
  return parts;
}

/**
 * [PTS-08] One entry in words: what it was for, and who or what issued it where the ledger knows. An
 * earn on an item this parent may not see stays "A private item" (D-34).
 */
export function entryWords(
  e: RegisterEntry,
  adminName: (userId: string) => string,
): { what: string; by: string } {
  const item = e.itemTitle ?? 'A private item';
  const parent = e.byType === 'admin' && e.by ? adminName(e.by) : null;
  switch (e.kind) {
    case 'earn':
      return { what: item, by: 'done' };
    case 'reversal':
      if (e.goalId) return { what: e.goalTitle ?? 'A goal', by: 'goal taken back' };
      if (e.forItem) return { what: item, by: 'unchecked' };
      return { what: e.reason ?? 'Reversed', by: parent ? `by ${parent}` : '' };
    case 'bonus':
      return {
        what: e.reason ?? 'Bonus',
        by: parent ? `by ${parent}` : e.byType === 'system' ? 'paid automatically' : '',
      };
    case 'goal':
      return {
        what: `Reached ${e.goalTitle ?? e.reason ?? 'a goal'}`,
        by: `goal ${e.goalTitle ?? e.reason ?? ''}`.trim(),
      };
    case 'adjustment':
      return { what: e.reason ?? 'Adjusted', by: `by ${parent ?? 'a parent'}` };
    case 'spend':
      return { what: e.reason ?? 'A reward', by: parent ? `approved by ${parent}` : '' };
    case 'refund':
      return { what: e.reason ?? 'A reward', by: parent ? `cancelled by ${parent}` : 'cancelled' };
  }
}

/**
 * [PTS-08] Entries under day headings in the household's own days, newest first as they come:
 * "Today", "Yesterday", "Sun, Oct 25".
 */
export function byDay<T extends { at: string }>(
  entries: T[],
  timeZone: string,
  today: string,
): { day: string; heading: string; entries: T[] }[] {
  const groups: { day: string; heading: string; entries: T[] }[] = [];
  for (const e of entries) {
    const day = isoDay(timeZone, new Date(e.at));
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(e);
    else groups.push({ day, heading: relativeDay(day, today), entries: [e] });
  }
  return groups;
}

export interface MemberTotal {
  memberId: string;
  entries: number;
  /** What the entries added, and took away (negative). */
  added: number;
  taken: number;
  latest: string;
}

const n = (x: number) => x.toLocaleString('en-US');
const plusMinus = (x: number) => (x < 0 ? `−${n(-x)}` : `+${n(x)}`);
const times = (k: number) => (k === 1 ? 'once' : k === 2 ? 'twice' : `${n(k)} times`);
const lower = (d: string) => (d === 'Today' || d === 'Yesterday' ? d.toLowerCase() : d);

/** [PTS-08] How many entries match, all members together. */
export function entryCount(totals: MemberTotal[]): number {
  return totals.reduce((s, t) => s + t.entries, 0);
}

/**
 * [PTS-08] The line over the list: how many entries match and what they add up to. Filtered to one
 * bonus, how many times it paid, how much, to whom, and the latest.
 */
export function totalLine(
  totals: MemberTotal[],
  o: { rule: boolean; name: (id: string) => string; timeZone: string; today: string },
): FoldLine {
  const count = entryCount(totals);
  const added = totals.reduce((s, t) => s + t.added, 0);
  const taken = totals.reduce((s, t) => s + t.taken, 0);
  if (count === 0) return [{ b: 'No entries' }];
  if (o.rule) {
    const latest = totals
      .map((t) => t.latest)
      .sort()
      .at(-1)!;
    const each = [...totals]
      .sort((a, b) => b.entries - a.entries || o.name(a.memberId).localeCompare(o.name(b.memberId)))
      .map((t, i) => `${o.name(t.memberId)} ${i === 0 ? times(t.entries) : t.entries}`);
    return [
      { b: `Paid ${times(count)}` },
      ' · ',
      { b: plusMinus(added + taken) },
      `${totals.length > 1 ? ` · ${each.join(', ')}` : ` · ${o.name(totals[0]!.memberId)}`}`,
      ` · latest ${lower(relativeDay(isoDay(o.timeZone, new Date(latest)), o.today))}`,
    ];
  }
  const parts: FoldLine = [{ b: `${n(count)} ${count === 1 ? 'entry' : 'entries'}` }];
  if (added) parts.push(` · ${plusMinus(added)}`);
  if (taken) parts.push(` · ${plusMinus(taken)}`);
  if (added && taken) parts.push(' · net ', { b: plusMinus(added + taken) });
  return parts;
}

/** [PTS-08] Under the list: how many it shows of how many. */
export function shownLine(shown: number, count: number): string {
  return shown < count ? `Showing the newest ${n(shown)} of ${n(count)}.` : '';
}

/** [PTS-05][PTS-08] A bonus rule's payouts, beside it on Bonus points. */
export function payoutLine(
  stat: { times: number; latest: string } | undefined,
  timeZone: string,
  today: string,
): FoldLine {
  if (!stat || stat.times === 0) return ['Not paid yet'];
  const when = lower(relativeDay(isoDay(timeZone, new Date(stat.latest)), today));
  return stat.times === 1
    ? ['Paid ', { b: 'once' }, `, ${when}`]
    : ['Paid ', { b: times(stat.times) }, `, latest ${when}`];
}

/** The link beside a bonus's payouts. */
export function seeWords(timesPaid: number): string {
  return timesPaid === 1 ? 'See it' : 'See them';
}

/** [PTS-08] The More filters fold's header line: the types and the dates chosen. */
export function moreLine(f: RegisterFilters, dateWords: (d: string) => string): FoldLine {
  const types = f.types.length ? f.types.map((k) => KIND_LABEL[k]).join(', ') : 'Any type';
  const days =
    f.from || f.to
      ? `${f.from ? dateWords(f.from) : 'the start'} to ${f.to ? dateWords(f.to) : 'today'}`
      : 'any day';
  return [{ b: types }, ` · ${days}`];
}
