'use client';

import { Banner, Button } from '@familywise/ui';
import { useActionState, useEffect, useState } from 'react';
import { type FormState, hintMessage, MIN_PASSWORD } from '@/lib/auth/messages';
import { signOut } from '../admin/actions';
import { acceptInvite, type InvitePreview, joinWithNewAccount, previewInvite } from './actions';

// The token rides after `#`, which browsers never send to a server. It is kept in this browser
// while the invitee signs in (possibly by a magic link in another tab) and dropped once used.
const KEY = 'familywise.invite';

function readToken(): string {
  const fromLink = window.location.hash.slice(1);
  try {
    if (fromLink) localStorage.setItem(KEY, fromLink);
    return fromLink || localStorage.getItem(KEY) || '';
  } catch {
    return fromLink;
  }
}

function forgetToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'found'; token: string; invite: InvitePreview };

/** [ACC-03] The invite page: who invited you to what, then join (signed in) or create an account. */
export function InviteClient({
  signedInEmail,
  canCreateAccount,
}: {
  signedInEmail: string | null;
  canCreateAccount: boolean;
}) {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const token = readToken();
    (token ? previewInvite(token) : Promise.resolve(null)).then(
      (invite) => setView(invite ? { kind: 'found', token, invite } : { kind: 'missing' }),
      () => setView({ kind: 'missing' }),
    );
  }, []);

  if (view.kind === 'loading') return <p className="fw-muted">Opening your invite…</p>;
  if (view.kind === 'missing') {
    return <Banner kind="notice">{hintMessage({ hint: 'invite_unknown' })}</Banner>;
  }
  const { token, invite } = view;
  if (invite.state !== 'valid') {
    return <Banner kind="notice">{hintMessage({ hint: `invite_${invite.state}` })}</Banner>;
  }

  return (
    <section className="fw-card" aria-labelledby="invite-heading">
      <h2 id="invite-heading">Join {invite.householdName}</h2>
      <p className="fw-muted">
        This invite is for <strong>{invite.email}</strong>. You’ll be an admin of the household.
      </p>
      {signedInEmail === invite.email ? (
        <AcceptForm token={token} />
      ) : signedInEmail ? (
        <>
          <Banner kind="notice">
            You’re signed in as {signedInEmail}. Sign out, then sign in as {invite.email} to join.
          </Banner>
          <form action={signOut}>
            <input type="hidden" name="next" value="/invite" />
            <Button type="submit" variant="ghost" icon="logout">
              Sign out
            </Button>
          </form>
        </>
      ) : (
        <>
          <p>
            Already have an account? <a href="/sign-in?next=%2Finvite">Sign in as {invite.email}</a>
            , then come back to this page.
          </p>
          {canCreateAccount ? <NewAccountForm token={token} /> : null}
        </>
      )}
    </section>
  );
}

function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvite, {} as FormState);
  return (
    <form action={action} onSubmit={forgetToken} className="fw-form">
      <input type="hidden" name="token" value={token} />
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="family" disabled={pending}>
          Join household
        </Button>
      </div>
    </form>
  );
}

function NewAccountForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(joinWithNewAccount, {} as FormState);
  return (
    <form action={action} onSubmit={forgetToken} className="fw-form" aria-label="New to FamilyWise">
      <div className="fw-divider">or, new to FamilyWise</div>
      <input type="hidden" name="token" value={token} />
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
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="family" disabled={pending}>
          Create account and join
        </Button>
      </div>
    </form>
  );
}
