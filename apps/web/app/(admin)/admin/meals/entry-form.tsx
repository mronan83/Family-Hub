'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { dayName } from '@/lib/board-calendar';
import { useFormAction } from '@/lib/forms';
import { type MealRow, mealsFor, type Slot, SLOT_WORDS, SLOTS } from '@/lib/meals';
import { addMealEntry } from './actions';

/**
 * [MEAL-01][MEAL-02][MEAL-08] Add one thing to the week: the day and the meal of the day, a meal
 * from the library (those good for that meal first) or something written in, who it's for, and a
 * note. The form carries the entry's id, so sending it twice adds it once.
 */
export function EntryForm({
  id,
  week,
  days,
  today,
  members,
  meals,
  initialDay,
  initialSlot,
}: {
  id: string;
  week: string;
  days: string[];
  today: string;
  members: { id: string; displayName: string }[];
  meals: MealRow[];
  initialDay: string;
  initialSlot: Slot;
}) {
  const [state, onSubmit, pending] = useFormAction(addMealEntry, {} as FormState);
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const offered = mealsFor(slot, meals);
  const [what, setWhat] = useState<'meal' | 'text'>(offered.length ? 'meal' : 'text');

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add to the plan">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="week" value={week} />
      <div className="fw-goal-form__dates">
        <label className="fw-field">
          <span className="fw-field__label">Day</span>
          <select className="fw-input" name="planDate" defaultValue={initialDay}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
                {d === today ? ' (today)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="fw-field">
          <span className="fw-field__label">Meal</span>
          <select
            className="fw-input"
            name="slot"
            value={slot}
            onChange={(e) => setSlot(e.target.value as Slot)}
          >
            {SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">What</legend>
        <div className="fw-actions">
          <label className="fw-choice">
            <input
              type="radio"
              name="what"
              value="meal"
              checked={what === 'meal'}
              disabled={offered.length === 0}
              onChange={() => setWhat('meal')}
            />
            From the library
          </label>
          <label className="fw-choice">
            <input
              type="radio"
              name="what"
              value="text"
              checked={what === 'text'}
              onChange={() => setWhat('text')}
            />
            Something else
          </label>
        </div>
        {what === 'meal' ? (
          <label className="fw-field">
            <span className="fw-field__label">From the library</span>
            <select className="fw-input" name="mealId" defaultValue={offered[0]?.id}>
              {offered.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="fw-field">
            <span className="fw-field__label">Something else</span>
            <input
              className="fw-input"
              name="freeText"
              maxLength={80}
              required
              autoComplete="off"
              placeholder="Leftovers"
            />
          </label>
        )}
        {offered.length === 0 ? (
          <span className="fw-field__help">
            Add meals to the library to choose them here; anything can be written in.
          </span>
        ) : null}
      </fieldset>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">For</legend>
        <div className="fw-picker">
          <label className="fw-picker__item">
            <input type="radio" name="member" value="everyone" defaultChecked />
            Everyone
          </label>
          {members.map((m) => (
            <label key={m.id} className="fw-picker__item">
              <input type="radio" name="member" value={m.id} />
              {m.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="fw-field">
        <span className="fw-field__label">Note (optional)</span>
        <input
          className="fw-input"
          name="notes"
          maxLength={200}
          autoComplete="off"
          placeholder="Make extra for lunch"
        />
      </label>

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="plus" disabled={pending}>
          Add to the plan
        </Button>
      </div>
    </form>
  );
}
