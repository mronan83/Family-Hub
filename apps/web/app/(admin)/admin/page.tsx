import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { day } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { revokeInvite } from './actions';
import { AdminHeader } from './header';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Home' };

const WEEK_START = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NOTICES: Record<string, string> = {
  welcome: 'Your household is ready. Invite another admin below when you like.',
  joined: 'You’ve joined the household.',
  password: 'Your password is changed.',
};

// [ACC-01][ACC-02][ACC-03] Admin home: the household, its admins, and invites. Verified on the
// server; every query runs as this admin through RLS.
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; joined?: string; password?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');

  const [admins, invites] = await Promise.all([
    db!.rpc('household_admins', { p_household_id: household.id }),
    db!
      .from('invite')
      .select('id, email, expires_at')
      .eq('household_id', household.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at'),
  ]);
  const params = await searchParams;
  const notice = Object.keys(NOTICES).find((k) => params[k as keyof typeof params]);

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin" />
      {notice ? <Banner kind="info">{NOTICES[notice]}</Banner> : null}

      <section className="fw-card" aria-labelledby="household-heading">
        <h1 id="household-heading">{household.name}</h1>
        <p className="fw-muted">
          {household.timezone.replaceAll('_', ' ')} · Week starts on{' '}
          {WEEK_START[household.weekStart]}
          {' · '}Signed in as {user.email}
        </p>
      </section>

      <section className="fw-card" aria-labelledby="admins-heading">
        <h2 id="admins-heading">Admins</h2>
        <ul className="fw-list">
          {(admins.data ?? []).map((a: { user_id: string; email: string; role: string }) => (
            <li key={a.user_id} className="fw-list__row">
              <span>{a.email}</span>
              <span className="fw-muted">{a.role === 'owner' ? 'Owner' : 'Admin'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fw-card" aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite an admin</h2>
        <InviteForm />
        {invites.data && invites.data.length > 0 ? (
          <>
            <h3>Waiting to join</h3>
            <ul className="fw-list" aria-label="Open invites">
              {invites.data.map((i) => (
                <li key={i.id} className="fw-list__row">
                  <span>
                    {i.email}
                    <span className="fw-muted">
                      {' '}
                      · Expires {day(i.expires_at, household.timezone)}
                    </span>
                  </span>
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" variant="ghost" icon="close">
                      Cancel invite
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}
