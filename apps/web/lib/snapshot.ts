import type { AvatarKey, MemberColor, ThemeOverride } from '@familywise/ui';

/**
 * [DEV-05] What `public.board_snapshot()` returns (02 §4.6): the one read a paired board makes, and
 * the unit it will cache offline (WP-13). Members only for now; later work packages add slices.
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
}

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (o: Json, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string') throw new Error(`snapshot: ${k} is not text`);
  return v;
};

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
      };
    }),
  };
}
