/**
 * [PTS-09] Penalties as the app reads and asks for them (WP-120, D-154, D-156; 02 §4.2c). The
 * database gives, takes back and records payments (`give_penalty()`, `take_back_penalty()`,
 * `record_penalty_paid()`); the app checks the forms first, so a parent gets a plain line instead of
 * an error code, and says amounts the way people do. Money is kept in cents.
 */

export type PenaltyUnit = 'points' | 'money';

/** A household's penalty reason: what a parent picks from, with its default amount. */
export interface PenaltyReason {
  id: string;
  name: string;
  unit: PenaltyUnit;
  /** Points, or cents. */
  amount: number;
}

/** A penalty a parent gave, with what is still owed on it. */
export interface Penalty {
  id: string;
  memberId: string;
  reason: string;
  unit: PenaltyUnit;
  /** Points, or cents. */
  amount: number;
  givenAt: string;
  /** The parent who gave it; null for a rule's miss (the system, WP-121). */
  givenBy: string | null;
  takenBackAt: string | null;
  takenBackBy: string | null;
  /** [PTS-10] The rule that added it, and the day missed (WP-121); null for a one-time penalty. */
  ruleId?: string | null;
  missedOn?: string | null;
  /** [PTS-10] Taken back by a parent's Mark done on time (D-157). */
  takenBackOnTime?: boolean;
  /** Cents still owed: a money penalty not taken back, less what was paid. Points: 0 (D-156). */
  owed: number;
}

/** Money paid outside FamilyWise, recorded against one penalty. */
export interface PenaltyPayment {
  id: string;
  penaltyId: string;
  /** Cents. */
  amount: number;
  recordedAt: string;
  recordedBy: string;
}

/** The most a penalty can be: 10,000 points, or $1,000. */
export const MAX_PENALTY_POINTS = 10_000;
export const MAX_PENALTY_CENTS = 100_000;
export const MAX_REASON_NAME = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BROKEN = 'Something went wrong with this form. Reload the page and try again.';

/** "$1", "$2.50", "$1,000" (D-156: dollars). */
export function money(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const dollars = whole.toLocaleString('en-US');
  return `${cents < 0 ? '−' : ''}$${dollars}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** An amount in its unit: "10 points", "1 point", "$1.50". */
export function penaltyAmount(unit: PenaltyUnit, amount: number): string {
  if (unit === 'money') return money(amount);
  return `${amount} ${amount === 1 ? 'point' : 'points'}`;
}

/** What a parent typed for a money amount, in cents: "1", "1.5", "$1.50" → 100, 150, 150; else NaN. */
export function parseMoney(text: string): number {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** An amount as the form fills it in: "10" for points, "1" or "2.50" for money. */
export function amountInput(unit: PenaltyUnit, amount: number): string {
  if (unit === 'points') return String(amount);
  return amount % 100 ? (amount / 100).toFixed(2) : String(amount / 100);
}

/** An amount a parent typed, in its unit (points, or cents), checked; null when it isn't one. */
export function parseAmount(unit: PenaltyUnit, text: string): number | null {
  const n = unit === 'money' ? parseMoney(text) : /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  const max = unit === 'money' ? MAX_PENALTY_CENTS : MAX_PENALTY_POINTS;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function amountHelp(unit: PenaltyUnit): string {
  return unit === 'money'
    ? `Enter an amount from $0.01 to ${money(MAX_PENALTY_CENTS)}.`
    : `Enter a whole number of points from 1 to ${MAX_PENALTY_POINTS.toLocaleString('en-US')}.`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface GivePenaltyInput {
  memberId: string;
  reasonId: string;
  /** Points, or cents. */
  amount: number;
  requestId: string;
}

/**
 * [PTS-09][US-1111] The Give a penalty form, checked the way give_penalty() will check it: who, a
 * reason from the household's list, and its amount (filled in from the reason, and changeable).
 */
export function parseGivePenalty(
  form: FormData,
  reasons: PenaltyReason[],
): Parsed<GivePenaltyInput> {
  const memberId = String(form.get('memberId') ?? '');
  const requestId = String(form.get('requestId') ?? '');
  if (!UUID.test(requestId)) return { ok: false, message: BROKEN };
  if (!UUID.test(memberId)) return { ok: false, message: 'Choose who the penalty is for.' };
  const reason = reasons.find((r) => r.id === String(form.get('reasonId') ?? ''));
  if (!reason) return { ok: false, message: 'Choose a reason from the list.' };
  const amount = parseAmount(reason.unit, String(form.get('amount') ?? ''));
  if (amount === null) return { ok: false, message: amountHelp(reason.unit) };
  return { ok: true, value: { memberId, reasonId: reason.id, amount, requestId } };
}

export interface PaidInput {
  penaltyId: string;
  /** Cents. */
  amount: number;
  requestId: string;
}

/**
 * [PTS-09][US-1111] Record paid: from $0.01 up to what is owed on the penalty (D-156 (4)), or on a
 * rule's misses (`field` 'ruleId', WP-121).
 */
export function parsePaid(form: FormData, owed: number, field = 'penaltyId'): Parsed<PaidInput> {
  const penaltyId = String(form.get(field) ?? '');
  const requestId = String(form.get('requestId') ?? '');
  if (!UUID.test(penaltyId) || !UUID.test(requestId)) return { ok: false, message: BROKEN };
  const amount = parseMoney(String(form.get('amount') ?? ''));
  if (!Number.isInteger(amount) || amount < 1 || amount > owed) {
    return { ok: false, message: `Enter an amount from $0.01 to ${money(owed)}, what is owed.` };
  }
  return { ok: true, value: { penaltyId, amount, requestId } };
}

export interface ReasonInput {
  name: string;
  unit: PenaltyUnit;
  amount: number;
}

/** [PTS-09] A new penalty reason: a name, points or money, and its amount. */
export function parseReason(form: FormData): Parsed<ReasonInput> {
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 1 || name.length > MAX_REASON_NAME) {
    return { ok: false, message: `Name the reason, in up to ${MAX_REASON_NAME} characters.` };
  }
  const unit = form.get('unit');
  if (unit !== 'points' && unit !== 'money')
    return { ok: false, message: 'Choose points or money.' };
  const amount = parseAmount(unit, String(form.get('amount') ?? ''));
  if (amount === null) return { ok: false, message: amountHelp(unit) };
  return { ok: true, value: { name, unit, amount } };
}

/** What the penalty functions refused, in plain words. */
export function penaltyMessage(
  error: { code?: string; hint?: string | null },
  name = 'They',
): string {
  switch (error.hint) {
    case 'penalties_off':
      return 'Penalties are off. Turn them on in Settings, Penalties.';
    case 'not_earning':
      return `${name} doesn’t earn rewards, so they can’t be given a penalty.`;
    case 'member_archived':
      return `${name} is archived. Restore them from Members first.`;
    case 'bad_reason':
      return 'That reason was removed. Choose one from the list.';
    case 'bad_amount':
      return 'Enter an amount from 1, and no more than is owed.';
    case 'bad_name':
      return `Name the reason, in up to ${MAX_REASON_NAME} characters.`;
    case 'duplicate_name':
      return 'There’s already a reason of that name.';
    case 'not_money':
      return 'A points penalty is settled when it’s taken; there’s nothing to pay.';
    case 'request_reused':
      return 'That form was already used. Reload the page to make another change.';
  }
  if (error.code === '42501') return 'Only a parent of this household can do that.';
  return 'Nothing was changed. Try again in a moment.';
}

/** [PTS-09] Each penalty's owed, from its amount and its payments. */
export function withOwed(rows: Omit<Penalty, 'owed'>[], payments: PenaltyPayment[]): Penalty[] {
  return rows.map((p) => {
    const paid = payments.filter((x) => x.penaltyId === p.id).reduce((t, x) => t + x.amount, 0);
    return { ...p, owed: p.unit === 'money' && !p.takenBackAt ? Math.max(0, p.amount - paid) : 0 };
  });
}

/** What someone owes in all, in cents. */
export function owedTotal(penalties: { owed: number }[]): number {
  return penalties.reduce((t, p) => t + p.owed, 0);
}

/** One line of a person's penalty history, newest first: a penalty, its take-back, a payment. */
export interface PenaltyEvent {
  key: string;
  at: string;
  /** "Rude to a sibling", "Left bike in the driveway, taken back", "Paid". */
  what: string;
  /** The tag beside it. */
  tag: 'Penalty' | 'Taken back' | 'Paid' | 'Rule';
  /** Who did it (a user id); null for a rule's miss, which nobody gave. */
  by: string | null;
  /** [PTS-10] The day a rule's miss was for (YYYY-MM-DD), shown in place of when it was added. */
  day?: string | null;
  /** "−10 pts", "+$1 owed", "−$2 owed". */
  amount: string;
  /** The penalty a Take back would take back, while it can be. */
  takeBack: string | null;
}

export function penaltyHistory(penalties: Penalty[], payments: PenaltyPayment[]): PenaltyEvent[] {
  const events: PenaltyEvent[] = [];
  for (const p of penalties) {
    // [PTS-10] A rule's miss (WP-121): "Folder home, missed", tagged Rule, on the day it was for, with
    // Take back; a Mark done on time or a Take back that took it back (D-157).
    if (p.ruleId) {
      events.push({
        key: `${p.id}:given`,
        at: p.givenAt,
        what: `${p.reason}, missed`,
        tag: 'Rule',
        by: null,
        day: p.missedOn ?? null,
        amount: p.unit === 'points' ? `−${p.amount} pts` : `+${money(p.amount)} owed`,
        // A parent may take a rule's miss back too (the owner, 21 November; D-157).
        takeBack: p.takenBackAt ? null : p.id,
      });
      if (p.takenBackAt) {
        events.push({
          key: `${p.id}:back`,
          at: p.takenBackAt,
          what: `${p.reason}, ${p.takenBackOnTime ? 'marked on time' : 'taken back'}`,
          tag: 'Taken back',
          by: p.takenBackBy,
          day: p.missedOn ?? null,
          amount: p.unit === 'points' ? `+${p.amount} pts` : `−${money(p.amount)} owed`,
          takeBack: null,
        });
      }
      continue;
    }
    events.push({
      key: `${p.id}:given`,
      at: p.givenAt,
      what: p.reason,
      tag: 'Penalty',
      by: p.givenBy,
      amount: p.unit === 'points' ? `−${p.amount} pts` : `+${money(p.amount)} owed`,
      takeBack: p.takenBackAt ? null : p.id,
    });
    if (p.takenBackAt && p.takenBackBy) {
      events.push({
        key: `${p.id}:back`,
        at: p.takenBackAt,
        what: p.reason,
        tag: 'Taken back',
        by: p.takenBackBy,
        amount: p.unit === 'points' ? `+${p.amount} pts` : `−${money(p.amount)} owed`,
        takeBack: null,
      });
    }
  }
  for (const x of payments) {
    const p = penalties.find((q) => q.id === x.penaltyId);
    events.push({
      key: x.id,
      at: x.recordedAt,
      what: p ? `Paid for ${p.reason}` : 'Paid',
      tag: 'Paid',
      by: x.recordedBy,
      amount: `−${money(x.amount)} owed`,
      takeBack: null,
    });
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : -1));
}
