'use client';

import { Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Outcome } from '@/lib/chore-sections';
import type { Kind } from '@/lib/chores';
import { doChoreAgain } from './actions';

/**
 * [CHR-23][D-132] Do again's date step (Q7): Tomorrow, the next Saturday, In a week, or any date.
 * Add it adds a new one-time item with the same people, points and time; Change more first opens the
 * form filled in with that date. The first one keeps its completion, points and goal credit.
 */
export function DoAgainSheet({
  id,
  title,
  kind,
  who,
  points,
  outcome,
  finishedOn,
  choices,
  cancelHref,
  back,
}: {
  id: string;
  title: string;
  kind: Kind;
  /** "Maya and Leo". */
  who: string;
  points: number;
  outcome: Outcome;
  /** "Sun, Oct 11". */
  finishedOn: string;
  choices: { label: string; date: string }[];
  cancelHref: string;
  back: string;
}) {
  const [date, setDate] = useState(choices[1]?.date ?? choices[0]!.date);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const what = kind === 'task' ? 'task' : 'chore';
  const kept =
    outcome === 'done'
      ? `The first one stays done on ${finishedOn}.${
          points > 0
            ? ` ${who} ${who.includes(' and ') ? 'keep' : 'keeps'} its ${points} points and its goal credit.`
            : ''
        }`
      : `The first one stays ${outcome === 'missed' ? 'missed' : 'skipped'} on ${finishedOn}.`;
  return (
    <div className="fw-sheet">
      <Link className="fw-sheet__scrim" href={cancelHref} aria-hidden tabIndex={-1} />
      <div
        ref={box}
        className="fw-sheet__box fw-sheet__box--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="again-title"
        tabIndex={-1}
      >
        <h2 id="again-title">Do again: {title}</h2>
        <p className="fw-field__help">
          Adds a new one-time {what} for {who}
          {points > 0 ? `, +${points},` : ''} on the day you pick.
        </p>
        <form action={doChoreAgain} className="fw-form" aria-label={`Do again: ${title}`}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="back" value={back} />
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">When</legend>
            <div className="fw-seg">
              {choices.map((c) => (
                <label key={c.date} className="fw-seg__item">
                  <input
                    className="fw-seg__input"
                    type="radio"
                    name="pick"
                    value={c.date}
                    checked={date === c.date}
                    onChange={() => setDate(c.date)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="fw-field">
            <span className="fw-field__label">Or a date</span>
            <input
              className="fw-input"
              type="date"
              name="on"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <div className="fw-keep">
            <Icon name="check-circle" size={18} />
            <span>{kept}</span>
          </div>
          <div className="fw-actions">
            <Button type="submit">Add it</Button>
            <Button type="submit" variant="secondary" name="then" value="form">
              Change more first
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
