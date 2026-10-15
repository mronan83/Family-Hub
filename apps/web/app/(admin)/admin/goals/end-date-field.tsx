'use client';

import { Button } from '@familywise/ui';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { END_CHOICE_FIELD, ENDS_ON_DATE_FIELD } from '@/lib/goals';

/** Nothing to subscribe to: useSyncExternalStore here only tells hydration from after it. */
const noChange = () => () => {};

/**
 * [RWD-14] A goal's end date, which can be taken off on every device (D-115). **Ends on a date** is a
 * check box: ticked, the date field shows, with **Clear** once a date is chosen; unticked, the field
 * is hidden and its date cleared, so ticking it again starts empty.
 *
 * The saved date is the field's value, never its default: an iPhone's picker puts a date field back
 * to its default, so a default of the saved date made the picker's clear do nothing. The server
 * renders it as the default, so the date shows before the page is hydrated; the field's first mount
 * sets it as the value, and once hydrated the default is dropped (React 19 removes the attribute).
 */
export function EndDateField({ initial, min }: { initial: string | null; min?: string }) {
  const [ends, setEnds] = useState(Boolean(initial));
  const [date, setDate] = useState(initial ?? '');
  const hydrating = useSyncExternalStore(
    noChange,
    () => false,
    () => true,
  );
  const input = useRef<HTMLInputElement | null>(null);
  const seeded = useRef(false);
  const field = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      // Only the first field gets the saved date: ticked again after unticking, it starts empty.
      if (el && !seeded.current) {
        seeded.current = true;
        el.value = initial ?? '';
      }
    },
    [initial],
  );

  return (
    <fieldset className="fw-field fw-fieldset fw-end-date">
      <legend className="fw-field__label">Ends</legend>
      <input type="hidden" name={END_CHOICE_FIELD} value="1" />
      <label className="fw-choice">
        <input
          type="checkbox"
          name={ENDS_ON_DATE_FIELD}
          checked={ends}
          onChange={(e) => {
            setEnds(e.target.checked);
            if (!e.target.checked) setDate('');
          }}
        />
        Ends on a date
      </label>
      {ends ? (
        <div className="fw-end-date__row">
          <input
            ref={field}
            className="fw-input"
            type="date"
            name="endDate"
            aria-label="End date"
            min={min}
            defaultValue={hydrating ? (initial ?? '') : undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          {date ? (
            <Button
              variant="secondary"
              icon="close"
              onClick={() => {
                // Clear never moves to the date field: on an iPhone that opens the picker again.
                if (input.current) input.current.value = '';
                setDate('');
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
      <span className="fw-field__help">
        {!ends
          ? 'No end date. It keeps going until it’s reached or you end it.'
          : date
            ? 'It stops counting after this day. Tap the date to change it.'
            : 'Choose the day it ends. Left empty, it saves with no end date.'}
      </span>
    </fieldset>
  );
}
