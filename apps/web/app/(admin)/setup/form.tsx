'use client';

import { Banner, Button } from '@familywise/ui';
import { useFormAction } from '@/lib/forms';
import { useEffect, useRef } from 'react';
import { type FormState, MIN_PASSWORD } from '@/lib/auth/messages';
import { setUpHousehold } from './actions';

const WEEK_STARTS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
];

/** [ACC-01] The setup form; `withAccount` adds email and password when nobody is signed in. */
export function SetupForm({
  timezones,
  withAccount,
}: {
  timezones: string[];
  withAccount: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(setUpHousehold, {} as FormState);
  const zone = useRef<HTMLSelectElement>(null);

  // Start from this device's timezone; the list is rendered on the server, so pick it after mount.
  useEffect(() => {
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone.current && timezones.includes(here)) zone.current.value = here;
  }, [timezones]);

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Set up your household">
      <label className="fw-field">
        <span className="fw-field__label">Setup code</span>
        <input
          className="fw-input"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <span className="fw-field__help">It works once, for 24 hours.</span>
      </label>
      {withAccount ? (
        <>
          <label className="fw-field">
            <span className="fw-field__label">Your email</span>
            <input className="fw-input" type="email" name="email" autoComplete="email" required />
          </label>
          <label className="fw-field">
            <span className="fw-field__label">Choose a password</span>
            <input
              className="fw-input"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
            />
            <span className="fw-field__help">At least {MIN_PASSWORD} characters.</span>
          </label>
        </>
      ) : null}
      <label className="fw-field">
        <span className="fw-field__label">Household name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={80}
          placeholder="The Rivera family"
          required
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Timezone</span>
        <select className="fw-input" name="timezone" ref={zone} defaultValue="America/New_York">
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <span className="fw-field__help">The board’s day starts and ends in this timezone.</span>
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Week starts on</span>
        <select className="fw-input" name="weekStart" defaultValue="0">
          {WEEK_STARTS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="home" disabled={pending}>
          Create household
        </Button>
      </div>
    </form>
  );
}
