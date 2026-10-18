'use client';

import { Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { andList } from '@/lib/format';
import type { GroceryItem } from '@/lib/groceries';
import { rowNotes, startTicked, type WeekReview } from '@/lib/meal-groceries';
import { addWeekToGroceries } from './actions';

/**
 * [MEAL-19][MEAL-20] The week's Add to groceries (WP-105, D-138 (6)): each planned meal with its
 * ingredients, in day order; what we usually have and a meal already added that week start unticked;
 * a row that merges says what it makes. Nothing is added until "Add n to groceries".
 */
export function WeekGroceries({
  review,
  open,
  week,
  cancelHref,
}: {
  review: WeekReview;
  open: readonly GroceryItem[];
  week: string;
  cancelHref: string;
}) {
  const [ticked, setTicked] = useState<Set<string>>(() => startTicked(review));
  const notes = useMemo(() => rowNotes(review, ticked, open), [review, ticked, open]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const toggle = (id: string) =>
    setTicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = ticked.size;
  return (
    <div className="fw-sheet">
      <Link className="fw-sheet__scrim" href={cancelHref} aria-hidden tabIndex={-1} />
      <div
        ref={box}
        className="fw-sheet__box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wg-title"
        tabIndex={-1}
      >
        <h2 id="wg-title">Add this week to groceries</h2>
        <p className="fw-muted">
          Untick what you have. Things already on the list are merged, not added twice.
          {review.without.length > 0
            ? ` ${andList(review.without)} ${review.without.length === 1 ? 'has' : 'have'} no ingredients yet.`
            : ''}
        </p>
        {review.meals.length === 0 ? (
          <p>No meal planned this week has ingredients yet. Add them in the Meal library.</p>
        ) : null}
        <form action={addWeekToGroceries} className="fw-wg" aria-label="Add this week to groceries">
          <input type="hidden" name="week" value={week} />
          <input type="hidden" name="rows" value={JSON.stringify([...ticked])} />
          {review.meals.map((m) => (
            <fieldset key={m.entryId} className="fw-wg__meal">
              <legend>
                <Icon name="utensils" size={18} />
                <b>{m.name}</b> <span className="fw-muted">{m.day}</span>
              </legend>
              {m.rows.map((r) => {
                const note = notes.get(r.id);
                return (
                  <label key={r.id} className="fw-choice fw-wg__row">
                    <input
                      type="checkbox"
                      checked={ticked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="fw-wg__name">
                      {r.name}
                      {r.amount ? <span className="fw-wg__amt"> {r.amount}</span> : null}
                    </span>
                    {note ? (
                      <span className={`fw-wg__note${note.merge ? ' fw-wg__note--merge' : ''}`}>
                        {note.text}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="fw-actions">
            <Button type="submit" icon="plus" disabled={n === 0}>
              {`Add ${n} to groceries`}
            </Button>
            <Link className="fw-btn fw-btn--ghost" href={cancelHref}>
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
