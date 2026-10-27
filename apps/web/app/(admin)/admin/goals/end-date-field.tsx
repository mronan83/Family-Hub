'use client';

import { Button, DatePick } from '@familywise/ui';
import { useEffect, useRef, useState } from 'react';
import { END_CHOICE_FIELD, ENDS_ON_DATE_FIELD } from '@/lib/goals';

/**
 * [RWD-14] A goal's end date, which can be taken off on every device (D-115). **Ends on a date** is a
 * check box: ticked, the date field shows, with **Clear** once a date is chosen; unticked, the field
 * is hidden and its date cleared, so ticking it again starts empty.
 *
 * The saved date is the field's value, never its default: an iPhone's picker puts a date field back
 * to its default, so a default of the saved date made the picker's clear do nothing. The server
 * renders it as the default, so the date shows before the page is hydrated; the field's first mount
 * sets it as the value, and once hydrated the default is dropped (React 19 removes the attribute).
 * [NFR-16][D-128] The date is written as the mockups write it, "Mon, Oct 12, 2026" (DatePick).
 */
export function EndDateField({
  initial,
  min,
  onEnd,
}: {
  initial: string | null;
  min?: string;
  /** [RWD-21] The end date as it stands (null for none), for the items the goal lists. */
  onEnd?: (end: string | null) => void;
}) {
  const [ends, setEnds] = useState(Boolean(initial));
  const [date, setDate] = useState(initial ?? '');
  // Only the first field gets the saved date: ticked again after unticking, it starts empty.
  const [seed, setSeed] = useState(initial ?? '');
  const input = useRef<HTMLInputElement | null>(null);
  const end = ends && date ? date : null;
  useEffect(() => onEnd?.(end), [end, onEnd]);

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
            if (!e.target.checked) {
              setDate('');
              setSeed('');
            }
          }}
        />
        Ends on a date
      </label>
      {ends ? (
        <div className="fw-end-date__row">
          <DatePick
            type="date"
            name="endDate"
            label="End date"
            min={min}
            initial={seed}
            value={date}
            onValue={setDate}
            inputRef={input}
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
