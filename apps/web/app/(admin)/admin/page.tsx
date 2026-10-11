import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { day } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { searchPlaces } from '@/lib/weather';
import { revokeInvite, setApprovalMode } from './actions';
import { loadApprovalMode } from './chores/data';
import { AdminHeader } from './header';
import { InviteForm } from './invite-form';
import { WeatherSection } from './weather-section';

export const metadata: Metadata = { title: 'Home' };

const WEEK_START = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const NOTICES: Record<string, string> = {
  welcome: 'Your household is ready. Invite another admin below when you like.',
  joined: 'You’ve joined the household.',
  password: 'Your password is changed.',
};

const APPROVAL_NOTICES: Record<string, string> = {
  on: 'Check-offs now wait for a parent. Ones already done stay done.',
  off: 'Check-offs now count straight away. Any already waiting stay in Today for you to decide.',
  failed: 'That didn’t save. Try again in a moment.',
};

// [ACC-01][ACC-02][ACC-03] Admin home: the household, its admins, and invites. Verified on the
// server; every query runs as this admin through RLS. [BRD-04] Weather on the boards (WP-45): the
// place, found by ?place=, and °F or °C.
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{
    welcome?: string;
    joined?: string;
    password?: string;
    approval?: string;
    place?: string;
    weather?: string;
  }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');

  const params = await searchParams;
  const [admins, invites, approvalMode, weatherSettings, lastRead, found] = await Promise.all([
    db!.rpc('household_admins', { p_household_id: household.id }),
    db!
      .from('invite')
      .select('id, email, expires_at')
      .eq('household_id', household.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at'),
    loadApprovalMode(db!, household.id),
    db!
      .from('household_settings')
      .select('weather_place, temperature_unit')
      .eq('household_id', household.id)
      .maybeSingle(),
    db!
      .from('weather_reading')
      .select('temperature, high, weather_code, is_day, unit, read_at, failed_at, error')
      .eq('household_id', household.id)
      .maybeSingle(),
    params.place ? searchPlaces(params.place) : Promise.resolve(null),
  ]);
  const w = lastRead.data;
  const weatherNotice = (['saved', 'cleared', 'unit', 'failed'] as const).find(
    (n) => n === params.weather,
  );
  const notice = Object.keys(NOTICES).find((k) => params[k as keyof typeof params]);
  const approvalNotice = params.approval ? APPROVAL_NOTICES[params.approval] : undefined;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin" />
      {notice ? (
        <Banner kind="info">{NOTICES[notice]}</Banner>
      ) : approvalNotice ? (
        <Banner kind={params.approval === 'failed' ? 'notice' : 'info'}>{approvalNotice}</Banner>
      ) : null}

      <section className="fw-card" aria-labelledby="household-heading">
        <h1 id="household-heading">{household.name}</h1>
        <p className="fw-muted">
          {household.timezone.replaceAll('_', ' ')} · Week starts on{' '}
          {WEEK_START[household.weekStart]}
          {' · '}Signed in as {user.email}
        </p>
      </section>

      <section className="fw-card" aria-labelledby="approval-heading">
        <h2 id="approval-heading">Check-offs</h2>
        <form action={setApprovalMode} className="fw-form" aria-label="Check-offs">
          <fieldset className="fw-fieldset">
            <legend className="fw-field__label">When a child checks something off</legend>
            <label className="fw-choice">
              <input
                type="radio"
                name="approval"
                value="off"
                defaultChecked={approvalMode === 'off'}
              />
              It counts straight away; a parent can uncheck it later
            </label>
            <label className="fw-choice">
              <input
                type="radio"
                name="approval"
                value="on"
                defaultChecked={approvalMode === 'on'}
              />
              It waits for a parent to approve it
            </label>
          </fieldset>
          <p className="fw-muted">
            Each item can also always or never need a parent, on its own page. Switching changes
            only what’s still to do.
          </p>
          <div className="fw-actions">
            <Button type="submit" icon="check">
              Save
            </Button>
          </div>
        </form>
      </section>

      <WeatherSection
        place={weatherSettings.data?.weather_place ?? null}
        unit={weatherSettings.data?.temperature_unit === 'celsius' ? 'celsius' : 'fahrenheit'}
        last={
          w
            ? {
                temperature: Number(w.temperature),
                high: Number(w.high),
                code: w.weather_code,
                isDay: w.is_day,
                unit: w.unit === 'celsius' ? 'celsius' : 'fahrenheit',
                readAt: w.read_at,
                failedAt: w.failed_at,
                error: w.error,
              }
            : null
        }
        timezone={household.timezone}
        query={params.place ?? null}
        found={found ? (found.ok ? { places: found.places } : { error: found.error }) : null}
        notice={weatherNotice ?? null}
      />

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
