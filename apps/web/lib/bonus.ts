import { day } from './format';
import { pointsWord } from './points';

// Bonus rules (WP-30, D-57): a parent's automatic bonuses, read and written in the admin's words. The
// database applies them at day close (apply_points_rules) and posts each bonus once.

export type BonusRuleType = 'streak_bonus' | 'all_done_bonus';

export interface BonusRule {
  id: string;
  ruleType: BonusRuleType;
  /** A streak bonus's run length; null for a perfect-day bonus. */
  streakDays: number | null;
  bonusPoints: number;
  /** Days before it never pay (YYYY-MM-DD). */
  countsFrom: string;
  active: boolean;
  archivedAt: string | null;
}

export interface BonusRuleInput {
  ruleType: BonusRuleType;
  streakDays: number | null;
  bonusPoints: number;
  countsFrom: string;
}

export type ParsedBonusRule = { ok: true; value: BonusRuleInput } | { ok: false; message: string };

export const MAX_BONUS = 1_000;
export const MAX_STREAK_DAYS = 365;

const whole = (raw: FormDataEntryValue | null, min: number, max: number): number | null => {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * [PTS-05] The add-a-bonus form, or a line saying what to fix: a streak bonus (a run of 2 to 365 good
 * days) or a perfect-day bonus, 1 to 1,000 points, counting from a date (today when left blank).
 */
export function parseBonusRule(form: FormData, today: string): ParsedBonusRule {
  const type = String(form.get('ruleType') ?? '');
  if (type !== 'streak_bonus' && type !== 'all_done_bonus') {
    return { ok: false, message: 'Choose a streak or a perfect day.' };
  }
  let streakDays: number | null = null;
  if (type === 'streak_bonus') {
    streakDays = whole(form.get('streakDays'), 2, MAX_STREAK_DAYS);
    if (streakDays === null) {
      return { ok: false, message: `A streak is 2 to ${MAX_STREAK_DAYS} good days in a row.` };
    }
  }
  const bonusPoints = whole(form.get('bonusPoints'), 1, MAX_BONUS);
  if (bonusPoints === null) {
    return { ok: false, message: 'Give a bonus of 1 to 1,000 points.' };
  }
  const given = String(form.get('countsFrom') ?? '').trim();
  const countsFrom = given || today;
  if (!ISO_DATE.test(countsFrom) || Number.isNaN(Date.parse(`${countsFrom}T12:00:00Z`))) {
    return { ok: false, message: 'Choose the day it counts from.' };
  }
  return { ok: true, value: { ruleType: type, streakDays, bonusPoints, countsFrom } };
}

/** A rule as a parent reads it: "10 points for 7 good days in a row". */
export function describeBonus(
  r: Pick<BonusRule, 'ruleType' | 'streakDays' | 'bonusPoints'>,
): string {
  return r.ruleType === 'streak_bonus'
    ? `${pointsWord(r.bonusPoints)} for ${r.streakDays} good days in a row`
    : `${pointsWord(r.bonusPoints)} for each day with everything done`;
}

/** What else to know about a rule: from when it counts, and whether it is paused. */
export function bonusFacts(r: Pick<BonusRule, 'countsFrom' | 'active'>, today: string): string {
  const from =
    r.countsFrom > today
      ? `starts ${day(`${r.countsFrom}T12:00:00Z`, 'UTC')}`
      : `counts from ${day(`${r.countsFrom}T12:00:00Z`, 'UTC')}`;
  return r.active ? from : `${from} · off`;
}

/**
 * Turning a rule back on counts from today: days while it was off never pay, so a pause doesn't turn
 * into a surprise backlog of bonuses.
 */
export function resumedFrom(countsFrom: string, today: string): string {
  return countsFrom > today ? countsFrom : today;
}
