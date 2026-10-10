import { z } from 'zod';

// The wishlist (WP-30, D-57): a child pins the reward they are saving for, from the board. The
// database decides who may and what is in the shop (pin_wish); this checks the shape, sends it, and
// works out the savings meter.

/** [PTS-06] A board pins a reward for a child, or takes their wish off (`item_id` null). */
export const wishPinSchema = z
  .object({ member_id: z.guid(), item_id: z.guid().nullable() })
  .strict();

/** How a pin went: saved; not sent (no network, or the server failed); or refused by the shop. */
export type WishAnswer = 'saved' | 'offline' | 'refused';

export type PinWish = (memberId: string, itemId: string | null) => Promise<WishAnswer>;

/** [PTS-06] POST /api/wishes. Not queued: a wish is chosen while the board is online. */
export const postWish: PinWish = async (memberId, itemId) => {
  let res: Response;
  try {
    res = await fetch('/api/wishes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, item_id: itemId }),
    });
  } catch {
    return 'offline';
  }
  if (res.ok) return 'saved';
  // The shop said no (the reward went, or they no longer earn): asking again cannot help.
  return res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status)
    ? 'refused'
    : 'offline';
};

/**
 * [PTS-06][US-1108] How far a balance is from a wish: the points still to go, and whether there
 * are enough to ask for it. The meter itself rounds the percentage (GoalMeter).
 */
export function wishProgress(balance: number, cost: number): { toGo: number; enough: boolean } {
  const toGo = Math.max(0, cost - Math.max(0, balance));
  return { toGo, enough: cost > 0 && toGo === 0 };
}

/** The line under a wish's meter, in a child's words (06 §2). */
export function wishLine(balance: number, cost: number): string {
  const { toGo, enough } = wishProgress(balance, cost);
  if (enough) return 'You have enough!';
  return `${toGo} more ${toGo === 1 ? 'point' : 'points'} to go.`;
}
