'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { LEAD_CHOICES, type ReminderSettings } from '@/lib/reminder-settings';
import { saveSettings } from './actions';

/**
 * [CHR-16][CHR-17][US-318][US-319] When to remind me: the bell for new items, how early, the time
 * for items with no due time, an optional morning digest, optional quiet hours, and whether private
 * items show their title on the lock screen.
 */
export function SettingsForm({ initial }: { initial: ReminderSettings }) {
  const [state, onSubmit, pending] = useFormAction(saveSettings, {} as FormState);
  const [digest, setDigest] = useState(initial.digestTime !== null);
  const [quiet, setQuiet] = useState(initial.quietStart !== null);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="When to remind me">
      <label className="fw-choice">
        <input type="checkbox" name="defaultOn" defaultChecked={initial.defaultOn} />
        Remind me about new items (each has its own bell)
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Remind me</span>
        <select
          className="fw-input"
          name="defaultLeadMinutes"
          defaultValue={String(initial.defaultLeadMinutes)}
        >
          {LEAD_CHOICES.map((c) => (
            <option key={c.minutes} value={c.minutes}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="fw-field__help">An item can say otherwise in its own settings.</span>
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Items with no due time remind me at</span>
        <input
          className="fw-input fw-input--time"
          type="time"
          name="morningTime"
          required
          defaultValue={initial.morningTime}
        />
      </label>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Daily digest</legend>
        <label className="fw-choice">
          <input
            type="checkbox"
            name="digest"
            checked={digest}
            onChange={(e) => setDigest(e.target.checked)}
          />
          Send me a summary of my day
        </label>
        {digest ? (
          <label className="fw-field">
            <span className="fw-field__label">At</span>
            <input
              className="fw-input fw-input--time"
              type="time"
              name="digestTime"
              required
              defaultValue={initial.digestTime ?? '07:00'}
            />
            <span className="fw-field__help">
              What’s overdue and due today. Nothing is sent on a day with nothing to do.
            </span>
          </label>
        ) : null}
      </fieldset>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Quiet hours</legend>
        <label className="fw-choice">
          <input
            type="checkbox"
            name="quiet"
            checked={quiet}
            onChange={(e) => setQuiet(e.target.checked)}
          />
          Hold reminders during quiet hours
        </label>
        {quiet ? (
          <div className="fw-reminders__quiet">
            <label className="fw-field">
              <span className="fw-field__label">From</span>
              <input
                className="fw-input fw-input--time"
                type="time"
                name="quietStart"
                required
                defaultValue={initial.quietStart ?? '21:00'}
              />
            </label>
            <label className="fw-field">
              <span className="fw-field__label">To</span>
              <input
                className="fw-input fw-input--time"
                type="time"
                name="quietEnd"
                required
                defaultValue={initial.quietEnd ?? '07:00'}
              />
            </label>
          </div>
        ) : null}
        <span className="fw-field__help">
          A reminder that falls inside them comes when they end.
        </span>
      </fieldset>
      <label className="fw-choice">
        <input
          type="checkbox"
          name="hidePrivateTitles"
          defaultChecked={initial.hidePrivateTitles}
        />
        Hide the names of private items on my lock screen
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
