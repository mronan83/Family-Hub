import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWish, wishLine, wishPinSchema, wishProgress } from './wishes';

const ID = '0de00000-0000-4000-8000-0000000c0001';

describe('pinning a wish', () => {
  it('[PTS-06] names the child and the reward, or no reward to take the wish off', () => {
    expect(wishPinSchema.safeParse({ member_id: ID, item_id: ID }).success).toBe(true);
    expect(wishPinSchema.safeParse({ member_id: ID, item_id: null }).success).toBe(true);
    expect(wishPinSchema.safeParse({ member_id: ID }).success).toBe(false);
    expect(wishPinSchema.safeParse({ member_id: 'maya', item_id: ID }).success).toBe(false);
    expect(wishPinSchema.safeParse({ member_id: ID, item_id: ID, cost: 1 }).success).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('[PTS-06] saved, refused by the shop, or not sent (no network, or the server failed)', async () => {
    const answer = async (respond: () => Promise<Response>) => {
      const fetch = vi.fn(respond);
      vi.stubGlobal('fetch', fetch);
      const result = await postWish(ID, null);
      expect(fetch).toHaveBeenCalledWith('/api/wishes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ member_id: ID, item_id: null }),
      });
      return result;
    };
    expect(await answer(async () => Response.json({ wish: {} }))).toBe('saved');
    expect(await answer(async () => Response.json({}, { status: 404 }))).toBe('refused');
    expect(await answer(async () => Response.json({}, { status: 409 }))).toBe('refused');
    expect(await answer(async () => Response.json({}, { status: 401 }))).toBe('offline');
    expect(await answer(async () => Response.json({}, { status: 500 }))).toBe('offline');
    expect(
      await answer(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe('offline');
  });
});

describe('saving up', () => {
  it('[PTS-06][US-1108] 120 of 200 is 80 to go; at the cost or past it, there is enough', () => {
    expect(wishProgress(120, 200)).toEqual({ toGo: 80, enough: false });
    expect(wishProgress(200, 200)).toEqual({ toGo: 0, enough: true });
    expect(wishProgress(250, 200)).toEqual({ toGo: 0, enough: true });
    // Points to earn back count as none saved yet.
    expect(wishProgress(-10, 50)).toEqual({ toGo: 50, enough: false });
  });

  it('[PTS-06] says how far to go, and to ask once there is enough', () => {
    expect(wishLine(17, 25)).toBe('8 more points to go.');
    expect(wishLine(24, 25)).toBe('1 more point to go.');
    expect(wishLine(25, 25)).toBe('You have enough! Ask a grown-up for it.');
  });
});
