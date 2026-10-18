'use client';

import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import { useMemo, useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { itemKey, makeItOne } from '@/lib/grocery-merge';
import {
  categoryOrder,
  type GroceryCategory,
  type GroceryItem,
  type GroceryStore,
  suggest,
  type SuggestContext,
  whyLines,
  type Person,
} from '@/lib/groceries';
import { addGrocery } from './actions';

const FROM_WORDS = {
  last: 'where it went last time',
  learned: 'from your own moves',
  starter: 'from the starter list',
  other: null,
} as const;

/**
 * [MEAL-18][MEAL-24][MEAL-20] The add field, open at the top of Groceries (D-138 (10)): what to get,
 * then, as it is typed, the category and store suggested (last time's, the household's own words,
 * the starter list, else Other), each one tap to change; an open item it may be offers Make it one.
 * Adding under a category's + fixes the category and skips the suggestion.
 */
export function AddForm({
  categories,
  stores,
  open,
  people,
  ctx,
  fixedCategory,
  storeFilter,
  initial = '',
}: {
  categories: readonly GroceryCategory[];
  stores: readonly GroceryStore[];
  open: readonly GroceryItem[];
  people: readonly Person[];
  ctx: SuggestContext;
  fixedCategory: string | null;
  storeFilter: string;
  /** What is typed at first (the dev page's picture of adding). */
  initial?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(addGrocery, {} as FormState);
  const [typed, setTyped] = useState(initial);
  const [category, setCategory] = useState<string | null>(fixedCategory);
  const [store, setStore] = useState<string | null>(null);
  const ordered = categoryOrder(categories);
  const s = useMemo(() => (typed.trim() ? suggest(typed, ctx) : null), [typed, ctx]);
  const chosenCategory = category ?? s?.categoryId ?? null;
  const chosenStore = store ?? s?.storeId ?? '';
  const second = useMemo(() => {
    if (!s || s.from === 'other') return null;
    const key = itemKey(typed);
    const next = ctx.learned
      .filter((w) => key.split(' ').includes(w.word) && w.categoryId !== s.categoryId)
      .sort((a, b) => b.weight - a.weight)[0];
    return next?.categoryId ?? null;
  }, [s, typed, ctx]);
  const twins = useMemo(() => {
    const key = itemKey(typed);
    if (key.length < 3) return [];
    const near = open.filter((o) => {
      const k = itemKey(o.name);
      return k !== key && k.startsWith(key);
    });
    return [...new Map([...makeItOne(typed, open), ...near].map((o) => [o.id, o])).values()];
  }, [typed, open]);

  const catChips = [
    ...new Set(
      [chosenCategory, s?.categoryId, second].filter((x): x is string => x !== null && x !== ''),
    ),
  ]
    .map((id) => ordered.find((c) => c.id === id))
    .filter((c): c is GroceryCategory => !!c);
  const rest = ordered.filter((c) => !catChips.includes(c));
  const storeChips = [
    ...new Set([chosenStore, s?.storeId ?? '', '', ...stores.map((x) => x.id)]),
  ].slice(0, 4);
  const moreStores = stores.filter((x) => !storeChips.includes(x.id));
  const storeName = (id: string) => stores.find((x) => x.id === id)?.name ?? 'Any store';
  const fixed = fixedCategory ? ordered.find((c) => c.id === fixedCategory) : null;

  return (
    <form id="add" onSubmit={onSubmit} className="fw-groc__add" aria-label="Add to the list">
      <input type="hidden" name="store" value={storeFilter} />
      <div className="fw-groc__addrow">
        <label className="fw-groc__addfield">
          <span className="fw-visually-hidden">Add an item</span>
          <input
            className="fw-input"
            name="item"
            maxLength={100}
            autoComplete="off"
            placeholder="Add an item, like 2 lb ground beef"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            required
          />
        </label>
        <Button type="submit" icon="plus" disabled={pending}>
          Add
        </Button>
      </div>
      {fixed ? (
        <p className="fw-muted">
          Goes in <b>{fixed.name}</b>.
        </p>
      ) : null}
      {fixed ? <input type="hidden" name="categoryId" value={fixed.id} /> : null}
      {typed.trim() && !fixed ? (
        <>
          <fieldset className="fw-groc__sug">
            <legend>Goes in</legend>
            {catChips.map((c) => (
              <label key={c.id} className="fw-groc__chip">
                <input
                  className="fw-visually-hidden"
                  type="radio"
                  name="categoryId"
                  value={c.id}
                  checked={chosenCategory === c.id}
                  onChange={() => setCategory(c.id)}
                />
                <Icon name={c.icon as IconName} size={18} />
                {c.name}
              </label>
            ))}
            {rest.length > 0 ? (
              <details className="fw-groc__more-chips">
                <summary className="fw-groc__chip">Other…</summary>
                <div className="fw-groc__chips">
                  {rest.map((c) => (
                    <label key={c.id} className="fw-groc__chip">
                      <input
                        className="fw-visually-hidden"
                        type="radio"
                        name="categoryId"
                        value={c.id}
                        checked={chosenCategory === c.id}
                        onChange={() => setCategory(c.id)}
                      />
                      <Icon name={c.icon as IconName} size={18} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
            {s && FROM_WORDS[s.from] && category === null ? (
              <span className="fw-groc__from">{FROM_WORDS[s.from]}</span>
            ) : null}
          </fieldset>
          <fieldset className="fw-groc__sug">
            <legend>Store</legend>
            {storeChips.map((id) => (
              <label key={id || 'any'} className="fw-groc__chip">
                <input
                  className="fw-visually-hidden"
                  type="radio"
                  name="storeId"
                  value={id}
                  checked={chosenStore === id}
                  onChange={() => setStore(id)}
                />
                {id ? <Icon name="store" size={18} /> : null}
                {storeName(id)}
              </label>
            ))}
            {moreStores.length > 0 ? (
              <details className="fw-groc__more-chips">
                <summary className="fw-groc__chip">More…</summary>
                <div className="fw-groc__chips">
                  {moreStores.map((x) => (
                    <label key={x.id} className="fw-groc__chip">
                      <input
                        className="fw-visually-hidden"
                        type="radio"
                        name="storeId"
                        value={x.id}
                        checked={chosenStore === x.id}
                        onChange={() => setStore(x.id)}
                      />
                      <Icon name="store" size={18} />
                      {x.name}
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
            {s?.from === 'last' && s.storeId && store === null ? (
              <span className="fw-groc__from">where it was bought last time</span>
            ) : null}
          </fieldset>
        </>
      ) : null}
      {twins.map((t) => {
        const why = whyLines(t, people)
          .map((w) =>
            w.kind === 'meal'
              ? w.label
              : w.kind === 'ask'
                ? `${w.member?.name ?? 'A child'} asked`
                : w.kind === 'staple'
                  ? 'a staple'
                  : w.who,
          )
          .join(', ');
        return (
          <div key={t.id} className="fw-groc__also" role="status">
            <Icon name="info" size={18} />
            <span>
              Also on the list: <b>{t.name}</b>
              {why ? `, ${why}` : ''}. Adding it makes one item.
            </span>
            <Button type="submit" variant="ghost" name="intoId" value={t.id} disabled={pending}>
              Make it one
            </Button>
          </div>
        );
      })}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
    </form>
  );
}
