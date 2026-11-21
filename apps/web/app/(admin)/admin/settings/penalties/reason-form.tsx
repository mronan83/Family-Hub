'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { MAX_REASON_NAME, type PenaltyUnit } from '@/lib/penalties';
import { addReason } from '../../penalties/actions';

/** [PTS-09] Add a reason: its name, its amount, and points or money. */
export function AddReasonForm() {
  const [state, onSubmit, pending] = useFormAction(addReason, {} as FormState);
  const [unit, setUnit] = useState<PenaltyUnit>('points');
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add a reason">
      <label className="fw-field">
        <span className="fw-field__label">Add a reason</span>
        <input
          className="fw-input"
          name="name"
          maxLength={MAX_REASON_NAME}
          placeholder="Like “Left the lights on”"
          required
          autoComplete="off"
        />
      </label>
      <div className="fw-penalty__add">
        <label className="fw-field fw-penalty__num">
          <span className="fw-field__label">Amount</span>
          <input
            className="fw-input"
            name="amount"
            inputMode={unit === 'money' ? 'decimal' : 'numeric'}
            required
            autoComplete="off"
          />
        </label>
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">In</legend>
          <div className="fw-seg">
            {(['points', 'money'] as const).map((u) => (
              <label key={u} className="fw-seg__item">
                <input
                  className="fw-seg__input"
                  type="radio"
                  name="unit"
                  value={u}
                  checked={unit === u}
                  onChange={() => setUnit(u)}
                />
                {u === 'points' ? 'Points' : 'Money'}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending} icon="plus">
          Add
        </Button>
      </div>
    </form>
  );
}
