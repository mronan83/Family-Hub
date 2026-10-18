import { addDays, dayName, weekStartOf } from './board-calendar';

// Meals (WP-25, D-77): the family's meal library and the week's plan, in the parent's words. The
// database decides who may and what is the family's (add_meal_entry(), copy_meal_week()); this reads
// the forms, lays out a week and finds the words.

export const SLOTS = ['breakfast', 'snack', 'lunch', 'dinner'] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_WORDS: Record<Slot, string> = {
  breakfast: 'Breakfast',
  snack: 'Snack',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/** The icon each slot shows by. */
export const SLOT_ICONS: Record<Slot, 'breakfast' | 'snack' | 'lunch' | 'dinner'> = {
  breakfast: 'breakfast',
  snack: 'snack',
  lunch: 'lunch',
  dinner: 'dinner',
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: string) =>
  ISO_DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export interface MealRow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  mealTypes: Slot[];
  recipeUrl: string | null;
  archivedAt: string | null;
  /** [MEAL-07] What it needs to buy (WP-105); none read on pages that don't use them. */
  ingredients?: Ingredient[];
}

/**
 * [MEAL-07] One of a meal's ingredients (WP-105): its name, the amount to buy ("1 can", "8", "1 lb",
 * not the recipe's spoonfuls; none for "some"), and whether the family usually has it.
 */
export interface Ingredient {
  name: string;
  amount: string | null;
  have: boolean;
}

/** [MEAL-07] A meal's ingredients as stored, read safely: rows with a name, at most 60. */
export function readIngredients(x: unknown): Ingredient[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      name: typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '',
      amount: typeof r.amount === 'string' && r.amount.trim() ? r.amount.trim().slice(0, 40) : null,
      have: r.have === true,
    }))
    .filter((r) => r.name)
    .slice(0, 60);
}

export interface PlanEntry {
  id: string;
  planDate: string;
  slot: Slot;
  sortOrder: number;
  /** [MEAL-10] Who it's for (WP-62); none: everyone. */
  memberIds: string[];
  mealId: string | null;
  freeText: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------------------------

/** [MEAL-01] The week to show: the household week holding `asked` (a day), or today's. */
export function weekFrom(asked: string | undefined, today: string, weekStart: number): string {
  return weekStartOf(asked && realDay(asked) ? asked : today, weekStart);
}

/** The seven days of the week starting `from`. */
export function weekDays(from: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(from, i));
}

/** "Week of Sun, Oct 11". */
export function weekLabel(from: string): string {
  return `Week of ${dayName(from)}`;
}

/** [MEAL-01][MEAL-08] A week's entries by day and slot, each slot in its order. */
export function planByDay(
  entries: PlanEntry[],
  days: string[],
): Map<string, Record<Slot, PlanEntry[]>> {
  const out = new Map<string, Record<Slot, PlanEntry[]>>();
  for (const d of days) out.set(d, { breakfast: [], snack: [], lunch: [], dinner: [] });
  for (const e of entries) out.get(e.planDate)?.[e.slot].push(e);
  for (const slots of out.values()) {
    for (const s of SLOTS)
      slots[s].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }
  return out;
}

/**
 * [MEAL-14][D-98] How full a day is, for its folded header (WP-75): `of` the meal types the day
 * shows, `set` those with a meal, `complete` when every one has.
 */
export function daySet(
  slots: Record<Slot, PlanEntry[]>,
  shown: readonly Slot[] = SLOTS,
): { set: number; of: number; complete: boolean } {
  const set = shown.filter((s) => slots[s].length > 0).length;
  return { set, of: shown.length, complete: shown.length > 0 && set === shown.length };
}

/** [MEAL-14] "2 of 4 set". */
export function daySetWords(d: { set: number; of: number }): string {
  return `${d.set} of ${d.of} set`;
}

/** What an entry says: the meal's name (a removed meal keeps it), or what was written in. */
export function entryName(e: PlanEntry, meals: Map<string, MealRow>): string {
  return e.mealId ? (meals.get(e.mealId)?.name ?? 'A meal') : (e.freeText ?? '');
}

/**
 * [MEAL-01] The library's meals to offer for a slot: those good for it first (or good for anything),
 * then the rest, each by name; archived ones are not offered.
 */
export function mealsFor(slot: Slot | null, meals: MealRow[]): MealRow[] {
  const fits = (m: MealRow) => !slot || m.mealTypes.length === 0 || m.mealTypes.includes(slot);
  return meals
    .filter((m) => !m.archivedAt)
    .sort((a, b) => Number(fits(b)) - Number(fits(a)) || a.name.localeCompare(b.name));
}

/** [MEAL-03] What a copy did, in a line. */
export function copyWords(r: { copied: number; skipped: number; replaced: number }): string {
  if (r.copied === 0 && r.skipped === 0) return 'Last week has nothing planned to copy.';
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [`Copied ${n(r.copied, 'thing', 'things')} from last week.`];
  if (r.skipped) parts.push(`${n(r.skipped, 'meal was', 'meals were')} already planned and kept.`);
  if (r.replaced) parts.push(`${n(r.replaced, 'meal was', 'meals were')} replaced.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// The forms
// ---------------------------------------------------------------------------------------------

export interface MealFormValue {
  name: string;
  description: string | null;
  icon: string;
  mealTypes: Slot[];
  recipeUrl: string | null;
  /** [MEAL-07] Its ingredients (WP-105). */
  ingredients?: Ingredient[];
}

/** [MEAL-02] The library's form, or a line saying what to fix. */
export function parseMealForm(
  form: FormData,
  icons: readonly string[],
): { ok: true; value: MealFormValue } | { ok: false; message: string } {
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 80) {
    return { ok: false, message: 'Give the meal a name, up to 80 characters.' };
  }
  const description = String(form.get('description') ?? '').trim();
  if (description.length > 300) {
    return { ok: false, message: 'Keep the description to 300 characters.' };
  }
  const recipe = String(form.get('recipeUrl') ?? '').trim();
  if (recipe && (!/^https?:\/\/\S+$/i.test(recipe) || recipe.length > 500)) {
    return { ok: false, message: 'A recipe link starts with https:// (or leave it blank).' };
  }
  const types = form
    .getAll('mealTypes')
    .map(String)
    .filter((t): t is Slot => (SLOTS as readonly string[]).includes(t));
  const icon = String(form.get('icon') ?? 'utensils');
  // [MEAL-07] The ingredient rows, sent as JSON by the form (WP-105); empty rows are dropped.
  let rows: unknown = [];
  try {
    rows = JSON.parse(String(form.get('ingredients') ?? '[]'));
  } catch {
    return { ok: false, message: 'The ingredients didn’t come through. Try again.' };
  }
  const raw = Array.isArray(rows) ? rows : [];
  const named = raw.filter(
    (r) =>
      typeof r === 'object' && r !== null && String((r as { name?: unknown }).name ?? '').trim(),
  );
  if (named.length > 60) return { ok: false, message: 'Keep it to 60 ingredients.' };
  if (named.some((r) => String((r as { name: unknown }).name).trim().length > 80)) {
    return { ok: false, message: 'Keep each ingredient’s name to 80 characters.' };
  }
  if (named.some((r) => String((r as { amount?: unknown }).amount ?? '').trim().length > 40)) {
    return { ok: false, message: 'Keep each amount to 40 characters, like 1 lb.' };
  }
  return {
    ok: true,
    value: {
      name,
      description: description || null,
      icon: icons.includes(icon) ? icon : 'utensils',
      mealTypes: SLOTS.filter((s) => types.includes(s)),
      recipeUrl: recipe || null,
      ingredients: readIngredients(named),
    },
  };
}

export interface EntryFormValue {
  id: string;
  planDate: string;
  slot: Slot;
  /** [MEAL-10] Who it's for; none: everyone. */
  memberIds: string[];
  mealId: string | null;
  freeText: string | null;
  notes: string | null;
}

/**
 * [MEAL-01][MEAL-02][MEAL-08][MEAL-10] "Add to the plan": a day of the week shown, a slot, a meal
 * from the library or something written in, for everyone or any set of people, and a note. Every
 * person ticked, or none, is everyone (so a person added to the family later is in it too).
 */
export function parseEntryForm(
  form: FormData,
  ctx: { days: readonly string[]; memberIds: readonly string[] },
): { ok: true; value: EntryFormValue } | { ok: false; message: string } {
  const id = String(form.get('id') ?? '');
  if (!GUID.test(id)) return { ok: false, message: 'That form is out of date. Reload the page.' };
  const planDate = String(form.get('planDate') ?? '');
  if (!ctx.days.includes(planDate)) return { ok: false, message: 'Choose a day of this week.' };
  const slot = String(form.get('slot') ?? '') as Slot;
  if (!SLOTS.includes(slot))
    return { ok: false, message: 'Choose breakfast, snack, lunch or dinner.' };
  const ticked = [...new Set(form.getAll('member').map(String))].filter((m) => m !== 'everyone');
  if (ticked.some((m) => !ctx.memberIds.includes(m))) {
    return { ok: false, message: 'Choose who it’s for.' };
  }
  const memberIds = ctx.memberIds.every((m) => ticked.includes(m))
    ? []
    : ctx.memberIds.filter((m) => ticked.includes(m));
  let mealId: string | null = null;
  let freeText: string | null = null;
  if (form.get('what') === 'text') {
    freeText = String(form.get('freeText') ?? '').trim();
    if (freeText.length < 1 || freeText.length > 80) {
      return { ok: false, message: 'Write what it is, up to 80 characters.' };
    }
  } else {
    mealId = String(form.get('mealId') ?? '');
    if (!GUID.test(mealId)) return { ok: false, message: 'Choose a meal from the library.' };
  }
  const notes = String(form.get('notes') ?? '').trim();
  if (notes.length > 200) return { ok: false, message: 'Keep the note to 200 characters.' };
  return {
    ok: true,
    value: {
      id,
      planDate,
      slot,
      memberIds,
      mealId,
      freeText,
      notes: notes || null,
    },
  };
}

/** [MEAL-10] Who an entry is for, in a line: "Maya and Leo", "Alex, Maya and Leo"; null: everyone. */
export function peopleWords(names: readonly string[]): string | null {
  if (!names.length) return null;
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A database refusal of a meal change in the parent's words. */
export function mealRefusal(error: { code?: string | null; hint?: string | null }): string {
  if (error.code === '23505') return 'The library already has a meal of that name.';
  switch (error.hint) {
    case 'meal_gone':
      return 'That meal isn’t in the library any more. Choose another.';
    case 'member_gone':
      return 'That person isn’t in the family any more.';
    case 'meal_or_text':
      return 'Choose a meal from the library, or write something in.';
    case 'same_week':
      return 'That’s the same week.';
    case 'not_allowed':
      return 'Only a parent of this family can do that.';
    case 'not_found':
      return 'That meal isn’t on the plan any more. Reload the page.';
    default:
      return 'That didn’t save. Try again in a moment.';
  }
}
