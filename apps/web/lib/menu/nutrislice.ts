// [MENU-02] The Nutrislice adapter (SPIKE-04, `01` §5.5, D-79): a district's public, unauthenticated
// menu API. The household's district, school and menu are picked in the admin portal and stored in
// menu_source.config; none is in the repo, and the tests use made-up menus (NFR-05).
//
//   https://{district}.api.nutrislice.com/menu/api/schools/
//     the district's schools: [{name, slug, active_menu_types: [{name, slug}]}]
//   https://{district}.api.nutrislice.com/menu/api/weeks/school/{school}/menu-type/{type}/{yyyy}/{mm}/{dd}/
//     one Sunday-to-Saturday week: {days: [{date, menu_items: [{is_section_title, is_holiday, text,
//     food: {name}}]}]}: section titles group the items under them; a holiday item marks a day off.
// Relative imports only: the e2e runner and unit tests use this without the app's aliases.

import { withOptions } from './sections';

/** A district, school or menu as Nutrislice writes it in its addresses. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export interface NutrisliceConfig {
  district: string;
  school: string;
  menu_type: string;
  /** What the picker showed, for the admin portal. */
  school_name?: string;
  menu_type_name?: string;
}

export interface MenuItem {
  name: string;
  /** The section title it is listed under, as the menu writes it ("Choice of Entree"). */
  section?: string;
  /** [MENU-06] Its option in the section, from 1; a side has its option's number (WP-64). */
  option?: number;
}

/** One school day's lunch as a feed or a file has it. */
export interface MenuDay {
  date: string;
  items: MenuItem[];
  /** No lunch served (a holiday), with what the day says. */
  noService: boolean;
  note?: string;
}

export interface School {
  slug: string;
  name: string;
  menuTypes: { slug: string; name: string }[];
}

/** The most items kept for a day (save_menu_days and save_menu_fetch take 60). */
export const MAX_ITEMS = 60;

/**
 * The district in what a parent types: the name itself ("example-district"), or any address of the
 * district's menus ("https://example-district.nutrislice.com/menu/maple/lunch"). Null when neither.
 */
export function districtFrom(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (SLUG.test(text)) return text;
  try {
    const url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
    const m = /^([a-z0-9][a-z0-9-]{0,79})\.(?:api\.)?nutrislice\.com$/.exec(url.hostname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function schoolsUrl(district: string): string {
  if (!SLUG.test(district)) throw new Error('not a district');
  return `https://${district}.api.nutrislice.com/menu/api/schools/`;
}

/** The address of the week holding `sunday` (a Sunday, YYYY-MM-DD). */
export function weekUrl(config: NutrisliceConfig, sunday: string): string {
  for (const v of [config.district, config.school, config.menu_type]) {
    if (!SLUG.test(v)) throw new Error('not a feed');
  }
  const [y, m, d] = sunday.split('-');
  return `https://${config.district}.api.nutrislice.com/menu/api/weeks/school/${config.school}/menu-type/${config.menu_type}/${y}/${m}/${d}/`;
}

/** The district's schools that have a menu, by name, each with its menus. */
export function readSchools(json: unknown): School[] {
  if (!Array.isArray(json)) throw new Error('not a list of schools');
  const schools: School[] = [];
  for (const s of json as Record<string, unknown>[]) {
    const slug = typeof s?.slug === 'string' ? s.slug : '';
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!SLUG.test(slug) || !name) continue;
    const types = Array.isArray(s.active_menu_types) ? s.active_menu_types : [];
    const menuTypes = (types as Record<string, unknown>[])
      .map((t) => ({
        slug: typeof t?.slug === 'string' ? t.slug : '',
        name: typeof t?.name === 'string' ? t.name.trim() : '',
      }))
      .filter((t) => SLUG.test(t.slug) && t.name);
    if (menuTypes.length > 0) schools.push({ slug, name: name.slice(0, 80), menuTypes });
  }
  return schools.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One week's days that have a menu: their items under their sections, in order, as options
 * (WP-64); a holiday is a day with no lunch served, saying what it is. Days with nothing published
 * are left out.
 */
export function readWeek(json: unknown): MenuDay[] {
  const days = (json as { days?: unknown })?.days;
  if (!Array.isArray(days)) throw new Error('not a week of menus');
  const out: MenuDay[] = [];
  for (const day of days as Record<string, unknown>[]) {
    const date = typeof day?.date === 'string' ? day.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entries = Array.isArray(day.menu_items)
      ? (day.menu_items as Record<string, unknown>[])
      : [];
    let section: string | undefined;
    const items: MenuItem[] = [];
    let holiday: string | null = null;
    for (const e of entries) {
      const text = typeof e?.text === 'string' ? e.text.trim() : '';
      const food = e?.food as { name?: unknown } | null | undefined;
      const foodName = typeof food?.name === 'string' ? food.name.trim() : '';
      if (e?.is_holiday) {
        holiday = text || foodName || 'No school';
        continue;
      }
      if (e?.is_section_title) {
        section = text ? text.slice(0, 60) : undefined;
        continue;
      }
      const name = (foodName || text).slice(0, 120);
      if (!name || items.length >= 2 * MAX_ITEMS) continue;
      items.push(section ? { name, section } : { name });
    }
    // [MENU-06] "or" and "with" are items of their own: read into options (WP-64).
    const options = withOptions(items);
    if (holiday !== null && options.length === 0) {
      out.push({ date, items: [], noService: true, note: holiday.slice(0, 120) });
    } else if (options.length > 0) {
      out.push({ date, items: options, noService: false });
    }
  }
  return out;
}

/** The Sundays of the weeks covering [from, to] (dates, inclusive). */
export function weeksCovering(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const sunday = start - new Date(start).getUTCDay() * 86_400_000;
  const weeks: string[] = [];
  for (let t = sunday; t <= end; t += 7 * 86_400_000) {
    weeks.push(new Date(t).toISOString().slice(0, 10));
  }
  return weeks;
}
