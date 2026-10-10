import { Banner, Icon } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { dayAndTime } from '@/lib/format';
import { JOB_STATES, jobLabel, usageLines, type JobState, type UsageRow } from '@/lib/health';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';

export const metadata: Metadata = { title: 'System health' };

interface JobRow {
  job_type: string;
  state: JobState;
  last_ok_at: string | null;
  last_run_at: string | null;
  message: string | null;
}

interface ErrorRow {
  occurred_at: string;
  route: string | null;
  kind: string;
  message: string;
}

// [NFR-07][NFR-08] System Health (WP-42, D-42): this household's background jobs and server errors,
// and the deployment's usage against the Free-plan limits. Every read goes through a database
// function that checks the caller is an admin, so a household sees only its own jobs and errors.
export default async function HealthPage() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/health');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const tz = household.timezone;

  const [jobsRes, errorsRes, usageRes, demoRes, calendarsRes] = await Promise.all([
    db!.rpc('job_health', { p_household_id: household.id }),
    db!.rpc('household_errors', { p_household_id: household.id, p_limit: 20 }),
    db!.rpc('system_usage'),
    db!.from('household').select('is_demo').eq('id', household.id).maybeSingle(),
    // [CAL-06] A calendar whose link fails is its own state, not a failing job (D-63): said here too.
    db!
      .from('calendar_source')
      .select('name')
      .eq('household_id', household.id)
      .eq('status', 'error')
      .order('name'),
  ]);
  for (const r of [jobsRes, errorsRes, usageRes, calendarsRes]) {
    if (r.error) throw new Error(`system health: ${r.error.message}`);
  }
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const errors = (errorsRes.data ?? []) as ErrorRow[];
  const usage = usageLines((usageRes.data ?? []) as UsageRow[], new Date());
  // [NFR-07] Production's jobs leave the demo family alone (D-62); previews run as it.
  const demo = demoRes.data?.is_demo === true;
  const failing = jobs.filter((j) => j.state === 'failing' || j.state === 'stale');
  const near = usage.lines.filter((l) => l.warn);
  const broken = ((calendarsRes.data ?? []) as { name: string }[]).map((c) => c.name);

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/health" />
      <section className="fw-card" aria-labelledby="health-heading">
        <h1 id="health-heading">System health</h1>
        {failing.length === 0 && near.length === 0 && broken.length === 0 ? (
          <Banner kind="info">Everything is running normally.</Banner>
        ) : null}
        {failing.length > 0 ? (
          <Banner kind="notice">
            {failing.length === 1 ? 'A background job needs' : 'Background jobs need'} attention:{' '}
            {failing.map((j) => jobLabel(j.job_type)).join(', ')}.
          </Banner>
        ) : null}
        {broken.length > 0 ? (
          <Banner kind="notice">
            {broken.length === 1 ? 'A calendar can’t sync' : 'Calendars can’t sync'}:{' '}
            {broken.join(', ')}. The board keeps their last good events; see{' '}
            <Link href="/admin/calendars">Calendars</Link> for what to do.
          </Banner>
        ) : null}
        {near.length > 0 ? (
          <Banner kind="stale">
            Near a Free-plan limit: {near.map((l) => l.label).join(', ')}. See Usage below.
          </Banner>
        ) : null}
      </section>

      <section className="fw-card" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading">Background jobs</h2>
        {demo ? (
          <p className="fw-muted">
            The background jobs leave the demo family alone, so here they show as not run yet. In a
            real household they run on schedule.
          </p>
        ) : null}
        {jobs.length === 0 ? (
          <p className="fw-muted">No background jobs are scheduled yet.</p>
        ) : (
          <ul className="fw-list" aria-label="Background jobs">
            {jobs.map((j) => (
              <li key={j.job_type} className="fw-list__row fw-health__row" data-state={j.state}>
                <span>
                  <strong>{jobLabel(j.job_type)}</strong>
                  <span className="fw-muted">
                    {' · '}
                    {j.last_ok_at
                      ? `Last worked ${dayAndTime(j.last_ok_at, tz)}`
                      : 'Has not worked yet'}
                  </span>
                  {j.message ? <span className="fw-health__message">{j.message}</span> : null}
                </span>
                <span className="fw-health__state">
                  <Icon name={JOB_STATES[j.state].icon} size={20} />
                  {JOB_STATES[j.state].label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="errors-heading">
        <h2 id="errors-heading">Server errors</h2>
        {errors.length === 0 ? (
          <p className="fw-muted">No server errors for your household in the last 30 days.</p>
        ) : (
          <ul className="fw-list" aria-label="Server errors">
            {errors.map((e, i) => (
              <li key={`${e.occurred_at}-${i}`} className="fw-list__row">
                <span>
                  <strong>{dayAndTime(e.occurred_at, tz)}</strong>
                  <span className="fw-muted"> · {e.route ?? e.kind}</span>
                  <span className="fw-health__message">{e.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="fw-muted">The last 30 days, newest first; older errors are removed.</p>
      </section>

      <section className="fw-card" aria-labelledby="usage-heading">
        <h2 id="usage-heading">Usage</h2>
        <p className="fw-muted">
          Against the free plans’ monthly limits. Vercel’s limits are shared by every project on the
          account; FamilyWise’s own share is shown beside each.
        </p>
        {usage.vercelStale ? (
          <Banner kind="stale">
            {usage.vercelReadAt
              ? `Vercel usage was last read ${dayAndTime(usage.vercelReadAt, tz)}. The usage workflow reads it daily.`
              : 'Vercel usage has not been read yet. The usage workflow reads it daily.'}
          </Banner>
        ) : null}
        <ul className="fw-list" aria-label="Usage">
          {usage.lines.map((l) => (
            <li key={l.label} className="fw-list__row fw-usage" data-warn={l.warn || undefined}>
              <span>
                <strong>{l.label}</strong>
                <span className="fw-muted">
                  {' · '}
                  {l.text}
                  {l.ours !== null ? ` · FamilyWise ${l.ours}` : ''}
                </span>
              </span>
              {l.share !== null ? (
                <span className="fw-usage__bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.round(l.share * 100))}%` }} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {usage.vercelReadAt && !usage.vercelStale ? (
          <p className="fw-muted">Vercel usage read {dayAndTime(usage.vercelReadAt, tz)}.</p>
        ) : null}
      </section>
    </main>
  );
}
