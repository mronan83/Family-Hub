// [NFR-18][D-120] What Rewards' and Members' folds say while folded (WP-95), as the fold audit draws
// them: the shop's Archived, Bonus points, Lately, Members' Archived and a member's Points. Each line
// is words and bold facts (`FoldLine`, drawn by `Line`). Which fold comes back open after a save is
// worked out here too, from the address the save sent the page back to.
import type { BonusRule } from './bonus';
import { relativeDay } from './chores';
import { andList, isoDay, time } from './format';
import { balanceText, signed, type LedgerEntry } from './points';
import type { RedemptionStatus } from './rewards';
import type { FoldLine } from './setup-facts';

/** A day as a folded header says it: "today", "yesterday", else "Thu, Oct 15". */
function dayWords(at: string, timezone: string, today: string): string {
  const words = relativeDay(isoDay(timezone, new Date(at)), today);
  return words === 'Today' || words === 'Yesterday' ? words.toLowerCase() : words;
}

/** [PTS-03] The shop's Archived, folded: "3 archived", or nothing archived. */
export function shopArchivedLine(count: number): FoldLine {
  return count === 0 ? ['None archived'] : [{ b: `${count} archived` }];
}

/** [PTS-03] When an archived reward left the shop: "Archived in September", in the household's zone. */
export function archivedWhen(at: string, timezone: string): string {
  return `Archived in ${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: timezone }).format(new Date(at))}`;
}

/** [PTS-05] A bonus rule's short name and points: "7 days in a row +20", "Perfect day +5". */
export function bonusName(r: Pick<BonusRule, 'ruleType' | 'streakDays' | 'bonusPoints'>): string {
  const name = r.ruleType === 'streak_bonus' ? `${r.streakDays} days in a row` : 'Perfect day';
  return `${name} ${signed(r.bonusPoints)}`;
}

/**
 * [PTS-05] Bonus points, folded: how many are on and off, and the ones on by name and points
 * ("2 on, 1 off · 7 days in a row +20, Perfect day +5"). Archived ones aren't counted.
 */
export function bonusLine(
  rules: Pick<BonusRule, 'ruleType' | 'streakDays' | 'bonusPoints' | 'active' | 'archivedAt'>[],
): FoldLine {
  const live = rules.filter((r) => !r.archivedAt);
  if (live.length === 0) return ['No bonuses yet'];
  const on = live.filter((r) => r.active);
  const off = live.length - on.length;
  if (on.length === 0) return [{ b: 'None on' }, ` · ${off} off`];
  return [
    { b: `${on.length} on` },
    `${off ? `, ${off} off` : ''} · ${on.map(bonusName).join(', ')}`,
  ];
}

/** [PTS-05] Archived bonuses, folded: "1 archived". */
export function archivedBonusesLine(count: number): FoldLine {
  return [`${count} archived`];
}

export interface Settled {
  status: RedemptionStatus;
  memberId: string;
  itemId: string;
  requestedAt: string;
  decidedAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
}

const SETTLED_WORDS: Partial<Record<RedemptionStatus, string>> = {
  fulfilled: 'given to',
  denied: 'not this time for',
  cancelled: 'cancelled for',
};

/** When a request was settled: given, cancelled or decided, else when it was asked for. */
export const settledAt = (r: Settled): string =>
  (r.status === 'fulfilled'
    ? r.fulfilledAt
    : r.status === 'cancelled'
      ? r.cancelledAt
      : r.decidedAt) ?? r.requestedAt;

/**
 * [PTS-04] Lately, folded: the latest settled request in words and its day, and how many the list
 * holds ("Last: Movie night given to Maya, today · 10 settled"). `settled` is newest first.
 */
export function latelyLine(
  settled: Settled[],
  title: (itemId: string) => string,
  name: (memberId: string) => string,
  timezone: string,
  today: string,
): FoldLine {
  const last = settled[0];
  if (!last) return ['Nothing settled yet'];
  return [
    { b: 'Last:' },
    ` ${title(last.itemId)} ${SETTLED_WORDS[last.status] ?? 'for'} ${name(last.memberId)}, ${dayWords(settledAt(last), timezone, today)} · ${settled.length} settled`,
  ];
}

/**
 * [PTS-01] A member's Points, folded: the balance and the last change, signed, what it was for and
 * when ("142 points · last: +5 Make bed, today 7:10 am"). `what` is the last change's line.
 */
export function pointsLine(
  balance: number,
  last: (Pick<LedgerEntry, 'amount' | 'at'> & { what: string }) | null,
  timezone: string,
  today: string,
): FoldLine {
  if (!last) return [{ b: balanceText(balance) }, ' · no points yet'];
  return [
    { b: balanceText(balance) },
    ` · last: ${signed(last.amount)} ${last.what}, ${dayWords(last.at, timezone, today)} ${time(last.at, timezone)}`,
  ];
}

/** [ACC-04] Members' Archived, folded: how many and who ("2 archived: Grandpa Joe and Nana"). */
export function membersArchivedLine(names: string[]): FoldLine {
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return [{ b: `${names.length} archived:` }, ` ${andList(shown)}`];
}

/** Which of Rewards' folds come back open, from the address a save sent the page back to. */
export interface RewardsOpen {
  archived: boolean;
  bonus: boolean;
  archivedBonuses: boolean;
}

/**
 * [PTS-03][PTS-05] An archived reward, or one put back from it, opens the shop's Archived; a bonus added, turned on or off,
 * archived or paid, or a bonus that was refused, opens Bonus points, and an archived one Archived
 * bonuses too. Nothing else opens a fold.
 */
export function rewardsOpen(params: {
  archived?: string;
  restored?: string;
  bonus?: string;
  error?: string;
  open?: string;
}): RewardsOpen {
  const bonus =
    Boolean(params.bonus) ||
    params.open === 'bonus' ||
    params.error === 'bonus_gone' ||
    params.error === 'history';
  return {
    archived: Boolean(params.archived || params.restored),
    bonus,
    archivedBonuses: params.bonus === 'archive',
  };
}

/**
 * [PTS-01][ACC-04] A member's Points comes back open after a change of points, with Change points
 * open for the next one; Members' Archived after an archive.
 */
export function memberOpen(params: { adjusted?: string }): { points: boolean } {
  const n = Number(params.adjusted);
  return { points: Number.isInteger(n) && n !== 0 };
}
