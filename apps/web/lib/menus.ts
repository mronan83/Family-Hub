import { andList, dayAndTime, isoDay, time } from './format';
import { csvDate } from './menu/csv';
import {
  MAX_ITEMS,
  type MenuDay,
  type MenuItem,
  type NutrisliceConfig,
  SLUG,
} from './menu/nutrislice';
import {
  entreeSection,
  menuSections,
  optionWords,
  sectionLabel,
  sectionWords,
  withOptions,
} from './menu/sections';

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

/** What a school menu's folded header on School menus says about it (WP-93, D-120). */
export interface MenuFacts {
  /** "From Nutrislice · Maya and Leo · Fetched 6:29 am · 9 days in the next four weeks" */
  meta: string;
  /** "Can’t fetch" while its feed fails; else null. */
  warning: string | null;
}

/**
 * [MENU-01][MENU-04][NFR-18] A school menu's facts on its folded header (WP-93): where it comes
 * from, whose lunch it is ("nobody yet"), a feed's fetch ("Fetched" and its time today, or its day;
 * "last fetched" its last good fetch while it fails; "Not fetched yet") and the days it has lunch in
 * the next four weeks; "Can’t fetch" as its warning.
 */
export function menuFacts(
  m: Pick<
    MenuSourceRow,
    'adapter' | 'status' | 'lastFetchAt' | 'lastSuccessAt' | 'childIds' | 'days'
  >,
  names: Map<string, string>,
  now: number,
  timeZone: string,
): MenuFacts {
  // A fetch today is said by its time; an older one by its day and time.
  const when = (at: string) =>
    isoDay(timeZone, new Date(at)) === isoDay(timeZone, new Date(now))
      ? time(at, timeZone)
      : dayAndTime(at, timeZone);
  const feed = m.adapter === 'nutrislice';
  const failing = feed && m.status === 'error';
  const fetch = !feed
    ? []
    : failing
      ? [m.lastSuccessAt ? `last fetched ${when(m.lastSuccessAt)}` : 'never fetched']
      : m.status === 'ok' && m.lastFetchAt
        ? [`Fetched ${when(m.lastFetchAt)}`]
        : ['Not fetched yet'];
  const whose = m.childIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  const n = m.days.filter((d) => !d.noService).length;
  return {
    meta: [
      ADAPTER_WORDS[m.adapter],
      whose.length > 0 ? andList(whose) : 'nobody yet',
      ...fetch,
      n === 0
        ? 'no days in the next four weeks'
        : `${n} ${n === 1 ? 'day' : 'days'} in the next four weeks`,
    ].join(' · '),
    warning: failing ? 'Can’t fetch' : null,
  };
}

/** A day with no lunch served in words, or null when lunch is served. */
function noLunch(day: { noService: boolean; note?: string | null }): string | null {
  if (!day.noService) return null;
  return day.note ? `No lunch: ${day.note}` : 'No lunch that day';
}

/**
 * [MENU-06] A day's menu in a line, each section's options in turn: "Entree: Beef tacos or Chicken
 * wrap with Tortilla chips · Fruits & Vegetables: Corn, Orange · Milk: 1% milk or Chocolate milk",
 * or "No lunch: Presidents' Day". A menu with no sections lists its options with commas.
 */
export function menuWords(day: {
  items: MenuItem[];
  noService: boolean;
  note?: string | null;
}): string {
  return (
    noLunch(day) ??
    dayMenu(day.items)
      .map((s) => (s.label ? `${s.label}: ${s.words}` : s.words))
      .join(' · ')
  );
}

/** [MENU-06][US-804] A day's menu by section, each as its label and its options in words. */
export function dayMenu(items: MenuItem[]): { label: string | null; words: string }[] {
  const sections = menuSections(items);
  const entree = entreeSection(sections);
  return sections.map((s) => ({
    label: s.title ? sectionLabel(s.title) : null,
    words: sectionWords(s, s === entree),
  }));
}

/**
 * [MENU-06] A day's items as the Change form shows them: a line a section, "Section: A or B with
 * C", read back the same by itemsFrom(). Without a section, an option a line.
 */
export function itemsText(items: MenuItem[]): string {
  return menuSections(items)
    .flatMap((s) => {
      const options = s.options.map(optionWords);
      return s.title ? [`${s.title}: ${options.join(' or ')}`] : options;
    })
    .join('\n');
}

/**
 * [MENU-03][MENU-06] The Change form's lines back into items: "Section: item" or just the item,
 * "or" and "with" inside a line read as options and sides (WP-64).
 */
export function itemsFrom(text: string): MenuItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
    .map((l): MenuItem => {
      const m = /^([^:]{1,60}):\s*(.+)$/.exec(l);
      return m ? { section: m[1]!.trim(), name: m[2]!.trim() } : { name: l };
    });
  return withOptions(lines, { split: true });
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
