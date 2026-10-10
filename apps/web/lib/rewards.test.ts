import { describe, expect, it } from 'vitest';
import {
  checkPhoto,
  itemFacts,
  parseCatalog,
  redemptionCancelSchema,
  redemptionRequestSchema,
  refusal,
} from './rewards';

const ICONS = ['gift', 'ticket', 'star'];
const ID = '0de00000-0000-4000-8000-0000000c0001';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('asking for a reward', () => {
  it('[PTS-04] a request names itself, the child and the reward; nothing else', () => {
    expect(redemptionRequestSchema.safeParse({ id: ID, member_id: ID, item_id: ID }).success).toBe(
      true,
    );
    expect(redemptionRequestSchema.safeParse({ id: ID, member_id: ID }).success).toBe(false);
    expect(
      redemptionRequestSchema.safeParse({ id: ID, member_id: ID, item_id: ID, cost: 1 }).success,
    ).toBe(false);
    expect(redemptionCancelSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });

  it('[PTS-04] the shop’s refusals are conflicts; not allowed and not found are their own', () => {
    expect(refusal({ code: '23514', hint: 'not_enough_points' })).toEqual({
      status: 409,
      reason: 'not_enough_points',
    });
    for (const hint of ['out_of_stock', 'weekly_limit', 'not_earning', 'not_requested']) {
      expect(refusal({ code: '23514', hint }).status).toBe(409);
    }
    expect(refusal({ code: '42501', hint: 'not_allowed' })).toEqual({
      status: 403,
      reason: 'not_allowed',
    });
    expect(refusal({ code: 'P0002', hint: 'item_unavailable' })).toEqual({
      status: 404,
      reason: 'item_unavailable',
    });
    expect(refusal({ code: '22023', hint: 'bad_request' }).status).toBe(400);
    expect(refusal({ code: null, hint: null })).toEqual({ status: 400, reason: 'invalid' });
  });
});

describe('the catalog form', () => {
  it('[PTS-03] reads a reward: blank stock and limit mean none; an unknown icon is a gift', () => {
    expect(
      parseCatalog(
        form({
          title: ' Movie night ',
          costPoints: '100',
          stock: '',
          weeklyLimit: '',
          icon: 'ticket',
          active: 'on',
        }),
        ICONS,
      ),
    ).toEqual({
      ok: true,
      value: {
        title: 'Movie night',
        description: null,
        icon: 'ticket',
        costPoints: 100,
        stock: null,
        weeklyLimit: null,
        active: true,
      },
    });
    const r = parseCatalog(
      form({ title: 'Ice cream', costPoints: '20', stock: '0', weeklyLimit: '1', icon: 'rocket' }),
      ICONS,
    );
    expect(r).toMatchObject({
      ok: true,
      value: { stock: 0, weeklyLimit: 1, icon: 'gift', active: false },
    });
  });

  it('[PTS-03] says what to fix', () => {
    const msg = (fields: Record<string, string>) => {
      const r = parseCatalog(form({ title: 'Prize', costPoints: '10', ...fields }), ICONS);
      return r.ok ? null : r.message;
    };
    expect(msg({ title: '' })).toBe('Give it a name, up to 80 characters.');
    expect(msg({ costPoints: '0' })).toBe('Give it a cost of 1 to 100,000 points.');
    expect(msg({ costPoints: '1.5' })).toBe('Give it a cost of 1 to 100,000 points.');
    expect(msg({ stock: '-1' })).toBe('Stock is a whole number, or blank for no limit.');
    expect(msg({ weeklyLimit: '0' })).toBe('A weekly limit is 1 to 100, or blank for none.');
    expect(msg({ description: 'x'.repeat(301) })).toBe('Keep the description to 300 characters.');
    expect(msg({})).toBeNull();
  });

  it('[PTS-03] takes a JPEG, PNG or WebP photo up to 2 MB', () => {
    expect(checkPhoto(null)).toBeNull();
    expect(checkPhoto(new Blob([], { type: 'image/png' }))).toBeNull();
    expect(checkPhoto(new Blob(['x'], { type: 'image/png' }))).toEqual({ ext: 'png' });
    expect(checkPhoto(new Blob(['x'], { type: 'image/gif' }))).toBe(
      'Use a JPEG, PNG or WebP photo.',
    );
    expect(
      checkPhoto(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' })),
    ).toBe('Use a photo up to 2 MB.');
  });

  it('[PTS-03] sums a reward up in a line', () => {
    expect(itemFacts({ costPoints: 100, stockLeft: null, weeklyLimit: null })).toBe('100 points');
    expect(itemFacts({ costPoints: 1, stockLeft: 1, weeklyLimit: 1 })).toBe(
      '1 point · 1 left · once a week',
    );
    expect(itemFacts({ costPoints: 20, stockLeft: 0, weeklyLimit: 3 })).toBe(
      '20 points · none left · 3 a week',
    );
  });
});
