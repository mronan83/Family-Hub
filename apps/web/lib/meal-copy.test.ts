import { describe, expect, it } from 'vitest';
import { copyRecipeFiles, type FileStore, mealCopy } from './meal-copy';
import type { MealRow, RecipeFile } from './meals';

const HOUSEHOLD = 'f2a00000-0000-4000-8000-000000000001';
const TACOS = 'f2d00000-0000-4000-8000-000000000001';
const COPY = 'f2d00000-0000-4000-8000-000000000009';
const file = (n: number, kind: RecipeFile['kind'], name: string, ext: string): RecipeFile => ({
  id: `f2b10000-0000-4000-8000-00000000000${n}`,
  kind,
  name,
  path: `${HOUSEHOLD}/${TACOS}/${n}.${ext}`,
  sizeBytes: 1000 * n,
});
const FILES = [
  file(1, 'photo', 'Grandma’s card.jpg', 'JPG'),
  file(2, 'pdf', 'Taco night.pdf', 'pdf'),
];
const tacos: MealRow = {
  id: TACOS,
  name: 'Tacos',
  description: 'Tuesday’s',
  icon: 'utensils',
  mealTypes: ['dinner'],
  recipeUrl: 'https://example.com/tacos',
  archivedAt: null,
  ingredients: [{ name: 'Ground beef', amount: '1 lb', have: false }],
  recipeSteps: ['Brown the beef.'],
  recipeFiles: FILES,
};

/** A store that remembers what it was asked, refusing the copy or the record of the names given. */
function store(refuseCopy: string[] = [], refuseRecord: string[] = []) {
  const done: string[] = [];
  const s: FileStore = {
    copy: async (from, to) => {
      done.push(`copy ${from.split('/').at(-1)} → ${to}`);
      return !refuseCopy.some((n) => from.endsWith(n));
    },
    record: async (r) => {
      done.push(`record ${r.name} #${r.sortOrder} ${r.kind} ${r.sizeBytes} ${r.path}`);
      return !refuseRecord.includes(r.name);
    },
    remove: async (path) => {
      done.push(`remove ${path}`);
    },
  };
  return { s, done };
}

describe('[MEAL-25-h] Duplicate on the Meal library copies all of a meal', () => {
  it('[MEAL-25-h] the copy takes every field, its ingredients, link, steps and files, named "(copy)"', () => {
    const copy = mealCopy(tacos);
    expect(copy).toEqual({
      name: 'Tacos (copy)',
      description: 'Tuesday’s',
      icon: 'utensils',
      mealTypes: ['dinner'],
      recipeUrl: 'https://example.com/tacos',
      ingredients: [{ name: 'Ground beef', amount: '1 lb', have: false }],
      recipeSteps: ['Brown the beef.'],
      recipeFiles: FILES,
    });
    // Its own lists: changing the copy's form never changes the original.
    expect(copy.ingredients![0]).not.toBe(tacos.ingredients![0]);
    expect(mealCopy({ ...tacos, name: 'x'.repeat(80) }).name).toHaveLength(80);
  });

  it('[MEAL-25-h] the photos and PDFs become files of the copy’s own, in order, under its folder', async () => {
    const { s, done } = store();
    let n = 0;
    const result = await copyRecipeFiles(
      FILES,
      { householdId: HOUSEHOLD, mealId: COPY },
      s,
      () => `new${++n}`,
    );
    expect(result).toEqual({ copied: 2, failed: [] });
    expect(done).toEqual([
      `copy 1.JPG → ${HOUSEHOLD}/${COPY}/new1.jpg`,
      `record Grandma’s card.jpg #0 photo 1000 ${HOUSEHOLD}/${COPY}/new1.jpg`,
      `copy 2.pdf → ${HOUSEHOLD}/${COPY}/new2.pdf`,
      `record Taco night.pdf #1 pdf 2000 ${HOUSEHOLD}/${COPY}/new2.pdf`,
    ]);
  });

  it('[MEAL-25-h] one that can’t be copied or recorded is named, and its stored copy taken away', async () => {
    const { s, done } = store(['1.JPG'], ['Taco night.pdf']);
    let n = 0;
    const result = await copyRecipeFiles(
      FILES,
      { householdId: HOUSEHOLD, mealId: COPY },
      s,
      () => `new${++n}`,
    );
    expect(result).toEqual({ copied: 0, failed: ['Grandma’s card.jpg', 'Taco night.pdf'] });
    expect(done.at(-1)).toBe(`remove ${HOUSEHOLD}/${COPY}/new2.pdf`);
    expect(done.some((d) => d.startsWith('record Grandma'))).toBe(false);
  });
});
