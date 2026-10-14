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
    default:
      return 'That didn’t save. Try again in a moment.';
  }
}
