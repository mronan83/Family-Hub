// [MEAL-25][D-132] Duplicate on the Meal library (WP-96, the owner's answer of 18 October: "copy
// all"): a copy of a meal takes everything the meal has, its name marked "(copy)", and its recipe's
// photos and PDFs become files of its own, so taking one off the copy never touches the original.
import type { MealFormValue, MealRow, RecipeFile } from './meals';

const COPY = ' (copy)';

/** [MEAL-25] Add a meal, filled in from a meal: every field, its name marked "(copy)". */
export function mealCopy(m: MealRow): MealFormValue {
  return {
    name: `${m.name.slice(0, 80 - COPY.length)}${COPY}`,
    description: m.description,
    icon: m.icon,
    mealTypes: [...m.mealTypes],
    recipeUrl: m.recipeUrl,
    ingredients: (m.ingredients ?? []).map((i) => ({ ...i })),
    recipeSteps: [...(m.recipeSteps ?? [])],
    recipeFiles: [...(m.recipeFiles ?? [])],
  };
}

/** Where a stored file is copied and recorded: the storage bucket and the meal's file rows. */
export interface FileStore {
  copy(from: string, to: string): Promise<boolean>;
  record(row: {
    mealId: string;
    kind: RecipeFile['kind'];
    name: string;
    path: string;
    sizeBytes: number;
    sortOrder: number;
  }): Promise<boolean>;
  remove(path: string): Promise<void>;
}

/**
 * [MEAL-25] The original's photos and PDFs copied to the new meal, in their order, each under the
 * household's folder and the new meal's (the storage rule's), with a name of its own. One that
 * can't be copied or recorded is left out (its stored copy taken away again) and named.
 */
export async function copyRecipeFiles(
  files: readonly RecipeFile[],
  to: { householdId: string; mealId: string },
  store: FileStore,
  newId: () => string = () => crypto.randomUUID(),
): Promise<{ copied: number; failed: string[] }> {
  let copied = 0;
  const failed: string[] = [];
  for (const [i, f] of files.entries()) {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(f.path)?.[1] ?? (f.kind === 'pdf' ? 'pdf' : 'jpg');
    const path = `${to.householdId}/${to.mealId}/${newId()}.${ext.toLowerCase()}`;
    if (!(await store.copy(f.path, path))) {
      failed.push(f.name);
      continue;
    }
    const ok = await store.record({
      mealId: to.mealId,
      kind: f.kind,
      name: f.name,
      path,
      sizeBytes: f.sizeBytes,
      sortOrder: i,
    });
    if (ok) copied += 1;
    else {
      await store.remove(path);
      failed.push(f.name);
    }
  }
  return { copied, failed };
}
