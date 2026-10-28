'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import type { GroceryBrand } from '@/lib/grocery-brands';
import type { GroceryStore } from '@/lib/groceries';
import { addPlace, editGrocery, renamePlace, setGroceryBrand, setPreferredStore } from './actions';
import { BrandField } from './brand-field';

/** [MEAL-18] Edit an item: its name and the amount to get. */
export function EditForm({
  id,
  name,
  amount,
  storeFilter,
}: {
  id: string;
  name: string;
  amount: string | null;
  storeFilter: string;
}) {
  const [state, onSubmit, pending] = useFormAction(editGrocery, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form fw-groc__panel" aria-label={`Edit ${name}`}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="store" value={storeFilter} />
      <div className="fw-groc__editrow">
        <label className="fw-field fw-groc__amtfield">
          <span className="fw-field__label">Amount</span>
          <input
            className="fw-input"
            name="amount"
            maxLength={40}
            defaultValue={amount ?? ''}
            autoComplete="off"
            placeholder="×2"
          />
        </label>
        <label className="fw-field fw-groc__grow">
          <span className="fw-field__label">Name</span>
          <input
            className="fw-input"
            name="name"
            maxLength={80}
            required
            defaultValue={name}
            autoComplete="off"
          />
        </label>
      </div>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** [MEAL-23][MEAL-29] Adds a category, a store or a brand, or renames one (given its id). */
export function PlaceForm({
  kind,
  id,
  name,
  placeholder,
}: {
  kind: 'category' | 'store' | 'brand';
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(id ? renamePlace : addPlace, {} as FormState);
  const label = id
    ? `Rename ${name}`
    : kind === 'category'
      ? 'New category'
      : kind === 'store'
        ? 'New store'
        : 'New brand';
  return (
    <form onSubmit={onSubmit} className="fw-groc__placeform" aria-label={label}>
      <input type="hidden" name="kind" value={kind} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="fw-groc__addrow">
        <label className="fw-groc__addfield">
          <span className="fw-visually-hidden">{label}</span>
          {id ? (
            <input
              className="fw-input"
              name="name"
              maxLength={40}
              required
              defaultValue={name ?? ''}
              autoComplete="off"
            />
          ) : (
            // [MEAL-28] As the add field: two lines on a phone, so the hint ("New store, like
            // Trader Joe's") shows in full; Enter adds, and it takes no line breaks (WP-112).
            <textarea
              className="fw-input fw-groc__addinput"
              name="name"
              rows={2}
              maxLength={40}
              required
              autoComplete="off"
              placeholder={placeholder}
              onChange={(e) => {
                const v = e.target.value.replace(/\s*\n\s*/g, ' ');
                if (v !== e.target.value) e.target.value = v;
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
            />
          )}
        </label>
        <Button type="submit" variant="secondary" icon={id ? 'check' : 'plus'} disabled={pending}>
          {id ? 'Rename' : 'Add'}
        </Button>
      </div>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
    </form>
  );
}

/**
 * [MEAL-28] New items go to: one of the household's stores, or Any store (D-142). Saved as soon as
 * it is chosen.
 */
export function PreferredStoreForm({
  stores,
  preferredStoreId,
}: {
  stores: readonly GroceryStore[];
  preferredStoreId: string | null;
}) {
  return (
    <form action={setPreferredStore} className="fw-groc__pref" aria-label="New items go to">
      <input type="hidden" name="store" value="all" />
      <label className="fw-field">
        <span className="fw-field__label">New items go to</span>
        <select
          className="fw-input"
          name="storeId"
          defaultValue={preferredStoreId ?? ''}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          <option value="">Any store</option>
          {stores.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <span className="fw-field__help">
          A new item gets this store. One you’ve had before keeps the store it had last time.
        </span>
      </label>
    </form>
  );
}

/**
 * [MEAL-29] An item's Brand… (WP-116): the type-ahead over the household's brands; a brand not yet
 * among them is saved to them; empty is no brand.
 */
export function BrandForm({
  id,
  name,
  brand,
  brands,
  storeFilter,
}: {
  id: string;
  name: string;
  brand: string | null;
  brands: readonly GroceryBrand[];
  storeFilter: string;
}) {
  const [state, onSubmit, pending] = useFormAction(setGroceryBrand, {} as FormState);
  const [value, setValue] = useState(brand ?? '');
  return (
    <form onSubmit={onSubmit} className="fw-form fw-groc__panel" aria-label={`Brand of ${name}`}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="store" value={storeFilter} />
      <p className="fw-groc__panel-h">Brand of {name}</p>
      <BrandField brands={brands} value={value} onChange={setValue} hint="Empty is no brand." />
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          Set the brand
        </Button>
      </div>
    </form>
  );
}
