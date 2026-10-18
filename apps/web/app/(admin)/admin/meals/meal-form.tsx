'use client';

import { Banner, Button, IconPicker, type IconName } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { useState } from 'react';
import { type Ingredient, type MealFormValue, SLOT_WORDS, SLOTS } from '@/lib/meals';
import { saveMeal } from './actions';
import { IngredientsField } from './ingredients-field';
import { RecipeField } from './recipe-field';

/**
 * [MEAL-02][MEAL-07] Add a meal to the library, or change one: its name, a description, what it's good
 * for (offered first for those meals of the day), a recipe link, its ingredients (WP-105) and an icon.
 */
export function MealForm({
  id,
  initial: editing,
  copy,
  copyFrom,
  householdId,
}: {
  id?: string;
  initial?: MealFormValue;
  /** [D-132] Duplicate: a new meal, filled in from another (WP-96). */
  copy?: MealFormValue;
  /** [MEAL-25] Duplicate's original: its photos and PDFs are copied once the copy is saved. */
  copyFrom?: string;
  /** [MEAL-25] Where its photos and PDFs go in storage (WP-105). */
  householdId: string;
}) {
  const [state, onSubmit, pending] = useFormAction(saveMeal, {} as FormState);
  const initial = editing ?? copy;
  const [filled, setFilled] = useState<{ seq: number; rows: Ingredient[] } | null>(null);
  return (
    <form
      onSubmit={onSubmit}
      className="fw-form"
      aria-label={editing ? `Edit ${editing.name}` : 'Add a meal'}
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {copy && copyFrom ? <input type="hidden" name="copyFrom" value={copyFrom} /> : null}
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
      <RecipeField
        mealId={id}
        householdId={householdId}
        url={initial?.recipeUrl ?? null}
        files={editing?.recipeFiles ?? []}
        onRows={(rows) => setFilled((was) => ({ seq: (was?.seq ?? 0) + 1, rows }))}
      />
      {/* [MEAL-25] A copy's steps and files come from its original (D-132). */}
      {copy?.recipeSteps?.length ? (
        <input type="hidden" name="recipeSteps" value={JSON.stringify(copy.recipeSteps)} />
      ) : null}
      {copy?.recipeFiles?.length ? (
        <p className="fw-field__help">
          {copy.recipeFiles.map((f) => f.name).join(', ')}{' '}
          {copy.recipeFiles.length === 1 ? 'is' : 'are'} copied with it when you tap <b>Add meal</b>
          .
        </p>
      ) : null}
      <IngredientsField initial={initial?.ingredients ?? []} rows={filled} />
      <IconPicker
        legend="Icon"
        selected={(initial?.icon ?? 'utensils') as IconName}
        start="kitchen"
      />
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {editing ? 'Save changes' : 'Add meal'}
        </Button>
      </div>
    </form>
  );
}
