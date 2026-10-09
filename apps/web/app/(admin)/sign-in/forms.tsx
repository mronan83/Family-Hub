'use client';

import { Banner, Button } from '@familywise/ui';
import { useFormAction } from '@/lib/forms';
import type { FormState } from '@/lib/auth/messages';
import { sendMagicLink, signInWithPassword } from './actions';

export function PasswordForm({ next }: { next: string }) {
  const [state, onSubmit, pending] = useFormAction(signInWithPassword, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Sign in with password">
      <input type="hidden" name="next" value={next} />
      <label className="fw-field">
        <span className="fw-field__label">Email</span>
        <input className="fw-input" type="email" name="email" autoComplete="username" required />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Password</span>
        <input
          className="fw-input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          Sign in
        </Button>
        <a href="/reset-password">Forgot your password?</a>
      </div>
    </form>
  );
}

export function MagicLinkForm({ next }: { next: string }) {
  const [state, onSubmit, pending] = useFormAction(sendMagicLink, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Email me a sign-in link">
      <input type="hidden" name="next" value={next} />
      <label className="fw-field">
        <span className="fw-field__label">Email</span>
        <input className="fw-input" type="email" name="email" autoComplete="email" required />
      </label>
      {state.message ? (
        <Banner kind={state.sent ? 'info' : 'notice'}>{state.message}</Banner>
      ) : null}
      <div className="fw-actions">
        <Button type="submit" variant="secondary" icon="link" disabled={pending}>
          Email me a link
        </Button>
      </div>
    </form>
  );
}
