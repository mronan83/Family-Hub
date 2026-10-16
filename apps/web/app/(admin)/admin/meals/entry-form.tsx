'use client';

import { Banner, Button } from '@familywise/ui';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { dayName } from '@/lib/board-calendar';
import { useFormAction } from '@/lib/forms';
import {
  type MealRow,
  mealsFor,
  peopleWords,
  type PlanEntry,
  type Slot,
  SLOT_WORDS,
  SLOTS,
} from '@/lib/meals';
import { addMealEntry, updateMealEntry } from './actions';

const noChange = () => () => {};

/**
 * [MEAL-01][MEAL-02][MEAL-08][MEAL-10] Add one thing to the week: the day and the meal of the day,
 * a meal from the library (those good for that meal first) or something written in, who it's for
 * (Everyone, or a tick per person), and a note. The form carries the entry's id, so sending it
 * twice adds it once.
 *
 * [MEAL-15][US-701] With `entry`, the same form edits that entry (WP-76): filled with what was saved,
 * named "Edit …", saved in place with **Save changes**, or left with **Cancel**. Save waits until the
 * page is hydrated: before then a submit is the browser's own, which reloads the page and saves nothing.
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
  entry,
  name,
  cancelHref,
}: {
  id: string;
  week: string;
  days: string[];
  today: string;
  members: { id: string; displayName: string }[];
  meals: MealRow[];
  initialDay: string;
  initialSlot: Slot;
  /** [MEAL-15] The entry to edit, its name, and where Cancel goes. */
  entry?: PlanEntry;
  name?: string;
  cancelHref?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(
    entry ? updateMealEntry : addMealEntry,
    {} as FormState,
  );
  // False on the server and while hydrating, true once React runs the page.
  const hydrated = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const [slot, setSlot] = useState<Slot>(entry?.slot ?? initialSlot);
  // [MEAL-15] An entry's own library meal stays on offer, archived since or not.
  const own = entry?.mealId ? meals.find((m) => m.id === entry.mealId) : undefined;
  const offered = [...(own?.archivedAt ? [own] : []), ...mealsFor(slot, meals)];
  const [what, setWhat] = useState<'meal' | 'text'>(
    entry ? (entry.mealId ? 'meal' : 'text') : offered.length ? 'meal' : 'text',
  );
  // [MEAL-10] Who it's for: none ticked is everyone, and so is every person ticked.
  const [who, setWho] = useState<string[]>(() => {
    const saved = members.filter((m) => entry?.memberIds.includes(m.id)).map((m) => m.id);
    return saved.length === members.length ? [] : saved;
  });
  const tick = (now: string[], id: string, on: boolean) => {
    const next = on ? [...now, id] : now.filter((x) => x !== id);
    return members.every((m) => next.includes(m.id)) ? [] : next;
  };

  return (
    <form
      onSubmit={onSubmit}
      className={entry ? 'fw-form fw-meal-entry__edit' : 'fw-form'}
      aria-label={entry ? `Edit ${name ?? 'this meal'}` : 'Add to the plan'}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="week" value={week} />
      <div className="fw-goal-form__dates">
        <label className="fw-field">
          <span className="fw-field__label">Day</span>
          <select className="fw-input" name="planDate" defaultValue={entry?.planDate ?? initialDay}>
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
            <select
              className="fw-input"
              name="mealId"
              defaultValue={entry?.mealId ?? offered[0]?.id}
            >
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
              defaultValue={entry?.freeText ?? undefined}
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

      <fieldset className="fw-field fw-fieldset" aria-describedby={`${id}-for-help`}>
        <legend className="fw-field__label">For</legend>
        <div className="fw-picker">
          <label className="fw-picker__item">
            <input
              type="checkbox"
              name="member"
              value="everyone"
              checked={who.length === 0}
              onChange={() => setWho([])}
            />
            Everyone
          </label>
          {members.map((m) => (
            <label key={m.id} className="fw-picker__item">
              <input
                type="checkbox"
                name="member"
                value={m.id}
                checked={who.includes(m.id)}
                onChange={(e) => setWho(tick(who, m.id, e.target.checked))}
              />
              {m.displayName}
            </label>
          ))}
        </div>
        <span className="fw-field__help" id={`${id}-for-help`}>
          For{' '}
          {peopleWords(members.filter((m) => who.includes(m.id)).map((m) => m.displayName)) ??
            'everyone'}
          .
        </span>
      </fieldset>

      <label className="fw-field">
        <span className="fw-field__label">Note (optional)</span>
        <input
          className="fw-input"
          name="notes"
          maxLength={200}
          autoComplete="off"
          defaultValue={entry?.notes ?? undefined}
          placeholder={entry ? undefined : 'Make extra for lunch'}
        />
      </label>

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        {entry ? (
          <>
            <Button type="submit" icon="check" disabled={pending || !hydrated}>
              Save changes
            </Button>
            {cancelHref ? (
              <Link href={cancelHref} className="fw-btn fw-btn--ghost">
                Cancel
              </Link>
            ) : null}
          </>
        ) : (
          <Button type="submit" icon="plus" disabled={pending}>
            Add to the plan
          </Button>
        )}
      </div>
    </form>
  );
}
