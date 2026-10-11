'use client';

import { Banner, Button, IconPicker, type MemberColor } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { COLOR_NAMES } from '@/lib/members';
import { TAG_COLORS, type TagInput } from '@/lib/tags';
import { saveTag } from './actions';

/** [CHR-10] Add a tag, or rename, recolor or re-icon one. The color always sits beside the name. */
export function TagForm({ id, initial }: { id?: string; initial?: TagInput }) {
  const [state, onSubmit, pending] = useFormAction(saveTag, {} as FormState);
  const label = id ? `Edit ${initial?.name ?? 'tag'}` : 'Add a tag';
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={label}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={30}
          required
          defaultValue={initial?.name ?? ''}
          autoComplete="off"
        />
      </label>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Color</legend>
        <div className="fw-picker">
          {TAG_COLORS.map((c: MemberColor) => (
            <label key={c} className="fw-picker__item">
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={(initial?.color ?? 'member-6') === c}
                className="fw-visually-hidden"
              />
              <span className="fw-swatch" style={{ background: `var(--${c}-line)` }} aria-hidden />
              <span>{COLOR_NAMES[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <IconPicker legend="Icon (optional)" selected={initial?.icon ?? null} start="tags" optional />
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          {id ? 'Save tag' : 'Add tag'}
        </Button>
      </div>
    </form>
  );
}
