'use client';

import { Banner, Button, Icon, iconLabel, type IconName, type MemberColor } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { COLOR_NAMES } from '@/lib/members';
import { TAG_COLORS, TAG_ICONS, type TagInput } from '@/lib/tags';
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
              <span className="fw-swatch" style={{ background: `var(--${c})` }} aria-hidden />
              <span>{COLOR_NAMES[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Icon (optional)</legend>
        <div className="fw-picker">
          <label className="fw-picker__item">
            <input
              type="radio"
              name="icon"
              value=""
              defaultChecked={!initial?.icon}
              className="fw-visually-hidden"
            />
            <span>None</span>
          </label>
          {TAG_ICONS.map((name: IconName) => (
            <label key={name} className="fw-picker__item fw-picker__item--icon">
              <input
                type="radio"
                name="icon"
                value={name}
                defaultChecked={initial?.icon === name}
                aria-label={iconLabel(name)}
                className="fw-visually-hidden"
              />
              <Icon name={name} size={24} />
            </label>
          ))}
        </div>
      </fieldset>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          {id ? 'Save tag' : 'Add tag'}
        </Button>
      </div>
    </form>
  );
}
