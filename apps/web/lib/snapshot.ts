import type { AvatarKey, MemberColor, ThemeOverride } from '@familywise/ui';
import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { LedgerEntry, LedgerEntryType } from './points';
import type { TodayItem } from './today';

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
  members: BoardMember[];
  /** [BRD-01] Today's family-visible items and the open overdue tasks (WP-11). */
  occurrences: TodayItem[];
  /** [PTS-06] The rewards in the shop now, to choose one to save for (WP-30). */
  shop: BoardShopItem[];
}

/** A reward in the shop, as the board shows it. */
export interface BoardShopItem {
  id: string;
  title: string;
  icon: string;
  cost: number;
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
  return {
    id,
    title: x.title,
    icon: typeof x.icon === 'string' ? x.icon : 'gift',
    cost: Number(x.cost) || 0,
  };
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
  };
}

/**
 * The snapshot as the board uses it, or null when there is none (the board is not active: unpaired
 * or disconnected). Throws on a shape this build does not know, so a mismatch shows up as an error
 * instead of a half-drawn board.
 */
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
      };
    }),
    // A snapshot from before WP-11 (an older database) has no items.
    occurrences: Array.isArray(data.occurrences) ? data.occurrences.map(readOccurrence) : [],
    // A snapshot from before WP-30 has no shop.
    shop: Array.isArray(data.shop)
      ? data.shop.map(readShopItem).filter((i): i is BoardShopItem => i !== null)
      : [],
  };
}
