'use client';

import { Banner, Button } from '@familywise/ui';
import { useActionState, useState } from 'react';
import { createInvite, type InviteState } from './actions';

/** [ACC-03] Invite an admin: the link appears once, to copy or share (no email is sent, 01 §9.10). */
export function InviteForm() {
  const [state, action, pending] = useActionState(createInvite, {} as InviteState);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fw-form">
      <form
        action={action}
        className="fw-form"
        aria-label="Invite an admin"
        onSubmit={() => setCopied(false)}
      >
        <label className="fw-field">
          <span className="fw-field__label">Their email</span>
          <input className="fw-input" type="email" name="email" autoComplete="off" required />
          <span className="fw-field__help">They sign in with this email to join.</span>
        </label>
        {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
        <div className="fw-actions">
          <Button type="submit" icon="plus" disabled={pending}>
            Create invite link
          </Button>
        </div>
      </form>
      {state.link ? (
        <div className="fw-card" aria-live="polite">
          <p>
            Invite link for <strong>{state.email}</strong>. Send it to them yourself. It works once,
            for 7 days, and anyone with it can join, so share it only with them.
          </p>
          <p className="fw-code" data-testid="invite-link">
            {state.link}
          </p>
          <div className="fw-actions">
            <Button variant="secondary" icon="copy" onClick={() => copy(state.link!)}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {canShare ? (
              <Button
                variant="ghost"
                icon="link"
                onClick={() =>
                  navigator
                    .share({ title: 'Join our household on FamilyWise', url: state.link! })
                    .catch(() => {})
                }
              >
                Share
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
