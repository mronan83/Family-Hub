'use client';

import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import { useMemo, useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { brandOf, type GroceryBrand, withBrand } from '@/lib/grocery-brands';
import { itemKey, makeItOne } from '@/lib/grocery-merge';
import { starterList } from '@/lib/grocery-starter';
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
import { BrandField } from './brand-field';

const FROM_WORDS = {
  last: 'where it went last time',
  learned: 'from your own moves',
  starter: 'from the starter list',
  other: null,
} as const;

/**
 * [MEAL-18][MEAL-24][MEAL-20] The add field, open at the top of Groceries (D-138 (10)): what to get,
 * then, as it is typed, the category and store suggested (last time's, the household's own words,
 * the starter list, else Other; [MEAL-28] the store last time's, then the preferred store, D-142),
 * each one tap to change; an open item it may be offers Make it one; [MEAL-29] its Brand, a
 * type-ahead over the household's brands, filled with the brand it had last time (D-148).
 * Adding under a category's + fixes the category and skips the suggestion.
 */
export function AddForm({
  categories,
  stores,
  brands,
  open,
  people,
  ctx,
  fixedCategory,
  storeFilter,
  initial = '',
  initialBrand,
}: {
  categories: readonly GroceryCategory[];
  stores: readonly GroceryStore[];
  brands: readonly GroceryBrand[];
  open: readonly GroceryItem[];
  people: readonly Person[];
  ctx: SuggestContext;
  fixedCategory: string | null;
  storeFilter: string;
  /** What is typed at first (the dev page's picture of adding). */
  initial?: string;
  /** For the dev page only: the brand typed, with its offers open. */
  initialBrand?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(addGrocery, {} as FormState);
  const [typed, setTyped] = useState(initial);
  const [category, setCategory] = useState<string | null>(fixedCategory);
  const [store, setStore] = useState<string | null>(null);
  // [MEAL-29] The brand typed; until it is touched, the brand the item had last time.
  const [brand, setBrand] = useState<string | null>(initialBrand ?? null);
  const ordered = categoryOrder(categories);
  const s = useMemo(
    () => (typed.trim() ? suggest(typed, { ...ctx, starter: starterList }) : null),
    [typed, ctx],
  );
  const chosenCategory = category ?? s?.categoryId ?? null;
  const chosenStore = store ?? s?.storeId ?? '';
  const lastBrand = brandOf(s?.brandId, brands);
  const brandValue = brand ?? lastBrand ?? '';
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
  // Last time's store comes first; otherwise Any store, then the stores in order with the one picked
  // (the preferred store, D-142) among the first.
  const storeChips = [
    ...new Set(
      s?.storeFrom === 'last'
        ? [chosenStore, s.storeId ?? '', '', ...stores.map((x) => x.id)]
        : ['', chosenStore, ...stores.map((x) => x.id)],
    ),
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
          {/* A field of one line whose hint wraps on a phone, as the mockup draws it: a text area
              that Enter adds from and that takes no line breaks. */}
          <textarea
            className="fw-input fw-groc__addinput"
            name="item"
            rows={2}
            maxLength={100}
            autoComplete="off"
            placeholder="Add an item, like 2 lb ground beef"
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/\s*\n\s*/g, ' '))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
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
            {s?.storeFrom === 'last' && store === null ? (
              <span className="fw-groc__from">where it was bought last time</span>
            ) : s?.storeFrom === 'preferred' && s.storeId && store === null ? (
              <span className="fw-groc__from">{storeName(s.storeId)} is your preferred store.</span>
            ) : null}
          </fieldset>
        </>
      ) : null}
      {typed.trim() ? (
        <BrandField
          brands={brands}
          value={brandValue}
          onChange={setBrand}
          hint={brand === null && lastBrand ? 'its brand last time' : null}
          initialOpen={initialBrand !== undefined}
        />
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
              Also on the list: <b>{withBrand(t.name, brandOf(t.brandId, brands))}</b>
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
