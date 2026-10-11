import { type LunchChild, lunchFromDb, type LunchMode, noLunchWords } from './lunch';
import { menuWords } from './menus';

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
  /** Who it's for; null: everyone. */
  memberId: string | null;
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
      memberId: typeof e.member_id === 'string' ? e.member_id : null,
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
  /** On a buy day, what the school serves ("Cheese Pizza, Milk", "No lunch: Teacher day"); null when the menu has nothing that day or the child has no menu. */
  menu: string | null;
  /** True when the child has a school menu but it has nothing for the day. */
  noMenu: boolean;
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
 * [MEAL-06] The meals of one day: each meal's entries in order, and each child's school lunch. A
 * lunch planned for a child who brings theirs that day is what they bring, so it goes with them.
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
  for (const c of meals?.lunch ?? []) {
    const d = c.days.find((x) => x.date === date);
    if (!d?.mode) continue;
    const hasMenu = d.mode === 'buy' && !!d.menu;
    const packed = d.mode === 'bring' ? slots.lunch.filter((e) => e.memberId === c.memberId) : [];
    if (packed.length) slots.lunch = slots.lunch.filter((e) => !packed.includes(e));
    lunch.push({
      memberId: c.memberId,
      mode: d.mode,
      menu: hasMenu ? menuWords(d.menu!) : null,
      noMenu: d.mode === 'buy' && !!c.menuSourceId && !d.menu,
      packed: packed.map((e) => e.name),
    });
  }
  return { date, slots, lunch };
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
