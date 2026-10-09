import type { AvatarKey, MemberColor, ThemeOverride } from '@familywise/ui';
import type { LedgerEntry, LedgerEntryType } from './points';

/**
 * [DEV-05] What `public.board_snapshot()` returns (02 §4.6): the one read a paired board makes, and
 * the unit it will cache offline (WP-13). Members and their points so far; later work packages add
 * slices.
 */
export interface BoardSnapshot {
  v: 1;
  fetchedAt: string;
  /** Household-local date, YYYY-MM-DD. */
  today: string;
  range: { from: string; to: string };
  household: { id: string; name: string; timezone: string; weekStart: number };
  device: { id: string; name: string; theme: ThemeOverride };
  members: BoardMember[];
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
      };
    }),
  };
}
