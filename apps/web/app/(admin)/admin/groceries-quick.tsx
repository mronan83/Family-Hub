'use client';

import { Banner, Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { starterList } from '@/lib/grocery-starter';
import {
  alreadyLine,
  type GroceryCategory,
  type GroceryItem,
  type GroceryStore,
  type LearnedWord,
  onTheList,
  type PastItem,
  suggest,
  whereLine,
} from '@/lib/groceries';
import { quickAddGrocery, type QuickAddState } from './groceries/actions';

/** What Home's Groceries card needs: the list as it is, and what the suggestion learns from. */
export interface GroceriesQuickData {
  open: GroceryItem[];
  categories: GroceryCategory[];
  stores: GroceryStore[];
  past: PastItem[];
  learned: LearnedWord[];
  preferredStoreId: string | null;
}

/**
 * [MEAL-27][MEAL-28] Home's Groceries card (WP-112, D-142): how many are on the list, Groceries' own
 * add field, and one line under it saying where the item goes (its category, its store and why) or
 * that it is on the list already and what adding makes. Add goes through the one way in with the
 * suggested category and store, stays on Home, and says what was added, with Change to move it on
 * Groceries. Open the list, and This week's meals (the week's Add to groceries review).
 */
export function GroceriesQuick({
  data,
  dev,
}: {
  data: GroceriesQuickData;
  /** For the dev page only: the field typed into, or the line after an Add. */
  dev?: { typed?: string; added?: QuickAddState['added'] };
}) {
  const [state, onSubmit, pending] = useFormAction(quickAddGrocery, {
    added: dev?.added,
  } as QuickAddState);
  const [typed, setTyped] = useState(dev?.typed ?? '');
  // A new Add empties the field for the next thing.
  useEffect(() => {
    if (state.added && !dev?.added) setTyped('');
  }, [state.added, dev?.added]);

  const ctx = useMemo(
    () => ({
      categories: data.categories,
      past: data.past,
      learned: data.learned,
      starter: starterList,
      preferredStoreId: data.preferredStoreId,
    }),
    [data],
  );
  const s = useMemo(() => (typed.trim() ? suggest(typed, ctx) : null), [typed, ctx]);
  const already = useMemo(
    () => (typed.trim() ? alreadyLine(typed, data.open) : null),
    [typed, data.open],
  );
  const where = s ? whereLine(s, data.categories, data.stores) : null;

  return (
    <li className="fw-quick__card fw-quick__card--wide" aria-labelledby="groceries-quick-heading">
      <span className="fw-quick__icon">
        <Icon name="shopping-cart" size={24} />
      </span>
      <span className="fw-quick__name" id="groceries-quick-heading">
        Groceries
      </span>
      <p className="fw-quick__status fw-quick__words">{onTheList(data.open.length)}</p>
      <form onSubmit={onSubmit} className="fw-quick__add" aria-label="Add to groceries">
        <input type="hidden" name="categoryId" value={s?.categoryId ?? ''} />
        <input type="hidden" name="storeId" value={s?.storeId ?? ''} />
        <div className="fw-groc__addrow">
          <label className="fw-groc__addfield">
            <span className="fw-visually-hidden">Add an item</span>
            {/* Groceries' own field: two lines on a phone, one on a laptop; Enter adds, and it
                takes no line breaks. */}
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
          <Button type="submit" disabled={pending}>
            Add
          </Button>
        </div>
        <p className="fw-quick__line" role="status">
          {already ? (
            <>
              <b>{already.has}</b> {already.are ? 'are' : 'is'} on the list already.{' '}
              {already.makes ? (
                <>
                  Adding makes <b>{already.makes}</b>.
                </>
              ) : (
                'Adding keeps it one item.'
              )}
            </>
          ) : where ? (
            <>
              <b>{where.category}</b> · {where.store}
            </>
          ) : state.added ? (
            <>
              <Icon name="check" size={16} />
              Added <b>{state.added.what}</b> to {state.added.category}.{' '}
              <Link href={`/admin/groceries?item=${state.added.id}#item-${state.added.id}`}>
                Change
              </Link>
            </>
          ) : null}
        </p>
        {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      </form>
      <div className="fw-quick__actions">
        <Link href="/admin/groceries" className="fw-btn fw-btn--secondary">
          Open the list
        </Link>
        <Link href="/admin/meals?groceries=1" className="fw-btn fw-btn--ghost">
          This week’s meals
        </Link>
      </div>
    </li>
  );
}
