import { Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import { requireSignedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { NewPasswordForm } from '../forms';

export const metadata: Metadata = { title: 'Choose a new password' };

// [ACC-02] Step 2 of a reset: the reset link signed the admin in; they choose a new password, and
// every other session of theirs is signed out.
export default async function NewPasswordPage() {
  const user = await requireSignedIn(await serverClient(), '/reset-password/new');
  return (
    <main className="fw-page">
      <Logo lockup="stacked" width={160} />
      <h1>Choose a new password</h1>
      <section className="fw-card">
        {user.email ? <p className="fw-muted">For {user.email}.</p> : null}
        <NewPasswordForm />
      </section>
    </main>
  );
}
