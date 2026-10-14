import { type LunchChild, lunchFromDb, type LunchMode, noLunchWords } from './lunch';
import { entreePickWords, menuChanged, picksWords } from './lunch-picks';
import { entreeWords, menuSections, type MenuSection, sectionLabel } from './menu/sections';
import { type LunchMenu, menuWords } from './menus';

// [MEAL-06][US-705] Meals on the board (WP-28, D-80): the snapshot's household week of meals, read
// into the app's shape, and what the home screen and the Meals screen show of it.

export type MealSlot = 'breakfast' | 'snack' | 'lunch' | 'dinner';
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];
export const SLOT_WORDS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  snack: 'Snack',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/** One thing planned for a meal of a day: a library meal or something written in. */
export interface BoardMealEntry {
  id: string;
  date: string;
  slot: MealSlot;
  /** [MEAL-10] Who it's for (WP-62); none: everyone. */
  memberIds: string[];
  name: string;
  /** The library meal's icon; none for something written in. */
  icon: string | null;
  notes: string | null;
}

/** The household week's meals: the planned entries, and each child's school lunch. */
export interface BoardMeals {
  /** The household week's first day, YYYY-MM-DD. */
  weekFrom: string;
  entries: BoardMealEntry[];
  lunch: LunchChild[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** The snapshot's meals, or null when it has none (a snapshot from before WP-28). */
export function readMeals(x: unknown): BoardMeals | null {
  if (!isObject(x) || typeof x.week_from !== 'string') return null;
  const entries: BoardMealEntry[] = [];
  for (const e of Array.isArray(x.entries) ? x.entries : []) {
    if (!isObject(e) || typeof e.id !== 'string' || typeof e.date !== 'string') continue;
    const slot = MEAL_SLOTS.find((s) => s === e.slot);
    if (!slot || typeof e.name !== 'string' || !e.name) continue;
    entries.push({
      id: e.id,
      date: e.date,
      slot,
      // A snapshot from before WP-62 (kept offline) names one person as member_id.
      memberIds: Array.isArray(e.member_ids)
        ? e.member_ids.filter((m): m is string => typeof m === 'string')
        : typeof e.member_id === 'string'
          ? [e.member_id]
          : [],
      name: e.name,
      icon: typeof e.icon === 'string' ? e.icon : null,
      notes: typeof e.notes === 'string' ? e.notes : null,
    });
  }
  let lunch: LunchChild[] = [];
  try {
    lunch = Array.isArray(x.lunch) ? lunchFromDb(x.lunch as Parameters<typeof lunchFromDb>[0]) : [];
  } catch {
    lunch = [];
  }
  return { weekFrom: x.week_from, entries, lunch };
}

/** One child's lunch on a day, as the board says it. */
export interface BoardLunch {
  memberId: string;
  mode: LunchMode;
  /**
   * [MENU-06] On a buy day, the entree's options ("Beef tacos or Chicken wrap with Tortilla chips"),
   * or "No lunch: Teacher day"; null when the menu has nothing that day or the child has no menu.
   */
  menu: string | null;
  /** [MENU-06] On a buy day, the day's whole menu by section, for its details (WP-64). */
  sections: MenuSection[] | null;
  /** True when the child has a school menu but it has nothing for the day. */
  noMenu: boolean;
  /**
   * [MEAL-11] On a buy day with picks (WP-49), all of them in words ("Chicken wrap · Grapes · 1%
   * milk"); `menu` is then the entree picked, in place of the options.
   */
  picked?: string | null;
  /** [MEAL-11] A pick the day's menu no longer has: "Menu changed". */
  menuChanged?: boolean;
  /** On a bring day, what's planned for their lunch on Meals ("Leftover spaghetti"). */
  packed: string[];
}

/** A day's meals as the board shows them: each meal of the day's entries, and the children's lunches. */
export interface BoardMealDay {
  date: string;
  slots: Record<MealSlot, BoardMealEntry[]>;
  lunch: BoardLunch[];
}

/**
 * [MEAL-06][MEAL-10] The meals of one day: each meal's entries in order, and each child's school
 * lunch. A lunch planned for children who bring theirs that day is what each of them brings, so it
 * goes with each of them (WP-62); the entry stays under Lunch for anyone else on it, with only their
 * faces, and goes from there when no one else is.
 */
export function mealDay(meals: BoardMeals | null, date: string): BoardMealDay {
  const slots: Record<MealSlot, BoardMealEntry[]> = {
    breakfast: [],
    snack: [],
    lunch: [],
    dinner: [],
  };
  for (const e of meals?.entries ?? []) if (e.date === date) slots[e.slot].push(e);
  const lunch: BoardLunch[] = [];
  const bringing = new Set<string>();
  for (const c of meals?.lunch ?? []) {
    const d = c.days.find((x) => x.date === date);
    if (!d?.mode) continue;
    const hasMenu = d.mode === 'buy' && !!d.menu;
    const packed =
      d.mode === 'bring' ? slots.lunch.filter((e) => e.memberIds.includes(c.memberId)) : [];
    if (packed.length) bringing.add(c.memberId);
    const sections = hasMenu && !d.menu!.noService ? menuSections(d.menu!.items) : null;
    // [MEAL-11] The picks in place of the options (WP-49).
    const picks = d.mode === 'buy' ? (d.choices ?? []) : [];
    lunch.push({
      memberId: c.memberId,
      mode: d.mode,
      menu: picks.length ? entreePickWords(picks, sections) : hasMenu ? buyWords(d.menu!) : null,
      sections,
      noMenu: d.mode === 'buy' && !!c.menuSourceId && !d.menu && !picks.length,
      packed: packed.map((e) => e.name),
      ...(picks.length
        ? { picked: picksWords(picks, sections), menuChanged: menuChanged(picks, sections) }
        : {}),
    });
  }
  // What's left of a lunch packed for some of its people: the others, or nothing.
  slots.lunch = slots.lunch.flatMap((e) => {
    if (!e.memberIds.some((m) => bringing.has(m))) return [e];
    const rest = e.memberIds.filter((m) => !bringing.has(m));
    return rest.length ? [{ ...e, memberIds: rest }] : [];
  });
  return { date, slots, lunch };
}

/** [MENU-06] What a buy day's line says: the entree's options, or why there is no lunch. */
function buyWords(menu: LunchMenu): string {
  return menu.noService ? menuWords(menu) : (entreeWords(menu.items) ?? menuWords(menu));
}

/** [MENU-06] A school menu across the week: its name, and each day's menu where a child has lunch. */
export interface WeekMenu {
  sourceId: string;
  name: string;
  /** Its sections in the order the week first lists them: the title and the label shown. */
  rows: { title: string | null; label: string | null }[];
  /** Each date's menu (absent: nothing that day, or no child with a school lunch). */
  days: Map<string, { noService: string | null; sections: MenuSection[] }>;
}

/**
 * [MENU-06][US-804] The week's school menus for the board's Meals screen (WP-64, D-94): each menu
 * the children's lunches come from, its sections as rows and each day's options, on every day a
 * child on it has a school lunch, buy or bring.
 */
export function weekMenus(meals: BoardMeals | null): WeekMenu[] {
  const menus = new Map<string, WeekMenu>();
  for (const c of meals?.lunch ?? []) {
    if (!c.menuSourceId) continue;
    const m = menus.get(c.menuSourceId) ?? {
      sourceId: c.menuSourceId,
      name: c.menuName ?? 'School menu',
      rows: [],
      days: new Map(),
    };
    menus.set(c.menuSourceId, m);
    for (const d of c.days) {
      if (!d.mode || !d.menu || m.days.has(d.date)) continue;
      const sections = d.menu.noService ? [] : menuSections(d.menu.items);
      m.days.set(d.date, { noService: d.menu.noService ? menuWords(d.menu) : null, sections });
    }
  }
  for (const m of menus.values()) {
    const titles: (string | null)[] = [];
    for (const date of [...m.days.keys()].sort()) {
      for (const s of m.days.get(date)!.sections)
        if (!titles.includes(s.title)) titles.push(s.title);
    }
    m.rows = titles.map((title) => ({ title, label: title ? sectionLabel(title) : null }));
  }
  return [...menus.values()].filter((m) => m.days.size > 0);
}

/** True when a day has anything to show: a meal planned, or a child's school lunch. */
export function hasMeals(day: BoardMealDay): boolean {
  return day.lunch.length > 0 || MEAL_SLOTS.some((s) => day.slots[s].length > 0);
}

/** The week's seven dates from its first day. */
export function weekDates(weekFrom: string): string[] {
  const start = Date.parse(`${weekFrom}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** A day as the week's heading says it: "Mon 12", or with its month, "Mon, Oct 12". */
export function dayHead(date: string, withMonth = false): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = Number(date.slice(8, 10));
  return withMonth
    ? `${WEEKDAY.format(d)}, ${MONTH.format(d)} ${day}`
    : `${WEEKDAY.format(d)} ${day}`;
}

/** Why a day has no school lunch, when none of the children has one: "Weekend", "No school"… */
export function noLunchReason(meals: BoardMeals | null, date: string): string | null {
  const children = meals?.lunch ?? [];
  const days = children.map((c) => c.days.find((d) => d.date === date));
  if (!days.length || days.some((d) => !d || d.mode)) return null;
  const words = [...new Set(days.map((d) => noLunchWords(d!.dayType)))];
  return words.length === 1 ? words[0]! : 'No school';
}
