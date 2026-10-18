import { describe, expect, it } from 'vitest';
import { fileLabel, readRecipes, siteOf } from './board-recipes';

describe('recipes on the board', () => {
  it('[MEAL-26] reads board_recipes(), skipping what it can’t read', () => {
    const r = readRecipes([
      {
        entry_id: 'e1',
        meal_id: 'm1',
        name: 'Tacos',
        date: '2026-10-20',
        recipe_url: 'https://www.tasty-tacos.example/r',
        ingredients: [{ name: 'Onion', amount: '1' }, { amount: '2' }],
        steps: ['Brown the beef.', 3],
        files: [
          { id: 'f1', kind: 'photo', name: 'Card.jpg', path: 'h/m/f1.jpg' },
          { id: 'f2', kind: 'word', name: 'x', path: 'h/m/f2' },
        ],
      },
      { name: 'No ids' },
    ]);
    expect(r).toHaveLength(1);
    expect(r![0]!.ingredients).toEqual([{ name: 'Onion', amount: '1', have: false }]);
    expect(r![0]!.steps).toEqual(['Brown the beef.']);
    expect(r![0]!.files.map((f) => fileLabel(f))).toEqual(['Card']);
    expect(siteOf(r![0]!.recipeUrl)).toBe('tasty-tacos.example');
    expect(siteOf('not a link')).toBeNull();
    expect(readRecipes(null)).toBeNull();
  });
});
