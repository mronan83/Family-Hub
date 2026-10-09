import { Banner, Button, Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DEMO_PERSONAS, demoSecret } from '@/lib/auth/demo';
import { SIGN_IN_OFF } from '@/lib/auth/messages';
import { safeNext } from '@/lib/auth/next';
import { signedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { demoSignIn } from './actions';
import { MagicLinkForm, PasswordForm } from './forms';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Ask for a new one below.',
  demo: 'Demo sign-in isn’t ready on this preview yet. It is set up each time e2e runs.',
};

// [ACC-02] Admin sign-in (06 §9: Paper, stacked color logo): password, or a magic link for an
// existing account. There is no sign-up here: accounts come from a setup code or an invite (D-39).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const db = await serverClient();
  if (db && (await signedIn(db))) redirect(next);
  const demo = Boolean(db && demoSecret());
  const notice = params.error ? NOTICES[params.error] : undefined;

  return (
    <main className="fw-page">
      <Logo lockup="stacked" width={160} />
      <h1>Sign in</h1>
      {notice ? <Banner kind="notice">{notice}</Banner> : null}
      {!db ? <Banner kind="notice">{SIGN_IN_OFF}</Banner> : null}

      {demo ? (
        <section className="fw-card" aria-labelledby="demo-heading">
          <h2 id="demo-heading">Preview sign-in</h2>
          <p className="fw-muted">
            Previews run as the demo family. Pick who to be; each is a made-up parent.
          </p>
          <ul className="fw-list">
            {DEMO_PERSONAS.map((p) => (
              <li key={p.key} className="fw-list__row">
                <span>
                  <strong>{p.name}</strong> · {p.about}
                </span>
                <form action={demoSignIn}>
                  <input type="hidden" name="persona" value={p.key} />
                  <input type="hidden" name="next" value={next} />
                  <Button type="submit" variant="secondary">
                    Sign in as {p.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="fw-card" aria-labelledby="password-heading">
        <h2 id="password-heading">With your password</h2>
        <PasswordForm next={next} />
      </section>
      <div className="fw-divider">or</div>
      <section className="fw-card" aria-labelledby="link-heading">
        <h2 id="link-heading">With a link by email</h2>
        <MagicLinkForm next={next} />
      </section>
      <p className="fw-muted">
        New here? FamilyWise is by invitation. Open the invite link an admin shared with you, or
        start a household with a <a href="/setup">setup code</a>.
      </p>
    </main>
  );
}
