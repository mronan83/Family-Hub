'use client';

import { Icon } from '@familywise/ui';
import { useId, useState } from 'react';
import type { Ingredient } from '@/lib/meals';

interface Row extends Ingredient {
  key: number;
}

let next = 0;
const row = (i: Partial<Ingredient> = {}): Row => ({
  key: (next += 1),
  name: i.name ?? '',
  amount: i.amount ?? null,
  have: i.have ?? false,
});

/**
 * [MEAL-07] A meal's ingredients in its form (WP-105, D-138 (6)): a row each with the amount to buy
 * and the name, and We usually have it under it; the last row adds one as it is typed in, × takes
 * one away. Sent as one JSON field, `ingredients`. `rows` lets Read ingredients fill it from outside.
 */
export function IngredientsField({
  initial,
  rows: filled,
}: {
  initial: readonly Ingredient[];
  /** Rows read from a recipe (WP-105), replacing what is there, for the admin to check. */
  rows?: { seq: number; rows: readonly Ingredient[] } | null;
}) {
  const [rows, setRows] = useState<Row[]>(() => [...initial.map(row), row()]);
  const [seen, setSeen] = useState(0);
  const help = useId();
  if (filled && filled.seq !== seen) {
    setSeen(filled.seq);
    setRows([...filled.rows.map(row), row()]);
  }
  const set = (key: number, change: Partial<Ingredient>) =>
    setRows((was) => {
      const nextRows = was.map((r) => (r.key === key ? { ...r, ...change } : r));
      const last = nextRows[nextRows.length - 1]!;
      return last.name.trim() || (last.amount ?? '').trim() ? [...nextRows, row()] : nextRows;
    });
  const remove = (key: number) => setRows((was) => was.filter((r) => r.key !== key));
  const value = rows
    .filter((r) => r.name.trim())
    .map((r) => ({ name: r.name.trim(), amount: r.amount?.trim() || null, have: r.have }));
  return (
    <fieldset className="fw-field fw-fieldset fw-ing" aria-describedby={help}>
      <legend className="fw-field__label">Ingredients</legend>
      <span id={help} className="fw-field__help">
        The amount to buy, like “1 lb” or “8”, not the recipe’s spoonfuls. Leave it empty for
        “some”.
      </span>
      <input type="hidden" name="ingredients" value={JSON.stringify(value)} />
      <ul className="fw-ing__rows">
        {rows.map((r, i) => {
          const last = i === rows.length - 1;
          const label = r.name.trim() || `ingredient ${i + 1}`;
          return (
            <li key={r.key} className="fw-ing__row">
              <input
                className="fw-input fw-ing__amt"
                aria-label={`Amount of ${label}`}
                placeholder="Amount"
                maxLength={40}
                autoComplete="off"
                value={r.amount ?? ''}
                onChange={(e) => set(r.key, { amount: e.target.value })}
              />
              <input
                className="fw-input fw-ing__name"
                aria-label={last ? 'Add an ingredient' : `Ingredient ${i + 1}`}
                placeholder={last ? 'Add an ingredient' : ''}
                maxLength={80}
                autoComplete="off"
                value={r.name}
                onChange={(e) => set(r.key, { name: e.target.value })}
              />
              {last ? (
                <span />
              ) : (
                <button
                  type="button"
                  className="fw-ing__x"
                  aria-label={`Remove ${label}`}
                  onClick={() => remove(r.key)}
                >
                  <Icon name="close" />
                </button>
              )}
              {last ? null : (
                <label className="fw-choice fw-ing__have">
                  <input
                    type="checkbox"
                    checked={r.have}
                    onChange={(e) => set(r.key, { have: e.target.checked })}
                  />
                  We usually have it
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
