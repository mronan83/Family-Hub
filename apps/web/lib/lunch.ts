// School lunch, buy or bring (WP-26, D-78): each child's week as lunch_week() gives it, the usual
// lunches form, and the words. The database decides which days have a school lunch (the child's day
// type) and what a day's lunch is (its change, else the usual).

import type { MenuItem } from './menu/nutrislice';
import type { LunchMenu } from './menus';

export type LunchMode = 'buy' | 'bring';
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_WORDS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
};

export interface LunchDay {
  date: string;
  /** The child's day type (WP-21): school_day, weekend, break, no_school, summer. */
  dayType: string;
  /** Null on a day with no school lunch. */
  mode: LunchMode | null;
  /** True when the day was changed from the usual. */
  changed: boolean;
  /**
   * [MEAL-05] That day's school menu, on any day with a school lunch (WP-64; the app shows it to the
   * child only on a buy day); null when there is none (or no menu chosen).
   */
  menu?: LunchMenu | null;
  /** [MEAL-09] A board may still change the day: a school day before its cut-off (WP-49). */
  open?: boolean;
  /** [MEAL-09] The day's cut-off (ISO), on a day with a school lunch. */
  openUntil?: string | null;
  /** [MEAL-11] A buy day's picks, a section each (WP-49); null on any other day. */
  choices?: LunchPick[] | null;
  /** [MEAL-09] A child's change waiting for a parent, or one a parent kept (WP-49). */
  request?: LunchRequest | null;
  /** [MEAL-09] The day is as a child asked on the board and a parent approved. */
  byBoard?: boolean;
}

/** [MEAL-11] A section's picks: the options' numbers in the section and their names when picked. */
export interface LunchPick {
  /** The section's title as the menu writes it ('' for a menu without sections). */
  section: string;
  options: number[];
  names: string[];
}

/** [MEAL-09] A child's change to a day, from the board. */
export interface LunchRequest {
  id: string;
  mode: LunchMode;
  choices: LunchPick[];
  /** Waiting for a parent, or kept as it was by one (until the child taps Done). */
  status: 'waiting' | 'kept';
  requestedAt: string;
  /** Who kept it, for "Sam kept Buy". */
  decidedBy: string | null;
}

interface RawPick {
  section?: string | null;
  options?: unknown;
  names?: unknown;
}

/** Picks as the database gives them, dropping anything malformed. */
export function picksFromDb(raw: unknown): LunchPick[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawPick[]).flatMap((p) => {
    if (!p || !Array.isArray(p.options) || !Array.isArray(p.names)) return [];
    const options = p.options.filter((o): o is number => Number.isInteger(o));
    const names = p.names.filter((n): n is string => typeof n === 'string');
    if (!options.length || options.length !== names.length) return [];
    return [{ section: typeof p.section === 'string' ? p.section : '', options, names }];
  });
}

function requestFromDb(raw: unknown): LunchRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || (r.mode !== 'buy' && r.mode !== 'bring')) return null;
  if (r.status !== 'waiting' && r.status !== 'kept') return null;
  return {
    id: r.id,
    mode: r.mode,
    choices: picksFromDb(r.choices),
    status: r.status,
    requestedAt: typeof r.requested_at === 'string' ? r.requested_at : '',
    decidedBy: typeof r.decided_by === 'string' ? r.decided_by : null,
  };
}

export interface LunchChild {
  memberId: string;
  usual: Partial<Record<Weekday, LunchMode>>;
  /** [MENU-01] The school menu their lunch comes from, if any. */
  menuSourceId?: string | null;
  /** [MENU-06] Its name ("Maple Elementary"), for the board's Meals screen (WP-64). */
  menuName?: string | null;
  days: LunchDay[];
}

/** lunch_week()'s answer, in the app's shape. */
export function lunchFromDb(
  raw: {
    member_id: string;
    usual: Record<string, string>;
    menu_source_id?: string | null;
    menu_name?: string | null;
    days: {
      date: string;
      day_type: string;
      mode: string | null;
      changed: boolean;
      menu?: { items: MenuItem[]; no_service: boolean; note: string | null } | null;
      open?: boolean;
      open_until?: string | null;
      choices?: unknown;
      request?: unknown;
      by_board?: boolean;
    }[];
  }[],
): LunchChild[] {
  return raw.map((c) => ({
    memberId: c.member_id,
    usual: Object.fromEntries(
      Object.entries(c.usual).filter(
        ([k, v]) => (WEEKDAYS as readonly string[]).includes(k) && (v === 'buy' || v === 'bring'),
      ),
    ) as LunchChild['usual'],
    menuSourceId: c.menu_source_id ?? null,
    menuName: c.menu_name ?? null,
    days: c.days.map((d) => ({
      date: d.date,
      dayType: d.day_type,
      mode: d.mode === 'buy' || d.mode === 'bring' ? d.mode : null,
      changed: d.changed,
      menu: d.menu
        ? { items: d.menu.items ?? [], noService: d.menu.no_service, note: d.menu.note ?? null }
        : null,
      // [MEAL-09][MEAL-11] From WP-49 on; an older answer (a saved snapshot) has none.
      ...('open' in d
        ? {
            open: d.open === true,
            openUntil: d.open_until ?? null,
            choices: d.choices == null ? null : picksFromDb(d.choices),
            request: requestFromDb(d.request),
            byBoard: d.by_board === true,
          }
        : {}),
    })),
  }));
}

/** Why a day has no school lunch, in a word or two. */
export function noLunchWords(dayType: string): string {
  switch (dayType) {
    case 'weekend':
      return 'Weekend';
    case 'break':
      return 'Break';
    case 'summer':
      return 'No school year';
    default:
      return 'No school';
  }
}

export const MODE_WORDS: Record<LunchMode, string> = { buy: 'Buy', bring: 'Bring' };

/** [MEAL-04] The usual lunches form: one choice per weekday, buy or bring (anything else is bring). */
export function parseUsualLunch(form: FormData): Record<Weekday, LunchMode> {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, form.get(`usual-${d}`) === 'buy' ? 'buy' : 'bring']),
  ) as Record<Weekday, LunchMode>;
}

/** A database refusal of a lunch change in the parent's words. */
export function lunchRefusal(error: { hint?: string | null }): string {
  switch (error.hint) {
    case 'not_school_day':
      return 'That day has no school lunch.';
    case 'not_a_child':
      return 'School lunch is for children.';
    case 'not_allowed':
      return 'Only a parent of this family can do that.';
    case 'not_buy':
      return 'Only a buy day has picks.';
    case 'not_on_menu':
      return 'That isn’t on the day’s menu any more. Look again.';
    case 'pick_one':
      return 'Pick one in each “Choice of” section.';
    case 'no_menu':
      return 'That day has no menu to pick from.';
    case 'locked':
      return 'That day can’t change now.';
    default:
      return 'That didn’t save. Try again in a moment.';
  }
}

/** [MEAL-09][US-707] A child's change waiting for a parent, as Today lists it (WP-49). */
export interface WaitingLunch {
  id: string;
  memberId: string;
  date: string;
  /** What the child asked for. */
  mode: LunchMode;
  choices: LunchPick[];
  /** The day as it is now, and its picks. */
  current: LunchMode | null;
  currentChoices: LunchPick[];
  /** Their usual lunch on that weekday. */
  usual: LunchMode;
  requestedAt: string;
  /** [MEAL-11] The day's menu items, to say the picks in the menu's order; none when unknown. */
  menu?: MenuItem[];
}

/** lunch_requests_waiting()'s answer, in the app's shape; anything malformed is left out. */
export function waitingFromDb(raw: unknown): WaitingLunch[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== 'string' || typeof r.member_id !== 'string') return [];
    if (r.mode !== 'buy' && r.mode !== 'bring') return [];
    return [
      {
        id: r.id,
        memberId: r.member_id,
        date: String(r.date),
        mode: r.mode,
        choices: picksFromDb(r.choices),
        current: r.current === 'buy' || r.current === 'bring' ? r.current : null,
        currentChoices: picksFromDb(r.current_choices),
        usual: r.usual === 'buy' ? 'buy' : 'bring',
        requestedAt: typeof r.requested_at === 'string' ? r.requested_at : '',
      },
    ];
  });
}

/** [MEAL-09] Waiting changes a group per child, in the order given (children by name). */
export function byChild(list: WaitingLunch[]): { memberId: string; changes: WaitingLunch[] }[] {
  const groups: { memberId: string; changes: WaitingLunch[] }[] = [];
  for (const w of list) {
    const g = groups.find((x) => x.memberId === w.memberId);
    if (g) g.changes.push(w);
    else groups.push({ memberId: w.memberId, changes: [w] });
  }
  return groups;
}
