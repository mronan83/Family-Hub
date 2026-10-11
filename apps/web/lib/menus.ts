import { dayAndTime } from './format';
import { csvDate } from './menu/csv';
import {
  MAX_ITEMS,
  type MenuDay,
  type MenuItem,
  type NutrisliceConfig,
  SLUG,
} from './menu/nutrislice';

// [MENU-01..05][MEAL-05] School menus in the admin portal (WP-27, D-79): the sources, how each one's
// fetch went, a day's menu in words, and the forms.

export type MenuAdapter = 'nutrislice' | 'csv' | 'manual';
export type MenuStatus = 'pending' | 'ok' | 'error';

export interface MenuSourceRow {
  id: string;
  name: string;
  adapter: MenuAdapter;
  config: Partial<NutrisliceConfig>;
  status: MenuStatus;
  lastFetchAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** The children whose school lunch comes from it. */
  childIds: string[];
  /** Its days from today, four weeks. */
  days: MenuDayRow[];
}

export interface MenuDayRow extends MenuDay {
  /** A parent's own (typed in, or from a file): the feed never replaces it. */
  own: boolean;
  origin: 'adapter' | 'csv' | 'manual';
}

/** A day's lunch as lunch_week gives it on a buy day. */
export interface LunchMenu {
  items: MenuItem[];
  noService: boolean;
  note: string | null;
}

export const ADAPTER_WORDS: Record<MenuAdapter, string> = {
  nutrislice: 'From Nutrislice',
  csv: 'From a file',
  manual: 'Typed in',
};

/** "From Nutrislice · Maple Elementary · Lunch", "From a file". */
export function sourceWords(s: Pick<MenuSourceRow, 'adapter' | 'config'>): string {
  if (s.adapter !== 'nutrislice') return ADAPTER_WORDS[s.adapter];
  return [
    ADAPTER_WORDS.nutrislice,
    s.config.school_name ?? s.config.school,
    s.config.menu_type_name ?? s.config.menu_type,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * [MENU-04][US-803] How a feed's fetches are going, in words: fetched, can't fetch (why, and when it
 * last worked: the cached menus stay), or not yet. A file or typed-in menu has nothing to fetch.
 */
export function fetchStatus(
  s: Pick<MenuSourceRow, 'adapter' | 'status' | 'lastFetchAt' | 'lastSuccessAt' | 'lastError'>,
  timeZone: string,
): { kind: 'ok' | 'error' | 'pending'; label: string; detail: string } | null {
  if (s.adapter !== 'nutrislice') return null;
  if (s.status === 'error') {
    return {
      kind: 'error',
      label: 'Can’t fetch',
      detail: `${s.lastError ?? 'The last fetch failed.'} ${
        s.lastSuccessAt
          ? `Last fetched ${dayAndTime(s.lastSuccessAt, timeZone)}: the menus below are kept until it works again.`
          : 'No menus yet.'
      }`,
    };
  }
  if (s.status === 'ok' && s.lastFetchAt) {
    return {
      kind: 'ok',
      label: 'Fetched',
      detail: `Last fetched ${dayAndTime(s.lastFetchAt, timeZone)}. It fetches the next four weeks every morning.`,
    };
  }
  return { kind: 'pending', label: 'Not fetched yet', detail: 'It fetches within a day.' };
}

/** "Cheese Pizza, Hawaiian Pizza, 1% Milk", or "No lunch: Presidents' Day". */
export function menuWords(day: {
  items: MenuItem[];
  noService: boolean;
  note?: string | null;
}): string {
  if (day.noService) return day.note ? `No lunch: ${day.note}` : 'No lunch that day';
  return day.items.map((i) => i.name).join(', ');
}

/** A day's items as the Change form shows them: one a line, "Section: item" when it has one. */
export function itemsText(items: MenuItem[]): string {
  return items.map((i) => (i.section ? `${i.section}: ${i.name}` : i.name)).join('\n');
}

/** The Change form's lines back into items: "Section: item" or just the item. */
export function itemsFrom(text: string): MenuItem[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
    .map((l) => {
      const m = /^([^:]{1,60}):\s*(.+)$/.exec(l);
      return m
        ? { section: m[1]!.trim(), name: m[2]!.trim().slice(0, 120) }
        : { name: l.slice(0, 120) };
    });
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** [MENU-03] A day typed in: its date, its items (a line each) or no lunch with a note. */
export function parseDayForm(form: FormData): Parsed<MenuDay> {
  const date = csvDate(String(form.get('date') ?? ''));
  if (!date) return { ok: false, message: 'Choose the day.' };
  const noService = form.get('noService') === 'on';
  const note = String(form.get('note') ?? '').trim();
  if (note.length > 120) return { ok: false, message: 'Keep the note to 120 characters.' };
  if (noService)
    return { ok: true, value: { date, items: [], noService: true, ...(note ? { note } : {}) } };
  const items = itemsFrom(String(form.get('items') ?? ''));
  if (items.length === 0) {
    return {
      ok: false,
      message: 'Write what’s for lunch, one item a line, or tick “No lunch that day”.',
    };
  }
  return { ok: true, value: { date, items, noService: false } };
}

/** [MENU-01] A new menu's name and where it comes from; a feed's district, school and menu. */
export function parseSourceForm(
  form: FormData,
): Parsed<{ name: string; adapter: MenuAdapter; config: Record<string, string> }> {
  const name = String(form.get('name') ?? '').trim();
  if (!name || name.length > 40)
    return { ok: false, message: 'Give the menu a name of up to 40 characters.' };
  const adapter = String(form.get('adapter') ?? '') as MenuAdapter;
  if (!['nutrislice', 'csv', 'manual'].includes(adapter)) {
    return { ok: false, message: 'Choose where the menu comes from.' };
  }
  if (adapter !== 'nutrislice') return { ok: true, value: { name, adapter, config: {} } };
  const district = String(form.get('district') ?? '');
  const [school, menuType] = String(form.get('feed') ?? '').split('/');
  if (!SLUG.test(district) || !SLUG.test(school ?? '') || !SLUG.test(menuType ?? '')) {
    return {
      ok: false,
      message: 'Find your district’s schools, then choose the school and its menu.',
    };
  }
  const config: Record<string, string> = { district, school: school!, menu_type: menuType! };
  const schoolName = String(form.get('schoolName') ?? '').trim();
  const menuName = String(form.get('menuName') ?? '').trim();
  if (schoolName) config.school_name = schoolName.slice(0, 80);
  if (menuName) config.menu_type_name = menuName.slice(0, 80);
  return { ok: true, value: { name, adapter, config } };
}

/** A database refusal of a menu change in the parent's words. */
export function menuRefusal(error: { hint?: string | null }): string {
  switch (error.hint) {
    case 'bad_config':
      return 'Find your district’s schools, then choose the school and its menu.';
    case 'bad_menu':
      return 'Each day needs its items (up to 60, each up to 120 characters), or to say no lunch is served.';
    case 'not_found':
      return 'That menu isn’t here any more.';
    case 'not_a_child':
      return 'School lunch is for children.';
    case 'not_allowed':
      return 'Only a parent of this family can do that.';
    default:
      return 'That didn’t save. Try again in a moment.';
  }
}
