'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { MAX_ADJUSTMENT, MAX_REASON } from '@/lib/points';
import { adjustPoints } from './actions';

/**
 * [PTS-01][US-1106] Add or take away a member's points, with a reason. An entry is never edited or
 * deleted; a mistake is put right with another one. The request id comes from the page, so a double
 * tap posts once.
 */
export function PointsForm({
  memberId,
  name,
  requestId,
}: {
  memberId: string;
  name: string;
  requestId: string;
}) {
  const [state, onSubmit, pending] = useFormAction(adjustPoints, {} as FormState);
  const [direction, setDirection] = useState<'add' | 'take'>('add');

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={`Change ${name}’s points`}>
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Change points</legend>
        <div className="fw-actions">
          {(['add', 'take'] as const).map((d) => (
            <label key={d} className="fw-choice">
              <input
                type="radio"
                name="direction"
                value={d}
                checked={direction === d}
                onChange={() => setDirection(d)}
              />
              {d === 'add' ? 'Add' : 'Take away'}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="fw-field">
        <span className="fw-field__label">Points</span>
        <input
          className="fw-input"
          name="points"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_ADJUSTMENT}
          step={1}
          required
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Why</span>
        <input
          className="fw-input"
          name="reason"
          maxLength={MAX_REASON}
          required
          autoComplete="off"
        />
        <span className="fw-field__help">
          Kept with the points and shown in {name}&rsquo;s history on the board, so word it for the
          family.
        </span>
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending} icon={direction === 'add' ? 'plus' : 'minus'}>
          {direction === 'add' ? 'Add points' : 'Take away points'}
        </Button>
      </div>
    </form>
  );
}
