import { Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, signedIn } from '@/lib/auth/session';
import { adminClient } from '@/lib/supabase/admin';
import { serverClient } from '@/lib/supabase/server';
import { SetupForm } from './form';

export const metadata: Metadata = { title: 'Set up your household' };

function timezones(): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : [...zones, 'UTC'];
}

// [ACC-01] Onboarding: a household with its timezone and week start, and its owner. Reached with a
// setup code; a parent joining an existing household uses an invite link instead.
export default async function SetupPage() {
  const db = await serverClient();
  const user = db ? await signedIn(db) : null;
  if (db && user && (await adminHousehold(db, user.userId))) redirect('/admin');
  // Signed out, the account is created here, which needs the secret key: production only.
  const canCreateAccount = !user && adminClient() !== null;

  return (
    <main className="fw-page">
      <Logo lockup="stacked" width={160} />
      <h1>Set up your household</h1>
      {user || canCreateAccount ? (
        <section className="fw-card">
          {user?.email ? (
            <p className="fw-muted">Signed in as {user.email}. You’ll be the household’s owner.</p>
          ) : (
            <p className="fw-muted">
              You’ll be the household’s owner. Already have an account?{' '}
              <a href="/sign-in?next=%2Fsetup">Sign in first</a>.
            </p>
          )}
          <SetupForm timezones={timezones()} withAccount={!user} />
        </section>
      ) : (
        <section className="fw-card">
          <p>
            <a href="/sign-in?next=%2Fsetup">Sign in</a> first, then come back here with your setup
            code.
          </p>
        </section>
      )}
      <p className="fw-muted">
        Joining a household someone else runs? Open the invite link they shared with you.
      </p>
    </main>
  );
}
