import type { Answer, CompletionEvent } from '@/lib/outbox';
import type { MarkCelebrated } from '@/lib/board-goals';
import type { AskFor, CancelAsk } from '@/lib/shop';
import type { BoardMember, BoardSnapshot } from '@/lib/snapshot';
import type { TodayItem } from '@/lib/today';
import type { PinWish } from '@/lib/wishes';

// A made-up family's day for the board's Today (WP-11), dated today in New York, so the UI suite can
// check the screen, its taps and its states without a database. Names are invented.
export const TZ = 'America/New_York';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const ALEX = 'f1000000-0000-4000-8000-000000000003';
const SAM = 'f1000000-0000-4000-8000-000000000004';

const day = (offset: number, today: string) =>
  new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

export function fixtureSnapshot(today: string, now: Date): BoardSnapshot {
  const item = (id: string, o: Partial<TodayItem>): TodayItem => ({
    id,
    choreId: `c-${id}`,
    title: 'Item',
    icon: 'list-check',
    kind: 'chore',
    dueDate: today,
    dueTime: null,
    memberId: null,
    assignees: [],
    status: 'scheduled',
    doneBy: [],
    rewarded: [],
    points: 5,
    requiresApproval: false,
    checkedAt: null,
    ...o,
  });
  const longAgo = new Date(now.getTime() - 3 * 3_600_000).toISOString();
  return {
    v: 1,
    fetchedAt: new Date(now.getTime() - 60_000).toISOString(),
    today,
    range: { from: day(-1, today), to: day(14, today) },
    household: { id: 'h', name: 'Demo family', timezone: TZ, weekStart: 0, undoWindowSeconds: 120 },
    device: { id: 'd', name: 'Kitchen', theme: 'auto' },
    members: [
      {
        id: LEO,
        displayName: 'Leo',
        role: 'child',
        avatarKey: 'frog',
        color: 'member-4',
        earnsRewards: true,
        points: {
          balance: 17,
          recent: [{ id: 'p4', type: 'earn', amount: 2, at: longAgo, label: 'Brush teeth' }],
        },
        // Six good days to yesterday: finishing today reaches the 7-day milestone (WP-17).
        streak: { kind: 'good', length: 6, best: 6 },
        // Nothing pinned yet: the board offers to choose a wish (WP-30).
        wish: null,
        // Nothing asked for (WP-20).
        available: 17,
        requests: [],
        limited: [],
      },
      {
        id: MAYA,
        displayName: 'Maya',
        role: 'child',
        avatarKey: 'fox',
        color: 'member-3',
        earnsRewards: true,
        points: {
          balance: 42,
          recent: [
            { id: 'p3', type: 'adjustment', amount: -5, at: longAgo, label: 'Left the bike out' },
            {
              id: 'p2',
              type: 'adjustment',
              amount: 10,
              at: longAgo,
              label: 'Helped carry the shopping',
            },
            { id: 'p1', type: 'reversal', amount: -5, at: longAgo, label: 'Feed the dog' },
          ],
        },
        streak: { kind: 'good', length: 2, best: 5 },
        // Saving for Movie night: 42 of 100 (WP-30).
        wish: { id: 'r-movie', title: 'Movie night', icon: 'ticket', cost: 100 },
        // Picked the dinner this week (once a week, given), and was told not this time for ice
        // cream; nothing waiting, so all 42 can be spent (WP-20).
        available: 42,
        requests: [
          {
            id: 'q-dinner',
            itemId: 'r-dinner',
            title: 'Pick the dinner',
            icon: 'utensils',
            cost: 30,
            status: 'fulfilled',
            at: longAgo,
          },
          {
            id: 'q-icecream',
            itemId: 'r-icecream',
            title: 'Ice cream trip',
            icon: 'snack',
            cost: 40,
            status: 'denied',
            at: longAgo,
          },
        ],
        limited: ['r-dinner'],
      },
      {
        id: ALEX,
        displayName: 'Alex',
        role: 'adult',
        avatarKey: 'owl',
        color: 'member-1',
        earnsRewards: false,
        points: null,
        streak: null,
        wish: null,
        available: null,
        requests: [],
        limited: [],
      },
      {
        id: SAM,
        displayName: 'Sam',
        role: 'adult',
        avatarKey: 'bear',
        color: 'member-2',
        earnsRewards: false,
        points: null,
        streak: null,
        wish: null,
        available: null,
        requests: [],
        limited: [],
      },
    ],
    occurrences: [
      item('books', {
        title: 'Return library books',
        icon: 'chore-read',
        kind: 'task',
        dueDate: day(-2, today),
        assignees: [MAYA],
        points: 3,
      }),
      item('plumber', {
        title: 'Call the plumber',
        icon: 'calendar',
        kind: 'task',
        dueDate: day(-1, today),
        assignees: [ALEX],
        points: 0,
      }),
      item('bed-maya', {
        title: 'Make bed',
        icon: 'chore-bed',
        dueTime: '07:30',
        memberId: MAYA,
        assignees: [MAYA],
      }),
      item('bed-leo', {
        title: 'Make bed',
        icon: 'chore-bed',
        dueTime: '07:30',
        memberId: LEO,
        assignees: [LEO],
      }),
      item('teeth-leo', {
        title: 'Brush teeth',
        icon: 'chore-teeth',
        dueTime: '07:45',
        memberId: LEO,
        assignees: [LEO],
        points: 2,
        status: 'completed',
        doneBy: [LEO],
        rewarded: [LEO],
        checkedAt: longAgo,
      }),
      item('homework', {
        title: 'Homework',
        icon: 'chore-homework',
        dueTime: '16:00',
        assignees: [MAYA],
        points: 10,
        requiresApproval: true,
      }),
      item('dog', {
        title: 'Feed the dog',
        icon: 'chore-pet',
        dueTime: '17:00',
        assignees: [MAYA, ALEX],
      }),
      item('table', {
        title: 'Set the table',
        icon: 'chore-table',
        dueTime: '17:30',
        assignees: [LEO],
      }),
      item('plants', {
        title: 'Water the plants',
        icon: 'chore-plant',
        assignees: [LEO],
        points: 3,
        status: 'completed',
        doneBy: [MAYA],
        rewarded: [MAYA],
        checkedAt: longAgo,
      }),
    ],
    shop: [
      { id: 'r-movie', title: 'Movie night', icon: 'ticket', cost: 100, photo: null, left: null },
      { id: 'r-icecream', title: 'Ice cream trip', icon: 'snack', cost: 40, photo: null, left: 3 },
      {
        id: 'r-late',
        title: 'Stay up 30 minutes late',
        icon: 'moon',
        cost: 25,
        photo: null,
        left: null,
      },
      {
        id: 'r-dinner',
        title: 'Pick the dinner',
        icon: 'utensils',
        cost: 30,
        photo: null,
        left: null,
      },
      { id: 'r-kite', title: 'A new kite', icon: 'star', cost: 15, photo: null, left: 0 },
    ],
    // Leo is one thing from his goal (a nudge); Maya has two rules to go and one reached (already
    // celebrated); the family is 90% of the way to Pizza night (WP-20).
    goals: [
      {
        id: 'g-bike',
        memberId: LEO,
        title: 'Bike ride',
        icon: 'star',
        photo: null,
        status: 'active',
        n: 0,
        achievedAt: null,
        celebrate: false,
        endDate: day(3, today),
        logic: 'all',
        pct: 90,
        rules: [
          {
            id: 'gr-bike',
            type: 'COUNT',
            target: 10,
            current: 9,
            pct: 90,
            met: false,
            streak: null,
            best: null,
          },
        ],
      },
      {
        id: 'g-art',
        memberId: MAYA,
        title: 'Art kit',
        icon: 'gift',
        photo: null,
        status: 'achieved',
        n: 1,
        achievedAt: longAgo,
        celebrate: false,
        endDate: null,
        logic: 'all',
        pct: 100,
        rules: [
          {
            id: 'gr-art',
            type: 'POINTS',
            target: 50,
            current: 50,
            pct: 100,
            met: true,
            streak: null,
            best: null,
          },
        ],
      },
      {
        id: 'g-zoo',
        memberId: MAYA,
        title: 'Zoo trip',
        icon: 'ticket',
        photo: null,
        status: 'active',
        n: 0,
        achievedAt: null,
        celebrate: false,
        endDate: day(20, today),
        logic: 'all',
        pct: 50,
        rules: [
          {
            id: 'gr-zoo-1',
            type: 'COUNT',
            target: 20,
            current: 12,
            pct: 60,
            met: false,
            streak: null,
            best: null,
          },
          {
            id: 'gr-zoo-2',
            type: 'STREAK',
            target: 5,
            current: 3,
            pct: 60,
            met: false,
            streak: 2,
            best: 3,
          },
        ],
      },
      {
        id: 'g-pizza',
        memberId: null,
        title: 'Pizza night',
        icon: 'trophy',
        photo: null,
        status: 'active',
        n: 0,
        achievedAt: null,
        celebrate: false,
        endDate: null,
        logic: 'all',
        pct: 90,
        rules: [
          {
            id: 'gr-pizza',
            type: 'COUNT',
            target: 20,
            current: 18,
            pct: 90,
            met: false,
            streak: null,
            best: null,
          },
        ],
      },
    ],
  };
}

/** [RWD-08] The same family the moment Leo reaches his goal: the board celebrates it (WP-20). */
export function reachedBike(s: BoardSnapshot, now: Date): BoardSnapshot {
  return {
    ...s,
    goals: s.goals.map((g) =>
      g.id === 'g-bike'
        ? {
            ...g,
            status: 'achieved',
            n: 1,
            achievedAt: now.toISOString(),
            celebrate: true,
            pct: 100,
            rules: g.rules.map((r) => ({ ...r, current: 10, pct: 100, met: true })),
          }
        : g,
    ),
  };
}

type Change = (f: (s: BoardSnapshot) => BoardSnapshot) => void;
type Shop = {
  asks: { id: string; member: string; item: string }[];
  cancels: string[];
  marks: string[];
};
const shopLog = () => {
  const w = window as unknown as { __fwShop?: Shop };
  return (w.__fwShop ??= { asks: [], cancels: [], marks: [] });
};
const withMember = (s: BoardSnapshot, id: string, f: (m: BoardMember) => BoardMember) => ({
  ...s,
  members: s.members.map((m) => (m.id === id ? f(m) : m)),
});

/**
 * Answers like POST /api/redemptions would (WP-20), a moment later, and then shows the request in the
 * snapshot as Realtime would. Each ask is kept on window.__fwShop; a reward none are left of is
 * refused (window.__fwRefuse refuses anything, with that reason), and offline nothing is sent.
 */
export function fixtureAsk(snapshot: BoardSnapshot, change: Change): AskFor {
  return async (id, memberId, itemId) => {
    if (!navigator.onLine) return { ok: false, offline: true };
    shopLog().asks.push({ id, member: memberId, item: itemId });
    await new Promise((r) => setTimeout(r, 30));
    // A test can have the shop refuse, as it would if another board got there first.
    const refuse = (window as unknown as { __fwRefuse?: string }).__fwRefuse;
    if (refuse) return { ok: false, reason: refuse };
    // The points are the board's to check: this stand-in's snapshot never hears of its check-offs.
    const item = snapshot.shop.find((i) => i.id === itemId)!;
    if (item.left === 0) return { ok: false, reason: 'out_of_stock' };
    change((s) =>
      withMember(s, memberId, (x) => ({
        ...x,
        available: (x.available ?? 0) - item.cost,
        requests: [
          {
            id,
            itemId,
            title: item.title,
            icon: item.icon,
            cost: item.cost,
            status: 'requested',
            at: new Date().toISOString(),
          },
          ...x.requests,
        ],
      })),
    );
    return { ok: true };
  };
}

/** Answers like POST /api/redemptions/cancel would, then shows it called off and the points free. */
export function fixtureCancel(change: Change): CancelAsk {
  return async (id) => {
    if (!navigator.onLine) return { ok: false, offline: true };
    shopLog().cancels.push(id);
    await new Promise((r) => setTimeout(r, 30));
    change((s) => ({
      ...s,
      members: s.members.map((m) => {
        const r = m.requests.find((x) => x.id === id);
        if (!r) return m;
        return {
          ...m,
          available: (m.available ?? 0) + r.cost,
          requests: m.requests.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)),
        };
      }),
    }));
    return { ok: true };
  };
}

/** Answers like POST /api/goals/celebrated would, then shows the goal celebrated. */
export function fixtureMark(change: Change): MarkCelebrated {
  return async (goalId, n) => {
    if (!navigator.onLine) return false;
    shopLog().marks.push(`${goalId}:${n}`);
    await new Promise((r) => setTimeout(r, 30));
    change((s) => ({
      ...s,
      goals: s.goals.map((g) => (g.id === goalId && g.n === n ? { ...g, celebrate: false } : g)),
    }));
    return true;
  };
}

/**
 * Answers like POST /api/completions would, a moment later, and keeps every batch it was sent on
 * window.__fwPosts so a test can count them. A check-off needing approval by a child waits for a parent.
 */
export function fixturePost(snapshot: BoardSnapshot) {
  const earners = new Set(snapshot.members.filter((m) => m.earnsRewards).map((m) => m.id));
  return async (events: CompletionEvent[]): Promise<Answer[]> => {
    // Offline, as a real post would be (the UI suite turns the network off).
    if (!navigator.onLine) throw new TypeError('Failed to fetch');
    const w = window as unknown as { __fwPosts?: CompletionEvent[][] };
    (w.__fwPosts ??= []).push(events);
    await new Promise((r) => setTimeout(r, 30));
    return events.map((e) => {
      const item = snapshot.occurrences.find((i) => i.id === e.occurrence_id)!;
      const doneBy = e.event_type === 'complete' ? [...(e.done_by ?? [])].sort() : [];
      const rewarded = doneBy.filter((id) => earners.has(id));
      return {
        id: e.id,
        result: 'recorded',
        reason: null,
        occurrence: {
          id: item.id,
          status:
            e.event_type === 'undo'
              ? 'scheduled'
              : item.requiresApproval && rewarded.length
                ? 'pending_approval'
                : 'completed',
          done_by: doneBy,
          rewarded,
          status_changed_at: new Date().toISOString(),
        },
      };
    });
  };
}

/**
 * Answers like POST /api/wishes would (WP-30), a moment later, and keeps each pin on window.__fwWishes
 * so a test can read them: a reward not in the shop is refused, and offline nothing is sent.
 */
export function fixturePin(snapshot: BoardSnapshot): PinWish {
  return async (memberId, itemId) => {
    if (!navigator.onLine) return 'offline';
    const w = window as unknown as { __fwWishes?: { member: string; item: string | null }[] };
    (w.__fwWishes ??= []).push({ member: memberId, item: itemId });
    await new Promise((r) => setTimeout(r, 30));
    return itemId === null || snapshot.shop.some((i) => i.id === itemId) ? 'saved' : 'refused';
  };
}
