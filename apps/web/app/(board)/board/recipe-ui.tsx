'use client';

import { Button, Icon } from '@familywise/ui';
import { useEffect, useRef, useState } from 'react';
import { type BoardRecipe, fileLabel, type SignRecipeFiles, siteOf } from '@/lib/board-recipes';

/**
 * [MEAL-26][US-720] A meal's recipe on the board, full screen and read-only (WP-105, D-138 (6), Q22):
 * its photos and PDFs with chips between them, its ingredients, and the steps its link publishes,
 * to cook from at the kitchen board. Close, or Escape, goes back.
 */
export function RecipeSheet({
  recipe,
  when,
  sign,
  onClose,
}: {
  recipe: BoardRecipe;
  /** "tonight", "Tue". */
  when: string;
  sign?: SignRecipeFiles;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(recipe.files[0]?.id ?? null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.fw-details__close')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => {
    if (!sign || recipe.files.length === 0) return;
    let live = true;
    void sign(recipe.files.map((f) => f.path)).then((u) => live && setUrls(u));
    return () => {
      live = false;
    };
  }, [sign, recipe.files]);
  const file = recipe.files.find((f) => f.id === shown) ?? null;
  const url = file ? urls[file.path] : undefined;
  const site = siteOf(recipe.recipeUrl);
  return (
    <div className="fw-today__scrim">
      <div
        ref={box}
        className="fw-today__picker fw-recipe-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-title"
      >
        <header className="fw-recipe-sheet__head">
          <h2 id="recipe-title">
            {recipe.name}
            <span className="fw-recipe-sheet__when"> · {when}</span>
          </h2>
          <Button variant="secondary" icon="close" className="fw-details__close" onClick={onClose}>
            Close
          </Button>
        </header>
        <div className={`fw-recipe-sheet__body${file ? '' : ' fw-recipe-sheet__body--words'}`}>
          {file ? (
            <div className="fw-recipe-sheet__files">
              <div className="fw-recipe-sheet__view">
                {!url ? (
                  <Icon name={file.kind === 'pdf' ? 'book' : 'image'} size={96} />
                ) : file.kind === 'photo' ? (
                  // A short-lived signed link to the household's own photo, which next/image can't fetch.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={fileLabel(file)} />
                ) : (
                  <object data={url} type="application/pdf" aria-label={file.name}>
                    <Icon name="book" size={96} />
                  </object>
                )}
              </div>
              {recipe.files.length > 0 ? (
                <div className="fw-recipe-sheet__chips" role="group" aria-label="Photos and PDFs">
                  {recipe.files.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="fw-bgroc__chip"
                      aria-pressed={f.id === shown}
                      onClick={() => setShown(f.id)}
                    >
                      <Icon name={f.kind === 'pdf' ? 'book' : 'image'} size={28} />
                      {fileLabel(f)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {recipe.ingredients.length > 0 ? (
            <section aria-labelledby="recipe-ing" className="fw-recipe-sheet__col">
              <h3 id="recipe-ing">Ingredients</h3>
              <ul>
                {recipe.ingredients.map((i, n) => (
                  <li key={n}>{i.amount ? `${i.amount} ${i.name.toLowerCase()}` : i.name}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {recipe.steps.length > 0 ? (
            <section aria-labelledby="recipe-steps" className="fw-recipe-sheet__col">
              <h3 id="recipe-steps">{site ? `From ${site}` : 'Steps'}</h3>
              <ol>
                {recipe.steps.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
