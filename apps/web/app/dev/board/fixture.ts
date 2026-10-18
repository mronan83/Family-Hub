import type { BoardGroceries } from '@/lib/board-groceries';
import {
  CATEGORIES as GROCERY_CATEGORIES,
  ITEMS as GROCERY_ITEMS,
  PEOPLE as GROCERY_PEOPLE,
  STORES as GROCERY_STORES,
} from '../groceries/fixture';
import type { Answer, CompletionEvent } from '@/lib/outbox';
import type { MarkCelebrated } from '@/lib/board-goals';
import type { AskFor, CancelAsk } from '@/lib/shop';
import { type BoardLayout, DEFAULT_LAYOUT } from '@/lib/board-layout';
import { NO_SLEEP, readBoardSleep } from '@/lib/board-sleep';
import type { BoardMealEntry, BoardMeals, MealSlot } from '@/lib/board-meals';
import type { LunchChild, LunchDay } from '@/lib/lunch';
import type { MenuItem } from '@/lib/menu/nutrislice';
import type { DayMark } from '@familywise/rules-engine';
import type { GoalPeriod } from '@/lib/goal-periods';
import type { BoardGoal, BoardMember, BoardSnapshot, BoardWeather } from '@/lib/snapshot';
import type { BoardCalendar, BoardEvent } from '@/lib/snapshot';
import type { TodayItem } from '@/lib/today';
import type { PinWish } from '@/lib/wishes';

// A made-up family's day for the board's Today (WP-11), dated today in New York, so the UI suite can
// check the screen, its taps and its states without a database. Names are invented.
export const TZ = 'America/New_York';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const ALEX = 'f1000000-0000-4000-8000-000000000003';
const SAM = 'f1000000-0000-4000-8000-000000000004';

/** A goal that doesn't repeat (WP-80): no periods. */
const ONCE = { repeat: 'none' as const, period: null, history: [] };

const day = (offset: number, today: string) =>
  new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * [BRD-04] The made-up weather (WP-45): partly cloudy, 54° and a high of 61° unless the page asks
 * for another sky (?weather=rain|snow|night|celsius), none (?weather=none: no place, or the source
 * failing), or yesterday's (?weather=yesterday: a board offline overnight).
 */
export function fixtureWeather(
  kind: string | undefined,
  today: string,
  now: Date,
): BoardWeather | null {
  if (kind === 'none') return null;
  const base: BoardWeather = {
    temperature: 54.3,
    high: 61.2,
    low: 48,
    code: 2,
    day: true,
    unit: 'fahrenheit',
    forDate: today,
    readAt: new Date(now.getTime() - 9 * 60_000).toISOString(),
  };
  if (kind === 'rain') return { ...base, code: 63, temperature: 49.6, high: 52.4 };
  if (kind === 'snow') return { ...base, code: 73, temperature: 28.1, high: 31.5, low: 22 };
  if (kind === 'night') return { ...base, code: 0, day: false, temperature: 46.2 };
  if (kind === 'celsius')
    return { ...base, unit: 'celsius', temperature: 12.4, high: 16.2, low: 8.9 };
  if (kind === 'yesterday') return { ...base, forDate: day(-1, today) };
  return base;
}

/**
 * [MEAL-06] The made-up family's week of meals (WP-28), from Sunday: today is a school day when Leo
 * buys (the school's menu says what) and Maya brings leftovers; tomorrow has no school; the weekend
 * none. Breakfast, a snack each and dinner today. ?meals=none: a board with no meals planned.
 */
export function fixtureMeals(kind: string | undefined, today: string): BoardMeals | null {
  if (kind === 'none') return null;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekFrom = day(-dow, today);
  const dates = Array.from({ length: 7 }, (_, i) => day(i - dow, today));
  let n = 0;
  const entry = (
    date: string,
    slot: MealSlot,
    name: string,
    o: Partial<BoardMealEntry> = {},
  ): BoardMealEntry => ({
    id: `meal-${++n}`,
    date,
    slot,
    memberIds: [],
    name,
    icon: null,
    notes: null,
    ...o,
  });
  const dinners = [
    'Roast chicken',
    'Chicken soup',
    'Tacos',
    'Fish pie',
    'Pizza and a movie',
    'Stir fry',
    'Pancakes',
  ];
  const entries: BoardMealEntry[] = [
    entry(today, 'breakfast', 'Porridge', { icon: 'breakfast' }),
    entry(today, 'snack', 'Apple slices', { icon: 'apple' }),
    entry(today, 'snack', 'Crackers', { memberIds: [MAYA] }),
    entry(today, 'lunch', 'Leftover spaghetti', { memberIds: [MAYA] }),
    // [MEAL-10] For some of the family (WP-62): Maya brings hers today, so Sam's stays under Lunch.
    entry(today, 'lunch', 'Ham wraps', { icon: 'sandwich', memberIds: [MAYA, SAM] }),
    ...dates
      .filter((d) => d !== today)
      .map((d, i) => entry(d, 'dinner', dinners[i]!, { icon: i === 2 ? 'pizza' : null })),
    entry(today, 'dinner', 'Spaghetti', { icon: 'cooking-pot', notes: 'Make extra' }),
    entry(today, 'dinner', 'Fish fingers', { memberIds: [LEO, MAYA] }),
    // Saturday's lunch, but never today's: on a Saturday it would be a fourth lunch today (D-110).
    ...(dates[6] !== today
      ? [entry(dates[6]!, 'lunch', 'Grilled cheese', { icon: 'sandwich' })]
      : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const diff = (d: string) => (Date.parse(d) - Date.parse(today)) / 86_400_000;
  const type = (d: string) =>
    d === today
      ? 'school_day'
      : diff(d) === 1
        ? 'no_school'
        : [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
          ? 'weekend'
          : 'school_day';
  // [MENU-06] The school's menu by section, as options (WP-64): two entrees, one with a side.
  const E = 'Choice of Entree';
  const F = 'Fruits & Vegetables offered';
  const M = 'Choice of Milk';
  const menus: Record<number, MenuItem[]> = {
    0: [
      { name: 'Cheese Pizza', section: E, option: 1 },
      { name: 'Turkey sandwich', section: E, option: 2 },
      { name: 'Pretzels', section: E, option: 2 },
      { name: 'Green Beans', section: F, option: 1 },
      { name: 'Orange', section: F, option: 2 },
      { name: '1% milk', section: M, option: 1 },
      { name: 'Chocolate milk', section: M, option: 2 },
    ],
    2: [
      { name: 'Chicken Nuggets', section: E, option: 1 },
      { name: 'Cheese quesadilla', section: E, option: 2 },
      { name: 'Carrot Sticks', section: F, option: 1 },
      { name: '1% milk', section: M, option: 1 },
    ],
    [-2]: [
      { name: 'Beef Tacos', section: E, option: 1 },
      { name: 'Corn', section: F, option: 1 },
      { name: '1% milk', section: M, option: 1 },
    ],
  };
  // lunch_week() gives the menu on every day with a school lunch, buy or bring (WP-64).
  const lunchDay = (d: string, buys: (k: number) => boolean, menu: boolean): LunchDay => {
    const school = type(d) === 'school_day';
    const mode = school ? (buys(diff(d)) ? 'buy' : 'bring') : null;
    const items = menus[diff(d)];
    return {
      date: d,
      dayType: type(d),
      mode,
      changed: false,
      menu: mode && menu && items ? { items, noService: false, note: null } : null,
    };
  };
  const lunch: LunchChild[] = [
    {
      memberId: LEO,
      usual: {},
      menuSourceId: 'menu-maple',
      menuName: 'Maple Elementary',
      days: dates.map((d) => lunchDay(d, (k) => k % 2 === 0, true)),
    },
    {
      memberId: MAYA,
      usual: {},
      menuSourceId: null,
      days: dates.map((d) => lunchDay(d, (k) => k === 2, false)),
    },
  ];
  return { weekFrom, entries, lunch };
}

export function fixtureSnapshot(
  today: string,
  now: Date,
  layout?: BoardLayout,
  weather: BoardWeather | null = fixtureWeather(undefined, today, now),
  meals: BoardMeals | null = fixtureMeals(undefined, today),
): BoardSnapshot {
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
    range: { from: day(-1, today), to: day(21, today) },
    household: { id: 'h', name: 'Demo family', timezone: TZ, weekStart: 0, undoWindowSeconds: 120 },
    device: {
      id: 'd',
      name: 'Kitchen',
      theme: 'auto',
      textSize: 'standard',
      sleep: { ...NO_SLEEP },
    },
    schoolDays: null,
    // [BRD-05] The household's layout, the defaults unless the page says otherwise (WP-35).
    layout: { household: layout ?? structuredClone(DEFAULT_LAYOUT), board: null },
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
        // One chore everyone does their own: an occurrence each, the same chore (WP-43).
        choreId: 'c-bed',
        title: 'Make bed',
        icon: 'chore-bed',
        dueTime: '07:30',
        memberId: MAYA,
        assignees: [MAYA],
      }),
      item('bed-leo', {
        choreId: 'c-bed',
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
        description: 'Reading log and spelling words, then show a grown-up.',
        icon: 'chore-homework',
        dueTime: '16:00',
        assignees: [MAYA],
        points: 10,
        requiresApproval: true,
      }),
      item('dog', {
        title: 'Feed the dog',
        description: 'One scoop of dry food, and fresh water in the blue bowl.',
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
        ...ONCE,
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
        ...ONCE,
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
        ...ONCE,
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
        ...ONCE,
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
    calendar: fixtureCalendar(today, now, day(-1, today), day(21, today)),
    weather,
    meals,
  };
}

/**
 * [RWD-15][RWD-16] Repeating goals (WP-80, ?repeating=going|missed|won): Maya's "Homework home every
 * school day", each week from its Monday, in the state asked for, today the day it is and Friday a day
 * off school; Leo's reading, with one miss allowed, missed this week. Each has its last weeks.
 */
export function withRepeating(
  s: BoardSnapshot,
  kind: 'going' | 'missed' | 'won',
  now: Date,
): BoardSnapshot {
  const today = s.today;
  // The week from its Monday; today is the day it is, and Friday is a day off school.
  const idx = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = day(-idx, today);
  const week = (dayMarks: DayMark[]): GoalPeriod['days'] =>
    dayMarks.map((mark, i) => ({
      date: day(i, start),
      mark,
      dayType: mark === 'none' ? (i === 4 ? 'no_school' : 'weekend') : null,
    }));
  /** Each day's mark: before today done (one missed when asked), today and later as they stand. */
  const marks = (state: 'going' | 'missed' | 'won', missedAt = Math.max(0, idx - 1)): DayMark[] =>
    [0, 1, 2, 3, 4, 5, 6].map((i) =>
      i >= 4
        ? 'none'
        : state === 'won'
          ? 'done'
          : state === 'missed' && i === missedAt && i <= idx
            ? 'missed'
            : i < idx
              ? 'done'
              : i === idx
                ? 'today'
                : 'later',
    );
  const period = (dayMarks: DayMark[], outcome: GoalPeriod['outcome'], misses = 0): GoalPeriod => {
    const days = week(dayMarks)!;
    return {
      start,
      end: day(6, start),
      outcome,
      nextStart: day(7, start),
      daysDue: days.filter((d) => d.mark !== 'none').length,
      daysDone: days.filter((d) => d.mark === 'done').length,
      daysMissed: days.filter((d) => d.mark === 'missed').length,
      missesAllowed: misses,
      days,
    };
  };
  const past = (outcomes: GoalPeriod['outcome'][]) =>
    outcomes.map((outcome, i) => ({
      start: day(-7 * (outcomes.length - i), start),
      end: day(6 - 7 * (outcomes.length - i), start),
      outcome,
    }));
  const homework = {
    going: period(marks('going'), 'open'),
    missed: period(marks('missed'), 'missed'),
    won: period(marks('won'), 'won'),
  }[kind];
  const history = {
    going: past(['won', 'won', 'missed', 'won']),
    missed: past(['won', 'won', 'missed', 'missed']),
    won: past(['won', 'won', 'won', 'won']),
  }[kind];
  const goal = (
    o: Partial<BoardGoal> & Pick<BoardGoal, 'id' | 'title' | 'memberId'>,
  ): BoardGoal => ({
    icon: 'backpack',
    photo: null,
    status: 'active',
    n: 0,
    achievedAt: null,
    celebrate: false,
    endDate: null,
    logic: 'all',
    pct: 0,
    rules: [],
    repeat: 'week',
    period: null,
    history: [],
    pays: 10,
    ...o,
  });
  const reading = period(marks('missed', 0), 'missed', 1);
  return {
    ...s,
    goals: [
      goal({
        id: 'g-homework',
        memberId: MAYA,
        title: 'Homework home',
        n: kind === 'won' ? 4 : 3,
        achievedAt: kind === 'won' ? now.toISOString() : null,
        pct: kind === 'won' ? 100 : 75,
        period: homework,
        history: [...history, { start, end: homework.end, outcome: homework.outcome }],
        rules: [
          {
            id: 'gr-homework',
            type: 'DAYS_DUE',
            target: homework.daysDue ?? 0,
            current: homework.daysDone ?? 0,
            pct: kind === 'won' ? 100 : 75,
            met: kind === 'won',
            streak: null,
            best: null,
          },
        ],
      }),
      goal({
        id: 'g-reading',
        memberId: LEO,
        title: 'Reading',
        icon: 'book-open',
        n: 2,
        pct: 25,
        period: reading,
        history: [
          ...past(['won', 'missed', 'neutral', 'won']),
          { start, end: reading.end, outcome: 'missed' },
        ],
        rules: [
          {
            id: 'gr-reading',
            type: 'DAYS_DUE',
            target: 3,
            current: 1,
            pct: 33,
            met: false,
            streak: null,
            best: null,
          },
        ],
      }),
      ...s.goals.filter((g) => g.memberId === null),
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

export type Change = (f: (s: BoardSnapshot) => BoardSnapshot) => void;
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
 * [WP-110] Changes the stand-in's database holds that the board hasn't heard of (?missed=1): `hold`
 * keeps one, and the board's own read (`read`) shows them all.
 */
export function unreadChanges() {
  const held: ((s: BoardSnapshot) => BoardSnapshot)[] = [];
  return {
    hold: ((f) => void held.push(f)) as Change,
    read(change: Change) {
      const changes = held.splice(0);
      if (changes.length) change((s) => changes.reduce((x, f) => f(x), s));
    },
  };
}

/**
 * Answers like POST /api/redemptions would (WP-20), a moment later, and then shows the request in the
 * snapshot as Realtime would. Each ask is kept on window.__fwShop; a reward none are left of is
 * refused (window.__fwRefuse refuses anything, with that reason), and offline nothing is sent.
 * `stored` is where the request goes: the snapshot at once, or (WP-110, ?missed=1) only the
 * board's next read of it, as when Realtime never says it changed.
 */
export function fixtureAsk(snapshot: BoardSnapshot, change: Change, stored = change): AskFor {
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
    stored((s) =>
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

/** An instant from a New York date and wall-clock time ("17:00"), across the clock changes. */
function nyAt(date: string, hm: string): string {
  const guess = new Date(`${date}T${hm}:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')!
    .value.replace('GMT', '');
  return new Date(`${date}T${hm}:00${offset || '+00:00'}`).toISOString();
}

/**
 * [CAL-04][CAL-09] The made-up family's calendars around today (WP-23): Family (everyone), School
 * (Maya's and Leo's, WP-50) and Work (Alex's); a weekly swim at 5 pm, a three-day visit, a day's test, a late flight past
 * midnight, a moved dentist appointment, places for some (WP-52). `busy` adds 40 more this month,
 * eight on one day, for the month view's "+N more"; `full` (WP-52) adds three more all-day events
 * today, for a day's "+N", and an appointment tomorrow beside the meeting. Only events in
 * [from, to] are returned, as board_calendar() would.
 */
export function fixtureCalendar(
  today: string,
  now: Date,
  from: string,
  to: string,
  busy = false,
  full = false,
): BoardCalendar {
  const synced = new Date(now.getTime() - 5 * 60_000).toISOString();
  const calendars: BoardCalendar['calendars'] = [
    {
      id: 'cal-family',
      name: 'Family',
      color: 'member-6',
      memberIds: [],
      status: 'ok',
      lastSuccessAt: synced,
    },
    {
      id: 'cal-school',
      name: 'School',
      color: 'member-3',
      memberIds: [MAYA, LEO],
      status: 'ok',
      lastSuccessAt: synced,
    },
    {
      id: 'cal-work',
      name: 'Work',
      color: 'member-1',
      memberIds: [ALEX],
      status: 'ok',
      lastSuccessAt: synced,
    },
  ];
  const timed = (
    id: string,
    cal: string,
    title: string,
    offset: number,
    start: string,
    end: string,
    changed = false,
    endOffset = offset,
    location: string | null = null,
  ): BoardEvent => ({
    id,
    calendarId: cal,
    title,
    allDay: false,
    changed,
    start: nyAt(day(offset, today), start),
    end: nyAt(day(endOffset, today), end),
    startDate: day(offset, today),
    endDate: day(endOffset, today),
    location,
  });
  const allDay = (
    id: string,
    cal: string,
    title: string,
    offset: number,
    days = 1,
  ): BoardEvent => ({
    id,
    calendarId: cal,
    title,
    allDay: true,
    changed: false,
    start: nyAt(day(offset, today), '00:00'),
    end: nyAt(day(offset + days, today), '00:00'),
    startDate: day(offset, today),
    endDate: day(offset + days - 1, today),
  });
  const events: BoardEvent[] = [
    ...[-7, 0, 7, 14, 21, 28].map((w) =>
      timed(`swim${w}`, 'cal-family', 'Swim', w, '17:00', '18:00', false, w, 'Community pool'),
    ),
    allDay('spelling', 'cal-school', 'Spelling test', 0),
    timed('dentist', 'cal-family', 'Dentist', 1, '09:30', '10:15', true, 1, '12 Made-up Street'),
    timed('standup', 'cal-work', 'Team meeting', 1, '14:00', '15:00'),
    allDay('visit', 'cal-family', 'Grandparents visit', 2, 3),
    allDay('picture', 'cal-school', 'Picture day', 3),
    timed('book', 'cal-family', 'Book club', 3, '19:30', '21:00'),
    timed('flight', 'cal-family', 'Late flight', 5, '22:30', '01:00', false, 6),
    timed('soccer', 'cal-school', 'Soccer', -1, '10:00', '11:30'),
  ];
  if (full) {
    events.push(
      allDay('library', 'cal-school', 'Library books due', 0),
      allDay('columbus', 'cal-family', 'Columbus Day', 0),
      allDay('grandma', 'cal-family', 'Grandma’s birthday', 0),
      timed('ortho', 'cal-school', 'Orthodontist', 1, '14:30', '15:15'),
    );
  }
  if (busy) {
    const first = `${today.slice(0, 7)}-01`;
    const offset = Math.round(
      (Date.parse(`${first}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
    );
    for (let n = 0; n < 40; n++) {
      // Eight on the 10th, the rest one a day through the month.
      const d = n < 8 ? offset + 9 : offset + ((n - 8) % 28);
      events.push(
        timed(
          `busy${n}`,
          n % 2 ? 'cal-family' : 'cal-school',
          `Practice ${n + 1}`,
          d,
          `${String(8 + (n % 10)).padStart(2, '0')}:00`,
          `${String(9 + (n % 10)).padStart(2, '0')}:00`,
        ),
      );
    }
  }
  return {
    from,
    to,
    calendars,
    events: events
      .filter((e) => e.startDate <= to && e.endDate >= from)
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          Number(b.allDay) - Number(a.allDay) ||
          a.start.localeCompare(b.start),
      ),
  };
}

/**
 * [MEAL-09][MEAL-11] The made-up family's lunches for Lunches (WP-49), as lunch_week() and POST
 * /api/lunches would answer, kept in memory. Leo's school days each have Maple Elementary's menu:
 * his Monday is Buy with his picks, Tuesday Bring with a change to Buy waiting for a parent,
 * Wednesday Buy with nothing picked yet, Thursday Buy, which Sam kept when Leo asked for Bring, and
 * Friday Bring. Maya brings every day and has no menu. Days before today are locked.
 */
export function fixtureLunches(today: string) {
  const E = 'Choice of Entree';
  const F = 'Fruits & Vegetables offered';
  const M = 'Choice of Milk';
  const items: MenuItem[] = [
    { name: 'Cheese pizza', section: E, option: 1 },
    { name: 'Chicken wrap', section: E, option: 2 },
    { name: 'Tortilla chips', section: E, option: 2 },
    { name: 'Apple slices', section: F, option: 1 },
    { name: 'Baby carrots', section: F, option: 2 },
    { name: 'Grapes', section: F, option: 3 },
    { name: '1% milk', section: M, option: 1 },
    { name: 'Chocolate milk', section: M, option: 2 },
  ];
  const picks = (entree: number, fruit: number[], milk: number) => [
    { section: E, options: [entree], names: [entree === 1 ? 'Cheese pizza' : 'Chicken wrap'] },
    {
      section: F,
      options: fruit,
      names: fruit.map((f) => ['Apple slices', 'Baby carrots', 'Grapes'][f - 1]!),
    },
    { section: M, options: [milk], names: [milk === 1 ? '1% milk' : 'Chocolate milk'] },
  ];
  // What the database holds, by child and date: the day, and a request.
  const held = new Map<string, LunchDay>();
  const key = (m: string, d: string) => `${m}:${d}`;
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const base = (member: string, d: string): LunchDay => {
    const school = dow(d) >= 1 && dow(d) <= 5;
    const leo = member === LEO;
    const k = dow(d);
    const mode = !school ? null : leo && [1, 3, 4].includes(k) ? 'buy' : 'bring';
    const open = school && d > today;
    const day: LunchDay = {
      date: d,
      dayType: school ? 'school_day' : 'weekend',
      mode,
      changed: false,
      menu: leo && mode ? { items, noService: false, note: null } : null,
      open,
      openUntil: null,
      choices: mode === 'buy' ? (leo && k === 1 ? picks(2, [1, 3], 1) : []) : null,
      request: null,
      byBoard: false,
    };
    if (leo && k === 2 && open)
      day.request = {
        id: `req-${d}`,
        mode: 'buy',
        choices: picks(1, [1, 2], 1),
        status: 'waiting',
        requestedAt: `${today}T23:04:00Z`,
        decidedBy: null,
      };
    if (leo && k === 4 && open)
      day.request = {
        id: `req-${d}`,
        mode: 'bring',
        choices: [],
        status: 'kept',
        requestedAt: `${today}T23:09:00Z`,
        decidedBy: 'Sam',
      };
    return day;
  };
  const get = (member: string, d: string) => held.get(key(member, d)) ?? base(member, d);
  const load = async (from: string): Promise<LunchChild[] | null> => {
    if (!navigator.onLine) return null;
    await new Promise((r) => setTimeout(r, 30));
    const dates = Array.from({ length: 7 }, (_, i) => day(i, from));
    return [
      {
        memberId: LEO,
        usual: { mon: 'buy', wed: 'buy', thu: 'buy' },
        menuSourceId: 'menu-maple',
        menuName: 'Maple Elementary',
        days: dates.map((d) => get(LEO, d)),
      },
      { memberId: MAYA, usual: {}, menuSourceId: null, days: dates.map((d) => get(MAYA, d)) },
    ];
  };
  const ask = async (
    member: string,
    date: string,
    mode: 'buy' | 'bring',
    choices: LunchDay['choices'] & object,
  ) => {
    if (!navigator.onLine) return { ok: false as const, offline: true as const };
    const d = get(member, date);
    if (!d.open) return { ok: false as const, reason: 'locked' };
    const same =
      mode === d.mode &&
      (mode === 'bring' ||
        JSON.stringify(choices.map((c) => [c.section, c.options])) ===
          JSON.stringify((d.choices ?? []).map((c) => [c.section, c.options])));
    held.set(key(member, date), {
      ...d,
      request: same
        ? null
        : {
            id: `req-${date}`,
            mode,
            choices: mode === 'buy' ? choices : [],
            status: 'waiting',
            requestedAt: new Date().toISOString(),
            decidedBy: null,
          },
    });
    return { ok: true as const, waiting: !same };
  };
  const seen = async (member: string) => {
    for (const [k, d] of held)
      if (k.startsWith(member) && d.request?.status === 'kept')
        held.set(k, { ...d, request: null });
    for (let i = 0; i < 14; i++) {
      const d = get(member, day(i, today));
      if (d.request?.status === 'kept') held.set(key(member, d.date), { ...d, request: null });
    }
    return true;
  };
  return { load, ask, seen };
}

/** [MEAL-09] Leo's "Pick next week's lunches", an item that opens Lunches (WP-49). */
export function withLunchItem(s: BoardSnapshot): BoardSnapshot {
  return {
    ...s,
    occurrences: [
      ...s.occurrences,
      {
        id: 'lunches-leo',
        choreId: 'c-lunches',
        title: 'Pick next week’s lunches',
        icon: 'lunch',
        kind: 'task',
        dueDate: s.today,
        dueTime: null,
        memberId: LEO,
        assignees: [LEO],
        status: 'scheduled',
        doneBy: [],
        rewarded: [],
        points: 0,
        requiresApproval: false,
        checkedAt: null,
        opens: 'lunches',
      },
    ],
  };
}

/** [DEV-07] Kitchen's sleep and wake from the mockup (WP-34, D-116): missed only while awake. */
export const KITCHEN_SLEEP = readBoardSleep({
  missed: 'awake',
  schedule: {
    school: { sleep: '21:30', wake: '06:30' },
    weekend: { sleep: '22:30', wake: '07:30' },
  },
  idle_minutes: 15,
});

/**
 * [RWD-17][RWD-18] Goals done by a time and paid in steps (WP-81, ?steps=going|won|weighted), for
 * Maya, the week from its Monday, the clock held on a Thursday by the UI suite: "Homework before 6
 * pm" with steps 20, 10 and 5 by days missed, going with Wednesday ticked late, or won at a lower
 * step with Friday a day off school; and "School week", homework 60% and reading 40%, in steps by %.
 */
export function withSteps(s: BoardSnapshot, kind: 'going' | 'won' | 'weighted'): BoardSnapshot {
  const idx = (new Date(`${s.today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = day(-idx, s.today);
  const marks: Record<typeof kind, DayMark[]> = {
    going: ['done', 'done', 'late', 'today', 'later', 'none', 'none'],
    won: ['done', 'late', 'done', 'done', 'none', 'none', 'none'],
    weighted: ['done', 'done', 'missed', 'today', 'none', 'none', 'none'],
  };
  const days = marks[kind].map((mark, i) => ({
    date: day(i, start),
    mark,
    dayType: mark === 'none' ? (i === 4 ? 'no_school' : 'weekend') : null,
  }));
  const due = days.filter((d) => d.mark !== 'none').length;
  const period: GoalPeriod = {
    start,
    end: day(6, start),
    outcome: kind === 'won' ? 'won' : 'open',
    nextStart: day(7, start),
    daysDue: due,
    daysDone: days.filter((d) => d.mark === 'done').length,
    daysMissed: days.filter((d) => d.mark === 'missed' || d.mark === 'late').length,
    missesAllowed: 2,
    days,
    step: kind === 'won' ? 1 : kind === 'weighted' ? 1 : null,
    stepBest: kind === 'weighted' ? 0 : 1,
  };
  const past = [-28, -21, -14, -7].map((n, i) => ({
    start: day(n, start),
    end: day(n + 6, start),
    outcome: (i === 2 ? 'missed' : 'won') as GoalPeriod['outcome'],
    step: i === 2 ? null : i === 1 ? 0 : 1,
  }));
  const weighted = kind === 'weighted';
  const goal: BoardGoal = {
    id: 'g-steps',
    memberId: MAYA,
    title: weighted ? 'School week' : 'Homework before 6 pm',
    icon: 'backpack',
    photo: null,
    status: 'active',
    n: 3,
    achievedAt: null,
    celebrate: false,
    endDate: null,
    logic: 'all',
    pct: weighted ? 77 : 60,
    repeat: 'week',
    period,
    history: [...past, { start, end: period.end, outcome: period.outcome, step: period.step }],
    pays: 20,
    steps: weighted
      ? [
          { at: 75, amount: 10 },
          { at: 50, amount: 5 },
        ]
      : [
          { misses: 1, amount: 10 },
          { misses: 2, amount: 5 },
        ],
    rules: weighted
      ? [
          {
            id: 'gr-homework',
            type: 'DAYS_DUE',
            target: 3,
            current: 2,
            pct: 67,
            met: false,
            streak: null,
            best: null,
            weight: 60,
            onTime: '18:00',
          },
          {
            id: 'gr-reading',
            type: 'COUNT',
            target: 5,
            current: 4,
            pct: 80,
            met: false,
            streak: null,
            best: null,
            weight: 40,
            onTime: null,
          },
        ]
      : [
          {
            id: 'gr-homework',
            type: 'DAYS_DUE',
            target: 3,
            current: period.daysDone ?? 0,
            pct: 60,
            met: false,
            streak: null,
            best: null,
            weight: null,
            onTime: '18:00',
          },
        ],
  };
  return { ...s, goals: [goal, ...s.goals.filter((g) => g.memberId !== MAYA)] };
}

/**
 * [RWD-19][RWD-20] Perfect weeks and a family goal every child meets (WP-82, ?perfect=going|missed|won),
 * the week from its Monday, the clock held on a Thursday by the UI suite: the family's "Everyone's
 * homework home", every child meets it, 20 points each: going with Leo having nothing due this week,
 * missed on Leo's Tuesday, or won by both; and Maya's "3 perfect weeks in a row" counting her homework
 * weeks, 1 of 3 so far with this week going.
 */
export function withPerfect(s: BoardSnapshot, kind: 'going' | 'missed' | 'won'): BoardSnapshot {
  const idx = (new Date(`${s.today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = day(-idx, s.today);
  const days = (marks: DayMark[]): GoalPeriod['days'] =>
    marks.map((mark, i) => ({
      date: day(i, start),
      mark,
      dayType: mark === 'none' ? (i === 4 ? 'no_school' : 'weekend') : null,
    }));
  const going: DayMark[] = ['done', 'done', 'done', 'today', 'none', 'none', 'none'];
  const leo: Record<typeof kind, DayMark[]> = {
    going: ['none', 'none', 'none', 'none', 'none', 'none', 'none'],
    missed: ['done', 'missed', 'done', 'today', 'none', 'none', 'none'],
    won: ['done', 'done', 'done', 'done', 'none', 'none', 'none'],
  };
  const maya = kind === 'won' ? leo.won : going;
  const child = (
    memberId: string,
    marks: DayMark[],
    outcome: GoalPeriod['outcome'],
  ): NonNullable<GoalPeriod['children']>[number] => {
    const d = days(marks)!;
    const due = d.filter((x) => x.mark !== 'none').length;
    return {
      memberId,
      contributes: due > 0,
      outcome,
      pct: due ? Math.round((d.filter((x) => x.mark === 'done').length / due) * 100) : 0,
      daysDue: due,
      daysDone: d.filter((x) => x.mark === 'done').length,
      daysMissed: d.filter((x) => x.mark === 'missed').length,
      days: d,
    };
  };
  const outcome: GoalPeriod['outcome'] = kind === 'going' ? 'open' : kind;
  const period: GoalPeriod = {
    start,
    end: day(6, start),
    outcome,
    nextStart: day(7, start),
    daysDue: null,
    daysDone: null,
    daysMissed: null,
    missesAllowed: 0,
    days: null,
    children: [
      child(MAYA, maya, kind === 'won' ? 'won' : 'open'),
      child(LEO, leo[kind], kind === 'going' ? 'neutral' : kind === 'won' ? 'won' : 'missed'),
    ],
  };
  const past = (outcomes: GoalPeriod['outcome'][]) =>
    outcomes.map((o, i) => ({
      start: day(-7 * (outcomes.length - i), start),
      end: day(6 - 7 * (outcomes.length - i), start),
      outcome: o,
    }));
  const family: BoardGoal = {
    id: 'g-everyone',
    memberId: null,
    title: 'Everyone’s homework home',
    icon: 'family',
    photo: null,
    status: 'active',
    n: kind === 'won' ? 3 : 2,
    achievedAt: null,
    celebrate: false,
    endDate: null,
    logic: 'all',
    pct: kind === 'won' ? 100 : 75,
    repeat: 'week',
    period,
    history: [...past(['won', 'missed', 'neutral', 'won']), { start, end: period.end, outcome }],
    pays: 20,
    eachChild: true,
    rules: [
      {
        id: 'gr-everyone',
        type: 'DAYS_DUE',
        target: 4,
        current: 3,
        pct: 75,
        met: false,
        streak: null,
        best: null,
      },
    ],
  };
  const perfect: BoardGoal = {
    id: 'g-perfect',
    memberId: MAYA,
    title: '3 perfect weeks in a row',
    icon: 'snack',
    photo: null,
    status: 'active',
    n: 0,
    achievedAt: null,
    celebrate: false,
    endDate: null,
    logic: 'all',
    pct: 33,
    repeat: 'none',
    period: null,
    history: [],
    pays: null,
    rules: [
      {
        id: 'gr-perfect',
        type: 'PERIODS_WON',
        target: 3,
        current: 1,
        pct: 33,
        met: false,
        streak: 1,
        best: 1,
        inARow: true,
        source: {
          id: 'g-homework',
          title: 'Homework home',
          icon: 'backpack',
          repeat: 'week',
          history: [...past(['won', 'missed', 'won']), { start, end: period.end, outcome: 'open' }],
        },
      },
    ],
  };
  return {
    ...s,
    goals: [perfect, ...s.goals.filter((g) => g.memberId !== MAYA && g.memberId !== null), family],
  };
}

/**
 * [MEAL-18] The made-up grocery list on the board (WP-104), as the admin page's fixture holds it,
 * the children's asks pointed at this board's Maya and Leo: 'busy', 'empty' (had items, none now),
 * or none (the household has never had one, so the rail has no Groceries).
 */
export function fixtureGroceries(which: string | undefined): BoardGroceries | null {
  if (which !== '1' && which !== 'busy' && which !== 'empty') return null;
  const people = new Map([
    [GROCERY_PEOPLE.find((p) => p.name === 'Leo')!.id, LEO],
    [GROCERY_PEOPLE.find((p) => p.name === 'Maya')!.id, MAYA],
  ]);
  const items =
    which === 'empty'
      ? []
      : GROCERY_ITEMS.filter((i) => i.status === 'open').map((i) => ({
          ...i,
          reasons: i.reasons.map((r) => ({
            ...r,
            memberId: r.memberId ? (people.get(r.memberId) ?? r.memberId) : null,
          })),
        }));
  return { ever: true, categories: GROCERY_CATEGORIES, stores: GROCERY_STORES, items };
}
