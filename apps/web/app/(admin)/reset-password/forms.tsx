'use client';

import { Banner, Button } from '@familywise/ui';
import { useFormAction } from '@/lib/forms';
import { type FormState, MIN_PASSWORD } from '@/lib/auth/messages';
import { sendResetLink, setNewPassword } from './actions';

export function ResetRequestForm() {
  const [state, onSubmit, pending] = useFormAction(sendResetLink, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Email me a reset link">
      <label className="fw-field">
        <span className="fw-field__label">Email</span>
        <input className="fw-input" type="email" name="email" autoComplete="email" required />
      </label>
      {state.message ? (
        <Banner kind={state.sent ? 'info' : 'notice'}>{state.message}</Banner>
      ) : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          Email me a reset link
        </Button>
        <a href="/sign-in">Back to sign in</a>
      </div>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, onSubmit, pending] = useFormAction(setNewPassword, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Choose a new password">
      <label className="fw-field">
        <span className="fw-field__label">New password</span>
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
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          Save password
        </Button>
      </div>
    </form>
  );
}
