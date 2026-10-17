import { Banner, Fold, Icon } from '@familywise/ui';
import Link from 'next/link';
import { dayAndTime } from '@/lib/format';
import { JOB_STATES, jobLabel, type JobState, type UsageLine } from '@/lib/health';
import { errorsLine, jobsFacts, usageFacts } from '@/lib/setup-facts';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import type { NavWho } from '../nav';

export interface JobRow {
  job_type: string;
  state: JobState;
  last_ok_at: string | null;
  last_run_at: string | null;
  message: string | null;
}

export interface ErrorRow {
  occurred_at: string;
  route: string | null;
  kind: string;
  message: string;
}

/** The page reads this many server errors at most. */
export const ERROR_LIMIT = 20;

/**
 * [NFR-07][NFR-08] System Health (WP-42, D-42): this household's background jobs and server errors,
 * and the deployment's usage against the Free-plan limits. [NFR-18][D-120] The verdict stays open;
 * Background jobs, Server errors and Usage fold to their counts, a failing or late job and a limit
 * near on their headers (WP-94).
 */
export function HealthView({
  jobs,
  errors,
  usage,
  demo,
  broken,
  tz,
  waiting,
  who,
}: {
  jobs: JobRow[];
  errors: ErrorRow[];
  usage: { lines: UsageLine[]; vercelReadAt: string | null; vercelStale: boolean };
  /** The demo family: production's jobs leave it alone (D-62). */
  demo: boolean;
  /** Calendars that can't sync, by name. */
  broken: string[];
  tz: string;
  waiting?: number;
  who?: NavWho | null;
}) {
  const failing = jobs.filter((j) => j.state === 'failing' || j.state === 'stale');
  const near = usage.lines.filter((l) => l.warn);
  const jobFacts = jobsFacts(jobs.map((j) => ({ label: jobLabel(j.job_type), state: j.state })));
  const usageFact = usageFacts(usage.lines);
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/health" waiting={waiting} who={who} />
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

      <Fold
        id="jobs"
        title="Background jobs"
        headingId="jobs-heading"
        summary={[<Line key="j" line={jobFacts.line} />]}
        warning={jobFacts.warning}
      >
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
      </Fold>

      <Fold
        id="errors"
        title="Server errors"
        headingId="errors-heading"
        summary={[
          <Line
            key="e"
            line={errorsLine(
              errors.map((e) => e.occurred_at),
              ERROR_LIMIT,
              tz,
            )}
          />,
        ]}
      >
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
      </Fold>

      <Fold
        id="usage"
        title="Usage"
        headingId="usage-heading"
        summary={[<Line key="u" line={usageFact.line} />]}
        warning={usageFact.warning}
      >
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
      </Fold>
    </main>
  );
}
