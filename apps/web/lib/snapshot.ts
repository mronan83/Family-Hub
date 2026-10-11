import type { AvatarKey, MemberColor, ThemeOverride } from '@familywise/ui';
import type { OccurrenceStatus, RuleType } from '@familywise/rules-engine';
import type { LedgerEntry, LedgerEntryType } from './points';
import type { RedemptionStatus } from './rewards';
import type { TodayItem } from './today';
import { type BoardLayout, DEFAULT_LAYOUT, readLayout } from './board-layout';

/**
 * [DEV-05] What `public.board_snapshot()` returns (02 §4.6): the one read a paired board makes, and
 * the unit it will cache offline (WP-13). Members with their points, and today's items (WP-11);
 * later work packages add slices.
 */
export interface BoardSnapshot {
  v: 1;
  fetchedAt: string;
  /** Household-local date, YYYY-MM-DD. */
  today: string;
  range: { from: string; to: string };
  household: {
    id: string;
    name: string;
    timezone: string;
    weekStart: number;
    /** How long a check-off can be undone on the board (US-305). */
    undoWindowSeconds: number;
  };
  device: { id: string; name: string; theme: ThemeOverride };
  /** [BRD-05] The home screen's layout: the household's, and this board's own if it has one (D-67). */
  layout: { household: BoardLayout; board: BoardLayout | null };
  members: BoardMember[];
  /** [BRD-01] Today's family-visible items and the open overdue tasks (WP-11). */
  occurrences: TodayItem[];
  /** [PTS-03][PTS-06] The rewards in the shop now: to save for (WP-30) and to ask for (WP-20). */
  shop: BoardShopItem[];
  /** [RWD-07] The goals in play, each child's then the family's (WP-20). */
  goals: BoardGoal[];
  /** [CAL-04][CAL-05] The calendars this board shows and their events over the window (WP-23). */
  calendar: BoardCalendar | null;
  /**
   * [BRD-04] The weather at the household's place (WP-45, D-69): the last good read while the last
   * read worked and is recent; null when there is no place, the source is failing, or none yet.
   */
  weather: BoardWeather | null;
}

/** [BRD-04] The temperature now, today's high and low, and the sky, in the household's unit. */
export interface BoardWeather {
  temperature: number;
  high: number;
  low: number;
  /** The WMO weather code (0 clear … 99 thunderstorm with hail). */
  code: number;
  /** Day or night at the place, for a sun or a moon. */
  day: boolean;
  unit: 'fahrenheit' | 'celsius';
  /** The place's date the high and low are for: a board offline overnight shows none. */
  forDate: string;
  readAt: string;
}

/** [CAL-05] A calendar a board shows: its name, color and whose it is, and how its sync is going. */
export interface BoardCalendarSource {
  id: string;
  name: string;
  color: MemberColor;
  memberId: string | null;
  status: 'pending' | 'ok' | 'error' | 'disabled';
  lastSuccessAt: string | null;
}

/** [CAL-04][CAL-07] One event on a board's calendar, all-day ones by household-local dates. */
export interface BoardEvent {
  id: string;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** Instants (ISO); an all-day event's are its days' midnights in the household's zone. */
  start: string;
  end: string;
  /** Household-local, YYYY-MM-DD; the end is the last day it covers. */
  startDate: string;
  endDate: string;
  /** Moved or edited on its own in Apple Calendar. */
  changed: boolean;
}

/** What `board_calendar(from, to)` returns: a range of dates, its calendars and its events. */
export interface BoardCalendar {
  from: string;
  to: string;
  calendars: BoardCalendarSource[];
  events: BoardEvent[];
}

/** A reward in the shop, as the board shows it. */
export interface BoardShopItem {
  id: string;
  title: string;
  icon: string;
  cost: number;
  /** Its photo's path in the private rewards bucket (WP-20); the board reads it through a signed link. */
  photo?: string | null;
  /** How many are still to be had; null for as many as asked for (WP-20). */
  left?: number | null;
}

/** [PTS-04] One of a child's requests: open, or settled in the last two days (WP-20). */
export interface BoardRequest {
  id: string;
  itemId: string;
  title: string;
  icon: string;
  cost: number;
  status: RedemptionStatus;
  /** When it last changed: asked, decided, given or cancelled. */
  at: string;
}

/** [RWD-07] A goal in play, as WP-19's progress pipeline last worked it out. */
export interface BoardGoal {
  id: string;
  /** Null for a family goal. */
  memberId: string | null;
  title: string;
  icon: string;
  photo: string | null;
  status: 'active' | 'achieved';
  /** Which time it was reached (achievement n); 0 while never reached. */
  n: number;
  achievedAt: string | null;
  /** [RWD-08] Reached and not yet celebrated on any board. */
  celebrate: boolean;
  endDate: string | null;
  logic: 'all' | 'any';
  pct: number;
  rules: BoardGoalRule[];
}

export interface BoardGoalRule {
  id: string;
  type: RuleType;
  target: number;
  current: number;
  pct: number;
  met: boolean;
  /** A streak rule's run now and best; null for the others. */
  streak: number | null;
  best: number | null;
}

export interface BoardMember {
  id: string;
  displayName: string;
  role: 'child' | 'adult';
  avatarKey: AvatarKey | null;
  color: MemberColor;
  earnsRewards: boolean;
  /** [PTS-02] For a member who earns rewards: their balance and latest entries; otherwise null. */
  points: BoardPoints | null;
  /** [RWD-05] For a member who earns rewards: their run as of the last closed day (WP-17). */
  streak: BoardStreak | null;
  /** [PTS-06] For a member who earns rewards: the reward they're saving for, if any (WP-30). */
  wish: BoardShopItem | null;
  /**
   * [PTS-04] For a member who earns rewards: what they can still ask for, their balance less the
   * requests waiting for a parent (WP-20); otherwise null.
   */
  available: number | null;
  /** [PTS-04] Their requests, newest first (WP-20). */
  requests: BoardRequest[];
  /** [PTS-04] The rewards they've asked for as often as allowed this week (WP-20). */
  limited: string[];
}

/** The run going as of the last closed day, and the best good run (streak_segment). */
export interface BoardStreak {
  kind: 'good' | 'bad' | null;
  length: number;
  best: number;
}

export interface BoardPoints {
  /** Below zero means points to earn back (PTS-02). */
  balance: number;
  /** The five latest entries, newest first. */
  recent: Omit<LedgerEntry, 'by'>[];
}

type Json = Record<string, unknown>;

const ENTRY_TYPES: readonly LedgerEntryType[] = [
  'earn',
  'reversal',
  'bonus',
  'spend',
  'refund',
  'adjustment',
];

const STATUSES: readonly OccurrenceStatus[] = [
  'scheduled',
  'completed',
  'pending_approval',
  'approved',
  'rejected',
  'skipped',
  'missed',
];

const isObject = (x: unknown): x is Json =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (o: Json, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string') throw new Error(`snapshot: ${k} is not text`);
  return v;
};

function readPoints(p: unknown): BoardPoints | null {
  if (!isObject(p)) return null;
  if (typeof p.balance !== 'number' || !Array.isArray(p.recent)) {
    throw new Error('snapshot: points are not a balance and a list');
  }
  return {
    balance: p.balance,
    recent: p.recent.map((e) => {
      if (!isObject(e) || !ENTRY_TYPES.includes(e.type as LedgerEntryType)) {
        throw new Error('snapshot: unknown points entry');
      }
      return {
        id: str(e, 'id'),
        type: e.type as LedgerEntryType,
        amount: Number(e.amount),
        at: str(e, 'at'),
        label: typeof e.label === 'string' ? e.label : null,
      };
    }),
  };
}

/** A snapshot from before WP-17 has no streak; an unknown kind reads as no run. */
function readStreak(x: unknown): BoardStreak | null {
  if (!isObject(x)) return null;
  return {
    kind: x.kind === 'good' || x.kind === 'bad' ? x.kind : null,
    length: Number(x.length) || 0,
    best: Number(x.best) || 0,
  };
}

/** A reward from the snapshot (the shop, or a member's wish); null when it isn't one. */
function readShopItem(x: unknown): BoardShopItem | null {
  if (!isObject(x) || typeof x.title !== 'string') return null;
  const id = typeof x.id === 'string' ? x.id : typeof x.item_id === 'string' ? x.item_id : null;
  if (!id) return null;
  const item: BoardShopItem = {
    id,
    title: x.title,
    icon: typeof x.icon === 'string' ? x.icon : 'gift',
    cost: Number(x.cost) || 0,
  };
  // The shop's own facts (WP-20); a wish has neither.
  if ('photo' in x) item.photo = typeof x.photo === 'string' ? x.photo : null;
  if ('left' in x) item.left = typeof x.left === 'number' ? x.left : null;
  return item;
}

const REQUEST_STATUSES: readonly RedemptionStatus[] = [
  'requested',
  'approved',
  'denied',
  'fulfilled',
  'cancelled',
];

/** A member's requests (WP-20); one in a state this build doesn't know is left out. */
function readRequests(x: unknown): BoardRequest[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((r) => {
    if (!isObject(r) || !REQUEST_STATUSES.includes(r.status as RedemptionStatus)) return [];
    return [
      {
        id: str(r, 'id'),
        itemId: str(r, 'item_id'),
        title: str(r, 'title'),
        icon: typeof r.icon === 'string' ? r.icon : 'gift',
        cost: Number(r.cost) || 0,
        status: r.status as RedemptionStatus,
        at: str(r, 'at'),
      },
    ];
  });
}

const RULE_TYPES: readonly RuleType[] = ['COUNT', 'STREAK', 'DAILY_ALL_DONE', 'POINTS'];
const num = (x: unknown): number | null => (typeof x === 'number' ? x : null);

/** The goals in play (WP-20); a goal in a state the board doesn't show, or a rule it can't draw, is left out. */
function readGoals(x: unknown): BoardGoal[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((g) => {
    if (!isObject(g) || (g.status !== 'active' && g.status !== 'achieved')) return [];
    const rules = Array.isArray(g.rules) ? g.rules : [];
    return [
      {
        id: str(g, 'id'),
        memberId: typeof g.member_id === 'string' ? g.member_id : null,
        title: str(g, 'title'),
        icon: typeof g.icon === 'string' ? g.icon : 'trophy',
        photo: typeof g.photo === 'string' ? g.photo : null,
        status: g.status,
        n: Number(g.n) || 0,
        achievedAt: typeof g.achieved_at === 'string' ? g.achieved_at : null,
        celebrate: g.celebrate === true,
        endDate: typeof g.end_date === 'string' ? g.end_date : null,
        logic: g.logic === 'any' ? 'any' : 'all',
        pct: Number(g.pct) || 0,
        rules: rules.flatMap((r) =>
          isObject(r) && RULE_TYPES.includes(r.type as RuleType)
            ? [
                {
                  id: str(r, 'id'),
                  type: r.type as RuleType,
                  target: Number(r.target) || 0,
                  current: Number(r.current) || 0,
                  pct: Number(r.pct) || 0,
                  met: r.met === true,
                  streak: num(r.streak),
                  best: num(r.best),
                },
              ]
            : [],
        ),
      },
    ];
  });
}

const ids = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];

function readOccurrence(o: unknown): TodayItem {
  if (!isObject(o) || !STATUSES.includes(o.status as OccurrenceStatus)) {
    throw new Error('snapshot: unknown occurrence');
  }
  return {
    id: str(o, 'id'),
    choreId: str(o, 'chore_id'),
    title: str(o, 'title'),
    icon: typeof o.icon === 'string' ? o.icon : null,
    kind: o.kind === 'task' ? 'task' : 'chore',
    dueDate: str(o, 'due_date'),
    dueTime: typeof o.due_time === 'string' ? o.due_time : null,
    memberId: typeof o.member_id === 'string' ? o.member_id : null,
    assignees: ids(o.assignees),
    status: o.status as OccurrenceStatus,
    doneBy: ids(o.done_by),
    rewarded: ids(o.rewarded),
    points: Number(o.points) || 0,
    requiresApproval: o.requires_approval === true,
    checkedAt: typeof o.checked_at === 'string' ? o.checked_at : null,
    // [D-66] What "More info" shows; a snapshot from before WP-35 has none.
    description:
      typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null,
  };
}

const CALENDAR_STATUSES = ['pending', 'ok', 'error', 'disabled'] as const;

/**
 * [CAL-04] A board's calendar (the snapshot's slice, or `board_calendar()`); null when there is none
 * (an older database, or not a board). A calendar or event in a shape this build doesn't know is
 * left out rather than failing the whole board.
 */
export function readCalendar(x: unknown): BoardCalendar | null {
  if (!isObject(x) || typeof x.from !== 'string' || typeof x.to !== 'string') return null;
  const calendars = (Array.isArray(x.calendars) ? x.calendars : []).flatMap(
    (c): BoardCalendarSource[] =>
      isObject(c) && typeof c.id === 'string' && typeof c.name === 'string'
        ? [
            {
              id: c.id,
              name: c.name,
              color: (typeof c.color === 'string' ? c.color : 'member-6') as MemberColor,
              memberId: typeof c.member_id === 'string' ? c.member_id : null,
              status: CALENDAR_STATUSES.includes(c.status as BoardCalendarSource['status'])
                ? (c.status as BoardCalendarSource['status'])
                : 'ok',
              lastSuccessAt: typeof c.last_success_at === 'string' ? c.last_success_at : null,
            },
          ]
        : [],
  );
  const events = (Array.isArray(x.events) ? x.events : []).flatMap((e): BoardEvent[] =>
    isObject(e) &&
    typeof e.id === 'string' &&
    typeof e.calendar_id === 'string' &&
    typeof e.start === 'string' &&
    typeof e.end === 'string' &&
    typeof e.start_date === 'string' &&
    typeof e.end_date === 'string'
      ? [
          {
            id: e.id,
            calendarId: e.calendar_id,
            title: typeof e.title === 'string' ? e.title : '',
            allDay: e.all_day === true,
            start: e.start,
            end: e.end,
            startDate: e.start_date,
            endDate: e.end_date,
            changed: e.changed === true,
          },
        ]
      : [],
  );
  return { from: x.from, to: x.to, calendars, events };
}

/**
 * The snapshot as the board uses it, or null when there is none (the board is not active: unpaired
 * or disconnected). Throws on a shape this build does not know, so a mismatch shows up as an error
 * instead of a half-drawn board.
 */
/** [BRD-04] The snapshot's weather, or null when it has none or it doesn't read as one. */
function readWeather(x: unknown): BoardWeather | null {
  if (!isObject(x)) return null;
  const [temperature, high, low, code] = [num(x.temperature), num(x.high), num(x.low), num(x.code)];
  if (temperature === null || high === null || low === null || code === null) return null;
  if (typeof x.for_date !== 'string' || typeof x.read_at !== 'string') return null;
  return {
    temperature,
    high,
    low,
    code,
    day: x.day !== false,
    unit: x.unit === 'celsius' ? 'celsius' : 'fahrenheit',
    forDate: x.for_date,
    readAt: x.read_at,
  };
}

export function readSnapshot(data: unknown): BoardSnapshot | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || data.v !== 1) throw new Error('snapshot: unknown shape');
  const h = data.household;
  const d = data.device;
  const r = data.range;
  if (!isObject(h) || !isObject(d) || !isObject(r) || !Array.isArray(data.members)) {
    throw new Error('snapshot: missing part');
  }
  const theme = str(d, 'theme');
  return {
    v: 1,
    fetchedAt: str(data, 'fetched_at'),
    today: str(data, 'today'),
    range: { from: str(r, 'from'), to: str(r, 'to') },
    household: {
      id: str(h, 'id'),
      name: str(h, 'name'),
      timezone: str(h, 'timezone'),
      weekStart: Number(h.week_start),
      undoWindowSeconds: typeof h.undo_window_seconds === 'number' ? h.undo_window_seconds : 120,
    },
    device: {
      id: str(d, 'id'),
      name: str(d, 'name'),
      theme: theme === 'day' || theme === 'evening' ? theme : 'auto',
    },
    // A snapshot from before WP-35 has no layout: the defaults.
    layout: isObject(data.layout)
      ? {
          household: readLayout(data.layout.household) ?? structuredClone(DEFAULT_LAYOUT),
          board: readLayout(data.layout.board),
        }
      : { household: structuredClone(DEFAULT_LAYOUT), board: null },
    members: data.members.map((m) => {
      if (!isObject(m)) throw new Error('snapshot: member is not an object');
      return {
        id: str(m, 'id'),
        displayName: str(m, 'display_name'),
        role: m.role === 'adult' ? 'adult' : 'child',
        avatarKey: (typeof m.avatar_key === 'string' ? m.avatar_key : null) as AvatarKey | null,
        color: str(m, 'color') as MemberColor,
        earnsRewards: m.earns_rewards === true,
        points: readPoints(m.points),
        streak: readStreak(m.streak),
        // A snapshot from before WP-30 has no wish.
        wish: readShopItem(m.wish),
        // A snapshot from before WP-20 has none of these: nothing held, nothing asked for.
        available:
          typeof m.available === 'number'
            ? m.available
            : isObject(m.points) && typeof m.points.balance === 'number'
              ? m.points.balance
              : null,
        requests: readRequests(m.requests),
        limited: ids(m.limited),
      };
    }),
    // A snapshot from before WP-11 (an older database) has no items.
    occurrences: Array.isArray(data.occurrences) ? data.occurrences.map(readOccurrence) : [],
    // A snapshot from before WP-30 has no shop.
    shop: Array.isArray(data.shop)
      ? data.shop.map(readShopItem).filter((i): i is BoardShopItem => i !== null)
      : [],
    // A snapshot from before WP-20 has no goals.
    goals: readGoals(data.goals),
    // A snapshot from before WP-23 has no calendar.
    calendar: readCalendar(data.calendar),
    // A snapshot from before WP-45 has no weather.
    weather: readWeather(data.weather),
  };
}
