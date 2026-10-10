import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askLine,
  askState,
  availableWith,
  postAsk,
  postCancelAsk,
  refusedLine,
  REQUEST_WORDS,
  withAsked,
} from './shop';
import type { BoardRequest } from './snapshot';

const ID = '0de00000-0000-4000-8000-0000000c0001';
const ITEM = '0de00000-0000-4000-8000-0000000c0002';
const KID = '0de00000-0000-4000-8000-0000000c0003';

const request = (id: string, cost: number, status: BoardRequest['status'] = 'requested') => ({
  id,
  itemId: 'r1',
  title: 'Movie night',
  icon: 'ticket',
  cost,
  status,
  at: '2026-10-10T12:00:00Z',
});

describe('what a child can ask for', () => {
  const kid = { available: 40, limited: ['r-weekly'] };

  it('[PTS-04][US-1104] enough to spend, some left, under the weekly limit and online: yes', () => {
    expect(askState({ id: 'r1', cost: 40, left: null }, kid, true)).toEqual({ can: true });
    expect(askState({ id: 'r1', cost: 40, left: 1 }, kid, true)).toEqual({ can: true });
  });

  it('[PTS-04][US-1104] says what stands in the way, the shop’s own rules first', () => {
    expect(askState({ id: 'r1', cost: 100, left: null }, kid, true)).toEqual({
      can: false,
      why: 'points',
      toGo: 60,
    });
    expect(askState({ id: 'r1', cost: 10, left: 0 }, kid, true)).toEqual({
      can: false,
      why: 'gone',
    });
    expect(askState({ id: 'r-weekly', cost: 10, left: null }, kid, true)).toEqual({
      can: false,
      why: 'limit',
    });
    // Asking is never queued: offline, the board says it needs the internet.
    expect(askState({ id: 'r1', cost: 10, left: null }, kid, false)).toEqual({
      can: false,
      why: 'offline',
    });
    // Points to earn back count as none to spend.
    expect(askState({ id: 'r1', cost: 10 }, { available: -5, limited: [] }, true)).toEqual({
      can: false,
      why: 'points',
      toGo: 10,
    });
  });

  it('[PTS-04] in a child’s words, never a telling-off', () => {
    expect(askLine({ can: true })).toBeNull();
    expect(askLine({ can: false, why: 'points', toGo: 1 })).toBe('1 more point to go');
    expect(askLine({ can: false, why: 'points', toGo: 12 })).toBe('12 more points to go');
    expect(askLine({ can: false, why: 'gone' })).toBe('All gone for now');
    expect(askLine({ can: false, why: 'limit' })).toBe('Asked for this week. Try next week!');
    expect(askLine({ can: false, why: 'offline' })).toBe('Asking needs the internet');
    expect(REQUEST_WORDS).toEqual({
      requested: 'Waiting for a grown-up',
      approved: 'Yes! It’s coming',
      denied: 'Not this time',
      fulfilled: 'You got it!',
      cancelled: 'Called off',
    });
    expect(refusedLine('not_enough_points')).toBe('Not enough points for that yet.');
    expect(refusedLine('weekly_limit')).toBe('That one was asked for this week already.');
    expect(refusedLine('something_new')).toBe('That didn’t work. Try again.');
  });
});

describe('this board’s own asks', () => {
  it('[PTS-04] show at once, until the snapshot has them; and hold their cost meanwhile', () => {
    const shown = [request('q1', 30)];
    const mine = [request('q2', 20), request('q1', 30)];
    expect(withAsked(shown, mine).map((r) => r.id)).toEqual(['q2', 'q1']);
    expect(availableWith({ available: 70, requests: shown }, mine)).toBe(50);
    expect(availableWith({ available: null, requests: [] }, [])).toBe(0);
  });
});

describe('asking and calling off', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = async (send: () => Promise<unknown>, respond: () => Promise<Response>) => {
    const fetch = vi.fn(respond);
    vi.stubGlobal('fetch', fetch);
    return { result: await send(), fetch };
  };

  it('[PTS-04][D-53] sends the id made for the ask, so sending again is the same ask', async () => {
    const { result, fetch } = await answer(
      () => postAsk(ID, KID, ITEM),
      async () => Response.json({ redemption: {} }),
    );
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/redemptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, member_id: KID, item_id: ITEM }),
    });
  });

  it('[PTS-04] a refusal carries its reason; no network or a server failure is "not sent"', async () => {
    const ask = () => postAsk(ID, KID, ITEM);
    expect(
      (
        await answer(ask, async () =>
          Response.json({ error: 'not_enough_points' }, { status: 409 }),
        )
      ).result,
    ).toEqual({ ok: false, reason: 'not_enough_points' });
    expect((await answer(ask, async () => new Response('?', { status: 404 }))).result).toEqual({
      ok: false,
      reason: 'refused',
    });
    expect((await answer(ask, async () => Response.json({}, { status: 500 }))).result).toEqual({
      ok: false,
      offline: true,
    });
    expect((await answer(ask, async () => Response.json({}, { status: 401 }))).result).toEqual({
      ok: false,
      offline: true,
    });
    expect(
      (
        await answer(ask, async () => {
          throw new TypeError('Failed to fetch');
        })
      ).result,
    ).toEqual({ ok: false, offline: true });
  });

  it('[US-1104] calling off names the request', async () => {
    const { result, fetch } = await answer(
      () => postCancelAsk(ID),
      async () => Response.json({ redemption: {} }),
    );
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/redemptions/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID }),
    });
  });
});
