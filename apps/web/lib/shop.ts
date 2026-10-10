import type { RedemptionStatus } from './rewards';
import type { BoardMember, BoardRequest, BoardShopItem } from './snapshot';

// The board's shop (WP-20, D-59): what a child can ask for, in their words, and the calls that ask and
// cancel (WP-18's API). The database decides (request_redemption); this says ahead of time what it will
// say, so the board offers only what can be asked for and says why not.

/** Why a reward can't be asked for now, or that it can. */
export type AskState =
  | { can: true }
  | { can: false; why: 'points'; toGo: number }
  | { can: false; why: 'gone' | 'limit' | 'offline' };

/**
 * [PTS-04][US-1104] Whether a child can ask for a reward: enough to spend after what they've already
 * asked for, some left, under its weekly limit, and the board online (asking isn't queued: a request
 * is a conversation with a parent, about the balance as it is now).
 */
export function askState(
  item: Pick<BoardShopItem, 'id' | 'cost' | 'left'>,
  member: Pick<BoardMember, 'available' | 'limited'>,
  online: boolean,
): AskState {
  if (item.left === 0) return { can: false, why: 'gone' };
  if (member.limited.includes(item.id)) return { can: false, why: 'limit' };
  const toGo = item.cost - Math.max(0, member.available ?? 0);
  if (toGo > 0) return { can: false, why: 'points', toGo };
  if (!online) return { can: false, why: 'offline' };
  return { can: true };
}

/** The line a reward shows when it can't be asked for (06 §2: what to do next, never a telling-off). */
export function askLine(state: AskState): string | null {
  if (state.can) return null;
  switch (state.why) {
    case 'points':
      return `${state.toGo} more ${state.toGo === 1 ? 'point' : 'points'} to go`;
    case 'gone':
      return 'All gone for now';
    case 'limit':
      return 'Asked for this week. Try next week!';
    case 'offline':
      return 'Asking needs the internet';
  }
}

/** [US-1104][US-1105] A request in a child's words. */
export const REQUEST_WORDS: Record<RedemptionStatus, string> = {
  requested: 'Waiting for a grown-up',
  approved: 'Yes! It’s coming',
  denied: 'Not this time',
  fulfilled: 'You got it!',
  cancelled: 'Called off',
};

/** How an ask or a cancel went: done; not sent (no network, or the server failed); or refused. */
export type ShopAnswer =
  { ok: true } | { ok: false; offline: true } | { ok: false; reason: string };

export type AskFor = (id: string, memberId: string, itemId: string) => Promise<ShopAnswer>;
export type CancelAsk = (id: string) => Promise<ShopAnswer>;

async function send(path: string, body: unknown): Promise<ShopAnswer> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, offline: true };
  }
  if (res.ok) return { ok: true };
  // The shop said no: asking again cannot help. Anything else may pass.
  if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)) {
    const answer = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, reason: typeof answer?.error === 'string' ? answer.error : 'refused' };
  }
  return { ok: false, offline: true };
}

/** [PTS-04] POST /api/redemptions. The id is made once per ask, so sending it again is the same ask. */
export const postAsk: AskFor = (id, memberId, itemId) =>
  send('/api/redemptions', { id, member_id: memberId, item_id: itemId });

/** [US-1104] POST /api/redemptions/cancel: a child changes their mind before a parent decides. */
export const postCancelAsk: CancelAsk = (id) => send('/api/redemptions/cancel', { id });

/** What the board says when the shop refused (the reasons request_redemption() gives). */
export function refusedLine(reason: string): string {
  switch (reason) {
    case 'not_enough_points':
      return 'Not enough points for that yet.';
    case 'out_of_stock':
      return 'That one is all gone.';
    case 'weekly_limit':
      return 'That one was asked for this week already.';
    case 'item_unavailable':
      return 'That one isn’t in the shop now.';
    case 'not_cancellable':
    case 'not_allowed':
      return 'A grown-up has already answered that one.';
    default:
      return 'That didn’t work. Try again.';
  }
}

/**
 * [PTS-04] A child's requests with this board's own asks laid over the snapshot until it shows them:
 * an ask answers at once, and one the snapshot already has is dropped.
 */
export function withAsked(requests: BoardRequest[], asked: BoardRequest[]): BoardRequest[] {
  const known = new Set(requests.map((r) => r.id));
  return [...asked.filter((r) => !known.has(r.id)), ...requests];
}

/** What a child can spend once this board's own asks are held too. */
export function availableWith(
  member: Pick<BoardMember, 'available' | 'requests'>,
  asked: BoardRequest[],
): number {
  const known = new Set(member.requests.map((r) => r.id));
  const held = asked.filter((r) => !known.has(r.id)).reduce((n, r) => n + r.cost, 0);
  return (member.available ?? 0) - held;
}
