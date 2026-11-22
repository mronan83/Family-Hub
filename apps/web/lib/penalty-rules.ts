/**
 * [PTS-10] Penalty rules as the app reads and asks for them (WP-121, D-154, D-157; 02 §4.2d). The
 * database saves a rule (`save_penalty_rule()`), adds a miss at day close, takes one back on a Mark
 * done on time, and records what is paid on a rule (`record_penalty_rule_paid()`); the app checks the
 * form first, so a parent gets a plain line instead of an error code, and says a rule the way the
 * approved mockup does: "Maya · Homework folder home · $1 a missed school day · max $10 · Nov 16 to
 * Jan 31".
 */
import {
  MAX_PENALTY_CENTS,
  MAX_PENALTY_POINTS,
  money,
  type Parsed,
  type PenaltyReason,
  type PenaltyUnit,
  parseAmount,
} from './penalties';

export type RuleScope = 'items' | 'tag' | 'all';

/** A chore a rule can link: its title, and whether it is due on school days only. */
export interface RuleChore {
  id: string;
  title: string;
  schoolDays: boolean;
  /** Who it is for (member ids). */
  assignees: string[];
}

export interface PenaltyRule {
  id: string;
  name: string;
  reasonId: string;
  unit: PenaltyUnit;
  /** Per miss: points, or cents. */
  amount: number;
  /** The most it has on a person: points, or cents. */
  max: number;
  scope: RuleScope;
  tagId: string | null;
  tagName: string | null;
  /** The chores it links (scope 'items'). */
  chores: RuleChore[];
  memberIds: string[];
  startDate: string;
  endDate: string;
  /** What it has on each person now: cents owed, or points it took (D-157). */
  held: Record<string, number>;
  /** [PTS-10] When a parent stopped it (Stop now), or null while it runs (D-157). */
  stoppedAt?: string | null;
  /** [PTS-10] How many misses it has ever added, taken back ones included: Remove only at 0. */
  added?: number;
}

export const MAX_RULE_NAME = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const utc = (day: string) => new Date(`${day}T12:00:00Z`);

/** "Nov 16". */
export function monthDay(day: string): string {
  const d = utc(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Days from a to b (b − a), on calendar dates. */
function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
}

/** "Tue", "Tue and Wed", "Mon, Tue and Wed"; a day more than 6 days back is "Nov 9". */
export function missedDays(days: string[], today: string): string {
  const words = [...new Set(days)].sort().map((d) => {
    const back = daysBetween(d, today);
    return back >= 1 && back <= 6 ? DAYS[utc(d).getUTCDay()]! : monthDay(d);
  });
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** An amount in a rule's unit: "$1", "5 points". */
export function ruleAmount(unit: PenaltyUnit, amount: number): string {
  return unit === 'money' ? money(amount) : `${amount} ${amount === 1 ? 'point' : 'points'}`;
}

/** "$1 a missed school day" when every chore it links is a school-day one, else "5 points a miss". */
export function perMiss(rule: Pick<PenaltyRule, 'unit' | 'amount' | 'scope' | 'chores'>): string {
  const schoolDay =
    rule.scope === 'items' && rule.chores.length > 0 && rule.chores.every((c) => c.schoolDays);
  return `${ruleAmount(rule.unit, rule.amount)} ${schoolDay ? 'a missed school day' : 'a miss'}`;
}

/** What counts: the chores' titles, "tag Bedtime", or "all their items". */
export function ruleCounts(rule: Pick<PenaltyRule, 'scope' | 'chores' | 'tagName'>): string {
  if (rule.scope === 'tag') return `tag ${rule.tagName ?? 'a tag'}`;
  if (rule.scope === 'all') return 'all their items';
  return rule.chores.map((c) => c.title).join(', ') || 'no items';
}

/** "Maya · Homework folder home · $1 a missed school day · max $10 · Nov 16 to Jan 31". */
export function ruleLine(rule: PenaltyRule, name: (memberId: string) => string): string {
  return [
    rule.memberIds.map(name).join(', '),
    ruleCounts(rule),
    perMiss(rule),
    `max ${ruleAmount(rule.unit, rule.max)}`,
    `${monthDay(rule.startDate)} to ${monthDay(rule.endDate)}`,
  ].join(' · ');
}

/**
 * What a rule has on each of its people: "Maya owes $2"; "Leo: 10 of 25 points taken"; with nothing,
 * "Nothing owed".
 */
export function ruleStatus(rule: PenaltyRule, name: (memberId: string) => string): string {
  const parts = rule.memberIds
    .filter((id) => (rule.held[id] ?? 0) > 0)
    .map((id) =>
      rule.unit === 'money'
        ? `${name(id)} owes ${money(rule.held[id]!)}`
        : `${name(id)}: ${rule.held[id]} of ${rule.max} points taken`,
    );
  return parts.length ? parts.join(' · ') : 'Nothing owed';
}

/** What a rule form sends to save_penalty_rule(). */
export interface RuleInput {
  id: string | null;
  name: string;
  reasonId: string;
  memberIds: string[];
  scope: RuleScope;
  choreIds: string[];
  tagId: string | null;
  startDate: string;
  endDate: string;
  amount: number;
  max: number;
}

const realDate = (s: string) =>
  ISO_DATE.test(s) && !Number.isNaN(utc(s).getTime()) && utc(s).toISOString().slice(0, 10) === s;

/**
 * [PTS-10][US-1112] The rule form, checked the way save_penalty_rule() will check it: a name, a
 * reason from the list (it sets the unit), who, what counts, the dates (a new rule starts today or
 * later), the amount per miss and the max, no less than the amount.
 */
export function parseRule(
  form: FormData,
  reasons: PenaltyReason[],
  today: string,
  keptStart: string | null = null,
): Parsed<RuleInput> {
  const idRaw = String(form.get('ruleId') ?? '');
  const id = idRaw ? idRaw : null;
  if (id && !UUID.test(id))
    return {
      ok: false,
      message: 'Something went wrong with this form. Reload the page and try again.',
    };
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 1 || name.length > MAX_RULE_NAME) {
    return { ok: false, message: `Name the rule, in up to ${MAX_RULE_NAME} characters.` };
  }
  const reason = reasons.find((r) => r.id === String(form.get('reasonId') ?? ''));
  if (!reason) return { ok: false, message: 'Choose a reason from the list.' };
  const memberIds = [...new Set(form.getAll('memberId').map(String))].filter((x) => UUID.test(x));
  if (memberIds.length === 0) return { ok: false, message: 'Choose who the rule is for.' };
  const scope = String(form.get('scope') ?? '');
  if (scope !== 'items' && scope !== 'tag' && scope !== 'all') {
    return { ok: false, message: 'Choose what counts as a miss.' };
  }
  const choreIds = [...new Set(form.getAll('choreId').map(String))].filter((x) => UUID.test(x));
  if (scope === 'items' && choreIds.length === 0) {
    return { ok: false, message: 'Choose at least one item.' };
  }
  const tagId = String(form.get('tagId') ?? '');
  if (scope === 'tag' && !UUID.test(tagId)) return { ok: false, message: 'Choose a tag.' };
  const startDate = String(form.get('startDate') ?? '');
  const endDate = String(form.get('endDate') ?? '');
  if (!realDate(startDate) || !realDate(endDate)) {
    return { ok: false, message: 'Choose a start and an end date.' };
  }
  if (endDate < startDate) return { ok: false, message: 'The end date can’t be before the start.' };
  if (startDate < today && startDate !== keptStart) {
    return { ok: false, message: 'A rule starts today or later.' };
  }
  const amount = parseAmount(reason.unit, String(form.get('amount') ?? ''));
  const cap = reason.unit === 'money' ? MAX_PENALTY_CENTS : MAX_PENALTY_POINTS;
  if (amount === null) {
    return {
      ok: false,
      message:
        reason.unit === 'money'
          ? `Enter an amount per miss from $0.01 to ${money(cap)}.`
          : `Enter a whole number of points per miss from 1 to ${cap.toLocaleString('en-US')}.`,
    };
  }
  const max = parseAmount(reason.unit, String(form.get('max') ?? ''));
  if (max === null || max < amount) {
    return { ok: false, message: 'Enter a max owed no less than each miss adds.' };
  }
  return {
    ok: true,
    value: {
      id,
      name,
      reasonId: reason.id,
      memberIds,
      scope,
      choreIds: scope === 'items' ? choreIds : [],
      tagId: scope === 'tag' ? tagId : null,
      startDate,
      endDate,
      amount,
      max,
    },
  };
}

/** The rule as save_penalty_rule() reads it. */
export function ruleArgs(r: RuleInput): Record<string, unknown> {
  return {
    ...(r.id ? { id: r.id } : {}),
    name: r.name,
    reason_id: r.reasonId,
    member_ids: r.memberIds,
    scope: r.scope,
    chore_ids: r.choreIds,
    ...(r.tagId ? { tag_id: r.tagId } : {}),
    start_date: r.startDate,
    end_date: r.endDate,
    amount: r.amount,
    max_amount: r.max,
  };
}

/** What save_penalty_rule() and record_penalty_rule_paid() refused, in plain words. */
export function ruleMessage(error: { code?: string; hint?: string | null }): string {
  switch (error.hint) {
    case 'penalties_off':
      return 'Penalties are off. Turn them on above first.';
    case 'bad_name':
      return `Name the rule, in up to ${MAX_RULE_NAME} characters.`;
    case 'bad_reason':
      return 'That reason was removed. Choose one from the list.';
    case 'bad_people':
      return 'Choose people who earn rewards.';
    case 'bad_scope':
      return 'Choose what counts as a miss.';
    case 'bad_items':
      return 'Choose items of this family. A task is never missed, so only chores count.';
    case 'bad_tag':
      return 'Choose a tag of this family.';
    case 'bad_dates':
      return 'The end date can’t be before the start.';
    case 'start_past':
      return 'A rule starts today or later.';
    case 'bad_amount':
      return 'Enter an amount from 1, and no more than is owed.';
    case 'bad_max':
      return 'Enter a max owed no less than each miss adds.';
    case 'unit_changed':
      return 'A rule keeps points or money. Choose a reason in the same one, or add a new rule.';
    case 'not_money':
      return 'A points penalty is settled when it’s taken; there’s nothing to pay.';
    case 'request_reused':
      return 'That form was already used. Reload the page to make another change.';
    case 'rule_stopped':
      return 'This rule was stopped, so it can’t be changed. Add a new rule instead.';
    case 'rule_used':
      return 'This rule has added misses, so it can’t be removed. Stop it instead.';
  }
  if (error.code === '42501') return 'Only a parent of this household can do that.';
  return 'Nothing was changed. Try again in a moment.';
}

/** [PTS-10] "Stopped Nov 21", from when a parent stopped it, in the household's time zone. */
export function stoppedWords(stoppedAt: string, timezone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(stoppedAt));
  return `Stopped ${monthDay(day)}`;
}

/** A rule's misses on one person, for their page: what is owed on it and the days still owed. */
export interface RuleOwing {
  ruleId: string;
  name: string;
  /** Cents. */
  owed: number;
  missed: string[];
}

/** [PTS-10] Groups a person's money rule misses still owed, by rule, oldest first. */
export function ruleOwing(
  penalties: {
    ruleId: string | null;
    reason: string;
    owed: number;
    missedOn: string | null;
    givenAt: string;
  }[],
): RuleOwing[] {
  const by = new Map<string, RuleOwing & { first: string }>();
  for (const p of [...penalties].sort((a, b) => (a.givenAt < b.givenAt ? -1 : 1))) {
    if (!p.ruleId || p.owed <= 0) continue;
    const g = by.get(p.ruleId) ?? {
      ruleId: p.ruleId,
      name: p.reason,
      owed: 0,
      missed: [],
      first: p.givenAt,
    };
    g.owed += p.owed;
    g.name = p.reason;
    if (p.missedOn && !g.missed.includes(p.missedOn)) g.missed.push(p.missedOn);
    by.set(p.ruleId, g);
  }
  return [...by.values()]
    .sort((a, b) => (a.first < b.first ? -1 : 1))
    .map((g) => ({ ruleId: g.ruleId, name: g.name, owed: g.owed, missed: g.missed.sort() }));
}

/** The board's line for a rule's misses: "Folder home: missed Tue and Wed". */
export function owedLine(
  o: { reason: string; rule?: boolean; missed?: string[] | null },
  today: string,
): string {
  return o.rule && o.missed && o.missed.length > 0
    ? `${o.reason}: missed ${missedDays(o.missed, today)}`
    : o.reason;
}
