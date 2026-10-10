import type { Answer, CompletionEvent } from '@/lib/outbox';
import type { BoardSnapshot } from '@/lib/snapshot';
import type { TodayItem } from '@/lib/today';

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
      },
      {
        id: ALEX,
        displayName: 'Alex',
        role: 'adult',
        avatarKey: 'owl',
        color: 'member-1',
        earnsRewards: false,
        points: null,
      },
      {
        id: SAM,
        displayName: 'Sam',
        role: 'adult',
        avatarKey: 'bear',
        color: 'member-2',
        earnsRewards: false,
        points: null,
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
