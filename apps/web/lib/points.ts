import { relativeDay } from './chores';
import { isoDay } from './format';

/**
 * [PTS-01][PTS-02] The points ledger as the app reads it (02 §4.2b, D-49). The database posts every
 * entry; the app only reads them and asks for adjustments.
 */
export type LedgerEntryType = 'earn' | 'reversal' | 'bonus' | 'spend' | 'refund' | 'adjustment';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** Signed. */
  amount: number;
  /** When it was posted (ISO timestamp). */
  at: string;
  /**
   * What it was for: the item's title for an earn or its reversal (null when the reader may not see
   * the item, D-34), or the reason for an adjustment.
   */
  label: string | null;
  /** The admin who posted an adjustment (their user id). */
  by: string | null;
}

/** An adjustment is 1 to 10000 points either way, with a reason of up to 200 characters. */
export const MAX_ADJUSTMENT = 10_000;
export const MAX_REASON = 200;

export interface AdjustmentInput {
  memberId: string;
  /** Signed: positive adds, negative takes away. */
  amount: number;
  reason: string;
  /** Makes sending the same form twice post once. */
  requestId: string;
}

export type ParsedAdjustment =
  { ok: true; value: AdjustmentInput } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [PTS-01][US-1106] The adjustment form, checked the way adjust_points() will check it, so a parent
 * gets a plain line instead of an error code. Add or take away is a choice, and points are always
 * entered as a positive number.
 */
export function parseAdjustment(form: FormData): ParsedAdjustment {
  const memberId = String(form.get('memberId') ?? '');
  const requestId = String(form.get('requestId') ?? '');
  if (!UUID.test(memberId) || !UUID.test(requestId)) {
    return {
      ok: false,
      message: 'Something went wrong with this form. Reload the page and try again.',
    };
  }
  const direction = form.get('direction');
  if (direction !== 'add' && direction !== 'take') {
    return { ok: false, message: 'Choose add or take away.' };
  }
  const pointsText = String(form.get('points') ?? '').trim();
  const points = /^\d+$/.test(pointsText) ? Number(pointsText) : NaN;
  if (!Number.isInteger(points) || points < 1 || points > MAX_ADJUSTMENT) {
    return { ok: false, message: `Enter a whole number of points from 1 to ${MAX_ADJUSTMENT}.` };
  }
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 1 || reason.length > MAX_REASON) {
    return { ok: false, message: `Say why, in up to ${MAX_REASON} characters.` };
  }
  return {
    ok: true,
    value: { memberId, amount: direction === 'add' ? points : -points, reason, requestId },
  };
}

/** What adjust_points() refused, in plain words. */
export function adjustmentMessage(
  error: { code?: string; hint?: string | null },
  name: string,
): string {
  switch (error.hint) {
    case 'not_earning':
      return `${name} doesn’t earn rewards. Turn on Earns rewards above to give them points.`;
    case 'member_archived':
      return `${name} is archived. Restore them from Members first.`;
    case 'bad_amount':
      return `Enter a whole number of points from 1 to ${MAX_ADJUSTMENT}.`;
    case 'reason_required':
      return `Say why, in up to ${MAX_REASON} characters.`;
    case 'request_reused':
      return 'That form was already used. Reload the page to make another change.';
  }
  if (error.code === '42501') return 'Only an admin of this household can change points.';
  return 'The points weren’t changed. Try again in a moment.';
}

/** "1 point", "35 points". */
export function pointsWord(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}

/** A signed amount as people read it: "+5", "−5" (a true minus sign). */
export function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/**
 * [PTS-02] A balance for a parent, plainly (06 voice: "Balance is −5 after a reversal"). The board
 * says "to earn back" instead (the points chip).
 */
export function balanceText(balance: number): string {
  return `${balance < 0 ? `−${Math.abs(balance)}` : balance} ${Math.abs(balance) === 1 ? 'point' : 'points'}`;
}

/**
 * [PTS-01] One line of a member's points history, for a parent: what it was for and, for an
 * adjustment, who made it. A private item someone else created shows without its title.
 */
export function ledgerLine(entry: LedgerEntry, adminName: (userId: string) => string): string {
  const item = entry.label ?? 'A private item';
  switch (entry.type) {
    case 'earn':
      return item;
    case 'reversal':
      return `Reversed ${entry.label ?? 'a private item'}`;
    case 'adjustment':
      return `${entry.label ?? 'Adjusted'} · by ${entry.by ? adminName(entry.by) : 'an admin'}`;
    case 'bonus':
      return entry.label ?? 'Bonus';
    case 'spend':
      return entry.label ?? 'Spent';
    case 'refund':
      return entry.label ?? 'Refunded';
  }
}

/** When an entry was posted, as a day relative to the household's today ("Today", "Yesterday", "Mon, Oct 6"). */
export function ledgerDay(at: string, timezone: string, today: string): string {
  return relativeDay(isoDay(timezone, new Date(at)), today);
}
