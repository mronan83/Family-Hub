'use client';

import { Banner, Button, IconPicker, type IconName } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { saveReward } from './actions';

export interface RewardInitial {
  title: string;
  description: string | null;
  icon: IconName;
  costPoints: number;
  stock: number | null;
  weeklyLimit: number | null;
  active: boolean;
}

/**
 * [PTS-03] Add a reward to the shop, or change one: a name and a cost, and if you like a description,
 * an icon or a photo, how many there are, and how often a child may ask for it in a week.
 */
export function RewardForm({
  id,
  initial,
  hasPhoto,
}: {
  id?: string;
  initial?: RewardInitial;
  hasPhoto?: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(saveReward, {} as FormState);
  const label = id ? `Edit ${initial?.title ?? 'reward'}` : 'Add a reward';
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={label} encType="multipart/form-data">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="title"
          maxLength={80}
          required
          defaultValue={initial?.title ?? ''}
          autoComplete="off"
          placeholder="Movie night"
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Cost in points</span>
        <input
          className="fw-input fw-input--short"
          name="costPoints"
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          required
          defaultValue={initial?.costPoints ?? ''}
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Description (optional)</span>
        <input
          className="fw-input"
          name="description"
          maxLength={300}
          defaultValue={initial?.description ?? ''}
          autoComplete="off"
        />
      </label>
      <IconPicker
        legend="Icon, shown when there’s no photo"
        selected={initial?.icon ?? 'gift'}
        start="rewards"
      />
      <label className="fw-field">
        <span className="fw-field__label">
          {hasPhoto ? 'A new photo (optional)' : 'Photo (optional)'}
        </span>
        <input
          className="fw-input"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
        <span className="fw-field__help">JPEG, PNG or WebP, up to 2 MB.</span>
      </label>
      <label className="fw-field">
        <span className="fw-field__label">How many there are (optional)</span>
        <input
          className="fw-input fw-input--short"
          name="stock"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={initial?.stock ?? ''}
        />
        <span className="fw-field__help">Leave blank for as many as are asked for.</span>
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Times each child may ask in a week (optional)</span>
        <input
          className="fw-input fw-input--short"
          name="weeklyLimit"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          defaultValue={initial?.weeklyLimit ?? ''}
        />
      </label>
      <label className="fw-choice">
        <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} />
        In the shop now
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {id ? 'Save changes' : 'Add reward'}
        </Button>
      </div>
    </form>
  );
}
