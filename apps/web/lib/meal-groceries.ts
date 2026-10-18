// [MEAL-19][MEAL-20] A planned week's meals into groceries (WP-105, D-138 (6)): the review an admin
// sees before anything is added. Pure: no I/O; dates are the plan's own.

import { combineAmounts, itemKey } from './grocery-merge';
import { itemAmount, type GroceryItem } from './groceries';
import { type MealRow, type PlanEntry, SLOTS } from './meals';

export interface ReviewRow {
  /** `entryId:index`, what the form sends for a ticked row. */
  id: string;
  key: string;
  name: string;
  amount: string | null;
  /** We usually have it: starts unticked. */
  have: boolean;
}

export interface ReviewMeal {
  entryId: string;
  name: string;
  /** "Tue". */
  day: string;
  /** The day its ingredients were added that week ("Sun"); it starts unticked. */
  addedOn: string | null;
  rows: ReviewRow[];
}

export interface WeekReview {
  meals: ReviewMeal[];
  /** The week's other entries, with no ingredients to add (written in, or none kept yet). */
  without: string[];
}

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
/** "Tue" for a plan date, YYYY-MM-DD. */
export const dayWord = (date: string) => DAY.format(new Date(`${date}T12:00:00Z`));

/**
 * [MEAL-19] The review: each planned library meal with ingredients, in day order (and meal of the
 * day, then its order in it), with its rows; `added` gives, for an entry already added to the list,
 * when (a timestamp), in the household's zone. No scaling by who eats.
 */
export function weekReview(
  entries: readonly PlanEntry[],
  meals: readonly MealRow[],
  added: ReadonlyMap<string, string>,
  timeZone: string,
): WeekReview {
  const byId = new Map(meals.map((m) => [m.id, m]));
  const ordered = [...entries].sort(
    (a, b) =>
      a.planDate.localeCompare(b.planDate) ||
      SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) ||
      a.sortOrder - b.sortOrder,
  );
  const out: ReviewMeal[] = [];
  const without: string[] = [];
  for (const e of ordered) {
    const meal = e.mealId ? byId.get(e.mealId) : undefined;
    const ingredients = meal?.ingredients ?? [];
    if (!meal || ingredients.length === 0) {
      const name = meal?.name ?? e.freeText ?? '';
      if (name && !without.includes(name)) without.push(name);
      continue;
    }
    const at = added.get(e.id);
    out.push({
      entryId: e.id,
      name: meal.name,
      day: dayWord(e.planDate),
      addedOn: at
        ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(new Date(at))
        : null,
      rows: ingredients.map((i, n) => ({
        id: `${e.id}:${n}`,
        key: itemKey(i.name),
        name: i.name,
        amount: i.amount,
        have: i.have,
      })),
    });
  }
  return { meals: out, without };
}

/** The rows ticked at first: all but what we usually have, and the meals already added that week. */
export function startTicked(review: WeekReview): Set<string> {
  return new Set(
    review.meals.flatMap((m) => (m.addedOn ? [] : m.rows.filter((r) => !r.have).map((r) => r.id))),
  );
}

/**
 * [MEAL-19][MEAL-20] What each row says, given what is ticked: "We usually have it", "Added Sun";
 * a ticked row that merges with an earlier ticked one "With Tacos: 2 lb"; one merging into what is
 * on the list "On the list: Onions ×2, makes ×3", or "On the list already" when no amount changes.
 */
export function rowNotes(
  review: WeekReview,
  ticked: ReadonlySet<string>,
  open: readonly GroceryItem[],
): Map<string, { text: string; merge: boolean }> {
  const notes = new Map<string, { text: string; merge: boolean }>();
  const seen = new Map<string, { meal: string; amounts: (string | null)[] }>();
  const listed = new Map(open.filter((i) => i.status === 'open').map((i) => [itemKey(i.name), i]));
  for (const m of review.meals) {
    for (const r of m.rows) {
      if (!ticked.has(r.id)) {
        if (r.have) notes.set(r.id, { text: 'We usually have it', merge: false });
        else if (m.addedOn) notes.set(r.id, { text: `Added ${m.addedOn}`, merge: false });
        continue;
      }
      const item = listed.get(r.key);
      const before = seen.get(r.key);
      const base = item ? [itemAmount(item)] : [];
      if (before) {
        before.amounts.push(r.amount);
        const all = combineAmounts([...base, ...before.amounts]);
        notes.set(r.id, { text: `With ${before.meal}${all ? `: ${all}` : ''}`, merge: true });
      } else {
        seen.set(r.key, { meal: m.name, amounts: [r.amount] });
        if (item) {
          const was = itemAmount(item);
          const makes = combineAmounts([was, r.amount]);
          notes.set(r.id, {
            text:
              r.amount && makes
                ? `On the list: ${item.name}${was ? ` ${was}` : ''}, makes ${makes}`
                : 'On the list already',
            merge: true,
          });
        }
      }
    }
  }
  return notes;
}
