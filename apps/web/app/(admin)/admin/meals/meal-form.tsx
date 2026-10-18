'use client';

import { Banner, Button, IconPicker, type IconName } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { type MealFormValue, SLOT_WORDS, SLOTS } from '@/lib/meals';
import { saveMeal } from './actions';
import { IngredientsField } from './ingredients-field';

/**
 * [MEAL-02][MEAL-07] Add a meal to the library, or change one: its name, a description, what it's good
 * for (offered first for those meals of the day), a recipe link, its ingredients (WP-105) and an icon.
 */
export function MealForm({ id, initial }: { id?: string; initial?: MealFormValue }) {
  const [state, onSubmit, pending] = useFormAction(saveMeal, {} as FormState);
  return (
    <form
      onSubmit={onSubmit}
      className="fw-form"
      aria-label={initial ? `Edit ${initial.name}` : 'Add a meal'}
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={80}
          required
          defaultValue={initial?.name ?? ''}
          autoComplete="off"
          placeholder="Tacos"
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
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Good for</legend>
        <div className="fw-actions">
          {SLOTS.map((s) => (
            <label key={s} className="fw-choice">
              <input
                type="checkbox"
                name="mealTypes"
                value={s}
                defaultChecked={initial?.mealTypes.includes(s)}
              />
              {SLOT_WORDS[s]}
            </label>
          ))}
        </div>
        <span className="fw-field__help">
          Offered first for these. None ticked: offered first for any.
        </span>
      </fieldset>
      <label className="fw-field">
        <span className="fw-field__label">Recipe link (optional)</span>
        <input
          className="fw-input"
          name="recipeUrl"
          type="url"
          maxLength={500}
          defaultValue={initial?.recipeUrl ?? ''}
          autoComplete="off"
          placeholder="https://"
        />
      </label>
      <IngredientsField initial={initial?.ingredients ?? []} />
      <IconPicker
        legend="Icon"
        selected={(initial?.icon ?? 'utensils') as IconName}
        start="kitchen"
      />
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {initial ? 'Save changes' : 'Add meal'}
        </Button>
      </div>
    </form>
  );
}
