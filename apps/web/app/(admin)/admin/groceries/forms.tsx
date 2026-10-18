'use client';

import { Banner, Button } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { addPlace, editGrocery, renamePlace } from './actions';

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

/** [MEAL-23] Adds a category or a store, or renames one (given its id). */
export function PlaceForm({
  kind,
  id,
  name,
  placeholder,
}: {
  kind: 'category' | 'store';
  id?: string;
  name?: string;
  placeholder?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(id ? renamePlace : addPlace, {} as FormState);
  const label = id ? `Rename ${name}` : kind === 'category' ? 'New category' : 'New store';
  return (
    <form onSubmit={onSubmit} className="fw-groc__placeform" aria-label={label}>
      <input type="hidden" name="kind" value={kind} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="fw-groc__addrow">
        <label className="fw-groc__addfield">
          <span className="fw-visually-hidden">{label}</span>
          <input
            className="fw-input"
            name="name"
            maxLength={40}
            required
            defaultValue={name ?? ''}
            autoComplete="off"
            placeholder={placeholder}
          />
        </label>
        <Button type="submit" variant="secondary" icon={id ? 'check' : 'plus'} disabled={pending}>
          {id ? 'Rename' : 'Add'}
        </Button>
      </div>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
    </form>
  );
}
