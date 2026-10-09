import { Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import { ResetRequestForm } from './forms';

export const metadata: Metadata = { title: 'Reset your password' };

// [ACC-02] Step 1 of a reset: a link by email, which lands on /reset-password/new signed in.
export default function ResetPasswordPage() {
  return (
    <main className="fw-page">
      <Logo lockup="stacked" width={160} />
      <h1>Reset your password</h1>
      <section className="fw-card">
        <p className="fw-muted">We’ll email you a link to choose a new password.</p>
        <ResetRequestForm />
      </section>
    </main>
  );
}
