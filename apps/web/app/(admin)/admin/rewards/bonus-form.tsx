'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { MAX_BONUS, MAX_STREAK_DAYS, type BonusRuleType } from '@/lib/bonus';
import { useFormAction } from '@/lib/forms';
import { saveBonusRule } from './actions';

/**
 * [PTS-05][US-1107] Add a bonus: points for a run of good days (the same good days as the flame), or
 * for each day with everything done, counting from a day (today unless you choose).
 */
export function BonusForm({ today }: { today: string }) {
  const [state, onSubmit, pending] = useFormAction(saveBonusRule, {} as FormState);
  const [type, setType] = useState<BonusRuleType>('streak_bonus');
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add a bonus">
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Pays for</legend>
        <div className="fw-actions">
          {(['streak_bonus', 'all_done_bonus'] as const).map((k) => (
            <label key={k} className="fw-choice">
              <input
                type="radio"
                name="ruleType"
                value={k}
                checked={type === k}
                onChange={() => setType(k)}
              />
              {k === 'streak_bonus' ? 'A streak' : 'A perfect day'}
            </label>
          ))}
        </div>
        <span className="fw-field__help">
          {type === 'streak_bonus'
            ? 'Once for each run of good days that reaches the length.'
            : 'Each day with everything on the list done.'}
        </span>
      </fieldset>
      {type === 'streak_bonus' ? (
        <label className="fw-field">
          <span className="fw-field__label">Good days in a row</span>
          <input
            className="fw-input fw-input--short"
            name="streakDays"
            type="number"
            inputMode="numeric"
            min={2}
            max={MAX_STREAK_DAYS}
            required
            defaultValue={7}
          />
        </label>
      ) : null}
      <label className="fw-field">
        <span className="fw-field__label">Bonus points</span>
        <input
          className="fw-input fw-input--short"
          name="bonusPoints"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_BONUS}
          required
          defaultValue={type === 'streak_bonus' ? 20 : 5}
          key={type}
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Counts from</span>
        <input
          className="fw-input fw-input--date"
          name="countsFrom"
          type="date"
          required
          defaultValue={today}
        />
        <span className="fw-field__help">Days before this never pay.</span>
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="plus" disabled={pending}>
          Add bonus
        </Button>
      </div>
    </form>
  );
}
