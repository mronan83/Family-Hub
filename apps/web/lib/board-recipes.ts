import { type Ingredient, readIngredients } from './meals';

// [MEAL-26] A meal's recipe on the board (WP-105, D-138 (6), Q22): board_recipes() read into the
// app's shape, for the Meals screen to open full screen, read-only.

export interface BoardRecipeFile {
  id: string;
  kind: 'photo' | 'pdf';
  name: string;
  path: string;
}

export interface BoardRecipe {
  entryId: string;
  mealId: string;
  name: string;
  date: string;
  recipeUrl: string | null;
  ingredients: Ingredient[];
  steps: string[];
  files: BoardRecipeFile[];
}

export type LoadRecipes = (from: string, to: string) => Promise<BoardRecipe[] | null>;
/** Short-lived links to the files at these paths in the household's storage, by path. */
export type SignRecipeFiles = (paths: string[]) => Promise<Record<string, string>>;

const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** board_recipes()'s answer; null when there is none (an older database, or not a board). */
export function readRecipes(x: unknown): BoardRecipe[] | null {
  if (!Array.isArray(x)) return null;
  const out: BoardRecipe[] = [];
  for (const r of x) {
    if (!isObject(r) || !str(r.entry_id) || !str(r.meal_id) || !str(r.name) || !str(r.date))
      continue;
    out.push({
      entryId: r.entry_id as string,
      mealId: r.meal_id as string,
      name: r.name as string,
      date: r.date as string,
      recipeUrl: str(r.recipe_url),
      ingredients: readIngredients(r.ingredients),
      steps: (Array.isArray(r.steps) ? r.steps : []).filter(
        (s): s is string => typeof s === 'string',
      ),
      files: (Array.isArray(r.files) ? r.files : [])
        .filter(isObject)
        .filter((f) => str(f.id) && str(f.path) && (f.kind === 'photo' || f.kind === 'pdf'))
        .map((f) => ({
          id: f.id as string,
          kind: f.kind as 'photo' | 'pdf',
          name: str(f.name) ?? 'Recipe',
          path: f.path as string,
        })),
    });
  }
  return out;
}

/** "Grandma's card", not "Grandma's card.jpg": a photo's name as a chip says it. */
export const fileLabel = (f: BoardRecipeFile) =>
  f.kind === 'photo' ? f.name.replace(/\.[a-z0-9]{2,5}$/i, '') : f.name;

/** "From tasty-tacos.example": where the steps came from. */
export function siteOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
