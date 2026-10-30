import { describe, expect, it } from 'vitest';
import { readGroceries } from './board-groceries';
import {
  askAnswerWords,
  askCard,
  askMatches,
  askState,
  askTiles,
  type BoardAsk,
  type BoardGot,
  brandRow,
  canTakeOff,
  FACE_HOLD_MS,
  gotByWords,
  gotTodayCard,
  groceryActionSchema,
  groceryRefusalWords,
  heldFace,
  type KnownThing,
  waitingFor,
} from './grocery-asks';
import type { GroceryReason } from './groceries';
import { homeAlerts } from './home-alerts';

const ask = (o: Partial<BoardAsk>): BoardAsk => ({
  id: 'a',
  memberId: 'maya',
  name: 'Popcorn',
  brandId: null,
  status: 'waiting',
  itemStatus: null,
  gotToday: false,
  askedAt: '2026-10-29T20:00:00Z',
  ...o,
});
const known = (name: string, key: string, buys: number, brandIds: string[] = []): KnownThing => ({
  key,
  name,
  categoryId: 'c',
  buys,
  brandIds,
});
const reason = (o: Partial<GroceryReason>): GroceryReason => ({
  kind: 'added',
  byUser: null,
  memberId: null,
  mealPlanEntryId: null,
  label: null,
  amount: null,
  createdAt: '',
  ...o,
});

describe('[MEAL-22] the board’s Asked for card', () => {
  it('[MEAL-22-f] says how each ask stands, in words, and leaves out what has gone', () => {
    expect(askState(ask({}))).toBe('waiting');
    expect(askState(ask({ status: 'added', itemStatus: 'open' }))).toBe('on');
    expect(askState(ask({ status: 'added', itemStatus: 'ticked', gotToday: true }))).toBe('got');
    expect(askState(ask({ status: 'declined' }))).toBe('no');
    // Taken off the list, or got before today: not on the card.
    expect(askState(ask({ status: 'added', itemStatus: 'removed' }))).toBeNull();
    expect(askState(ask({ status: 'added', itemStatus: 'ticked', gotToday: false }))).toBeNull();
    const card = askCard([
      ask({ id: '1', status: 'declined' }),
      ask({ id: '2', status: 'added', itemStatus: 'open' }),
      ask({ id: '3', askedAt: '2026-10-29T19:00:00Z' }),
      ask({ id: '4', askedAt: '2026-10-29T21:00:00Z' }),
      ask({ id: '5', status: 'added', itemStatus: 'removed' }),
    ]);
    expect(card.map((c) => `${c.ask.id}:${c.state}`)).toEqual([
      '4:waiting',
      '3:waiting',
      '2:on',
      '1:no',
    ]);
  });

  it('[MEAL-22-f] reads the asks, Got today and what the household has had from board_groceries()', () => {
    const g = readGroceries({
      ever: true,
      today: '2026-10-29',
      items: [],
      asks: [
        { id: 'a1', member_id: 'm', name: 'Popcorn', status: 'waiting', asked_at: 't' },
        {
          id: 'a2',
          member_id: 'm',
          name: 'Milk',
          status: 'added',
          item_status: 'ticked',
          got_today: true,
        },
        { id: 'a3', member_id: 'm', name: 'Odd', status: 'called_off' },
      ],
      got: [{ id: 'i', name: 'Coffee', ticked_at: 't', member_id: 'sam' }, { id: 'x' }],
      known: [{ key: 'milk', name: 'Milk', buys: 9, brand_ids: ['b1', 3] }, { key: 'k' }],
    });
    expect(g?.today).toBe('2026-10-29');
    expect(g?.asks?.map((a) => `${a.name}:${a.status}:${a.gotToday}`)).toEqual([
      'Popcorn:waiting:false',
      'Milk:added:true',
    ]);
    expect(g?.got?.map((x) => `${x.name}:${x.memberId}`)).toEqual(['Coffee:sam']);
    expect(g?.known).toEqual([
      { key: 'milk', name: 'Milk', categoryId: '', buys: 9, brandIds: ['b1'] },
    ]);
  });

  it('[MEAL-22-f] the tiles: the most bought first, the starter set after, marked on the list or asked', () => {
    const tiles = askTiles(
      [known('Coffee', 'coffee', 3), known('Milk', 'milk', 9), known('Rice', 'rice', 0)],
      [{ name: 'Milk' }],
      [ask({ memberId: 'maya', name: 'Popcorn' }), ask({ memberId: 'leo', name: 'Bananas' })],
      'maya',
    );
    expect(tiles).toHaveLength(11);
    expect(tiles.slice(0, 4).map((t) => `${t.name}:${t.mark}`)).toEqual([
      'Milk:on',
      'Coffee:null',
      'Bananas:null',
      'Apples:null',
    ]);
    // A household with no history gets the made-up starter set; Maya's waiting ask says Asked.
    const starter = askTiles([], [], [ask({ name: 'Yogurt' })], 'maya');
    expect(starter.map((t) => t.name)).toEqual([
      'Milk',
      'Bananas',
      'Apples',
      'Eggs',
      'Bread',
      'Orange juice',
      'Cookies',
      'Grapes',
      'Strawberries',
      'Juice boxes',
      'Yogurt',
    ]);
    expect(starter.at(-1)!.mark).toBe('asked');
  });

  it('[MEAL-22-c] counts a child’s waiting asks', () => {
    expect(waitingFor([ask({}), ask({ status: 'added' }), ask({ memberId: 'leo' })], 'maya')).toBe(
      1,
    );
  });
});

describe('[MEAL-22] the brand row and the words', () => {
  const brands = [
    { id: 'k', name: 'Kirkland', archived: false },
    { id: 'f', name: 'Fairlife', archived: false },
    { id: 'h', name: 'Horizon', archived: true },
  ];
  it('[MEAL-22-g] the household’s brands the thing has had, last time’s first and picked; none without', () => {
    const k = [known('Milk', 'milk', 9, ['k', 'h', 'f']), known('Rice', 'rice', 1)];
    expect(brandRow('milk', k, brands)).toEqual({ brands: [brands[0], brands[1]], picked: 'k' });
    expect(brandRow('Rice', k, brands)).toEqual({ brands: [], picked: null });
    expect(brandRow('Kombucha', k, brands)).toEqual({ brands: [], picked: null });
  });

  it('[MEAL-22-g] what the board says back', () => {
    expect(askAnswerWords({ status: 'waiting', already: false }, 'Popcorn', 'Maya')).toBe(
      'Asked for Popcorn, Maya. A grown-up will say OK.',
    );
    expect(askAnswerWords({ status: 'added', already: false }, 'Popcorn', 'Alex')).toBe(
      'Added Popcorn to the list.',
    );
    expect(askAnswerWords({ status: 'added', already: true }, 'Milk', 'Maya')).toBe(
      'Already on the list! We added that you asked.',
    );
    expect(groceryRefusalWords('too_many')).toBe(
      'You have 5 asks waiting. Call one off, or wait for a grown-up.',
    );
  });

  it('[MEAL-22-g] matches what is typed: starting with it first, then holding it, at most 3', () => {
    const k = [
      known('Greek yogurt', 'greek yogurt', 4),
      known('Yogurt', 'yogurt', 1),
      known('Yogurt tubes', 'yogurt tube', 0),
      known('Yogurt drinks', 'yogurt drink', 0),
    ];
    expect(askMatches('Yog', k).map((m) => m.name)).toEqual([
      'Yogurt',
      'Yogurt tubes',
      'Yogurt drinks',
    ]);
    expect(askMatches('', k)).toEqual([]);
  });

  it('[MEAL-22-a] a board sends only what it may: a member, a name, a brand or none', () => {
    const id = '0de00000-0000-4000-8000-000000000001';
    expect(
      groceryActionSchema.safeParse({ action: 'ask', member_id: id, name: ' Popcorn ' }).data,
    ).toEqual({
      action: 'ask',
      member_id: id,
      name: 'Popcorn',
      brand_id: null,
    });
    expect(groceryActionSchema.safeParse({ action: 'ask', member_id: id, name: '' }).success).toBe(
      false,
    );
    expect(
      groceryActionSchema.safeParse({ action: 'remove', member_id: id, ids: [] }).success,
    ).toBe(false);
    expect(groceryActionSchema.safeParse({ action: 'drop', member_id: id }).success).toBe(false);
  });

  it('[MEAL-22-i] Home’s Needs you says how many grocery asks wait, and opens Groceries', () => {
    const alerts = homeAlerts({
      now: '2026-10-29T21:00:00Z',
      today: '2026-10-29',
      approvals: 0,
      requests: 0,
      groceryAsks: 2,
      boards: [],
      calendars: [],
      menuFeeds: [],
      jobsNeedingLook: 0,
      weather: { place: 'Springfield', failedAt: null },
      schoolYear: null,
      nextWeek: { school: false, menuDays: 0 },
      hasMenus: false,
      invites: [],
    });
    expect(alerts.find((a) => a.key === 'grocery-asks')).toMatchObject({
      level: 'act',
      text: '2 grocery asks wait for you',
      href: '/admin/groceries#asked',
      cta: 'Review',
    });
  });
});

describe('[MEAL-30] ticking off and taking off at the board', () => {
  it('[MEAL-30-c] the face picked stays 2 minutes', () => {
    const held = { memberId: 'sam', at: 1_000 };
    expect(heldFace(held, 1_000 + FACE_HOLD_MS - 1)).toBe('sam');
    expect(heldFace(held, 1_000 + FACE_HOLD_MS)).toBeNull();
    expect(heldFace(null, 0)).toBeNull();
  });

  it('[MEAL-30-c] a child takes off only what they alone asked for; an adult anything', () => {
    const leo = { id: 'leo', role: 'child' as const };
    const alex = { id: 'alex', role: 'adult' as const };
    expect(canTakeOff({ reasons: [reason({ kind: 'ask', memberId: 'leo' })] }, leo)).toBe(true);
    expect(canTakeOff({ reasons: [reason({})] }, leo)).toBe(false);
    expect(
      canTakeOff(
        {
          reasons: [
            reason({ kind: 'ask', memberId: 'leo' }),
            reason({ kind: 'ask', memberId: 'maya' }),
          ],
        },
        leo,
      ),
    ).toBe(false);
    expect(canTakeOff({ reasons: [] }, leo)).toBe(false);
    expect(canTakeOff({ reasons: [reason({})] }, alex)).toBe(true);
    expect(groceryRefusalWords('not_yours')).toBe('Only a grown-up can take this off.');
  });

  it('[MEAL-30-c] Got today: newest first, 5, then how many more', () => {
    const got: BoardGot[] = Array.from({ length: 8 }, (_, i) => ({
      id: `g${i}`,
      name: `Thing ${i}`,
      brandId: null,
      categoryId: 'c',
      tickedAt: `2026-10-29T1${i}:00:00Z`,
      memberId: null,
    }));
    const card = gotTodayCard(got);
    expect(card.shown.map((g) => g.id)).toEqual(['g7', 'g6', 'g5', 'g4', 'g3']);
    expect(card.more).toBe(3);
    expect(gotTodayCard(got.slice(0, 2)).more).toBe(0);
  });

  it('[MEAL-30-c] Got recently says who got it, and at which board', () => {
    expect(gotByWords('Leo', 'Kitchen')).toBe(' by Leo at the Kitchen board');
    expect(gotByWords('Sam', null)).toBe(' by Sam');
    expect(gotByWords(null, 'Kitchen')).toBe('');
  });
});
