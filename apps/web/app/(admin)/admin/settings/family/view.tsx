import { Banner, Button } from '@familywise/ui';
import type { ComponentProps } from 'react';
import { revokeInvite, setApprovalMode, setWeekStart } from '../../actions';
import { AdminHeader } from '../../header';
import { InviteForm } from '../../invite-form';
import type { NavWho } from '../../nav';
import { WeatherSection } from '../../weather-section';

export const WEEK_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const SHORT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
/** "Monday, Oct 19" for a YYYY-MM-DD. */
export const switchDay = (d: string) => SHORT.format(new Date(`${d}T12:00:00Z`));

export const FAMILY_NOTICES: Record<string, { kind: 'info' | 'notice'; text: string }> = {
  'approval-on': {
    kind: 'info',
    text: 'Check-offs now wait for a parent. Ones already done stay done.',
  },
  'approval-off': {
    kind: 'info',
    text: 'Check-offs now count straight away. Any already waiting stay in Today for you to decide.',
  },
  'week-saved': { kind: 'info', text: 'Saved. The new start day begins with the next week.' },
  'week-kept': { kind: 'info', text: 'The week keeps its start day.' },
  failed: { kind: 'notice', text: 'That didn’t save. Try again in a moment.' },
};

export interface FamilyFacts {
  name: string;
  timezone: string;
  email: string;
  weekStart: number;
  /** A change waiting for the next week. */
  weekStartNext: { day: number; on: string } | null;
  approvalMode: 'on' | 'off';
  admins: { userId: string; email: string; role: string }[];
  invites: { id: string; email: string; expires: string }[];
}

/**
 * [ACC-08][US-110] Family options (WP-57, D-84): the household's options in one place in Settings —
 * the week's start day, how check-offs count, the weather on the boards, and who manages the family.
 */
export function FamilyView({
  facts,
  weather,
  notice,
  waiting,
  who,
}: {
  facts: FamilyFacts;
  weather: ComponentProps<typeof WeatherSection>;
  notice?: string | null;
  /** For a dev page; the live page leaves them to the header. */
  waiting?: number;
  who?: NavWho | null;
}) {
  const n = notice ? FAMILY_NOTICES[notice] : undefined;
  const next = facts.weekStartNext;
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/settings/family" waiting={waiting} who={who} />
      {n ? <Banner kind={n.kind}>{n.text}</Banner> : null}

      <section className="fw-card" aria-labelledby="family-heading">
        <h1 id="family-heading">Family options</h1>
        <p className="fw-muted">
          {facts.name} · {facts.timezone.replaceAll('_', ' ')} · Signed in as {facts.email}
        </p>
      </section>

      <section className="fw-card" id="week" aria-labelledby="week-heading">
        <h2 id="week-heading">The week</h2>
        <p>
          The week starts on <strong>{WEEK_DAYS[facts.weekStart]}</strong>.
          {next ? (
            <>
              {' '}
              From <strong>{switchDay(next.on)}</strong>, it starts on{' '}
              <strong>{WEEK_DAYS[next.day]}</strong>.
            </>
          ) : null}
        </p>
        <form action={setWeekStart} className="fw-form" aria-label="The week starts on">
          <label className="fw-field">
            <span className="fw-field__label">Start the week on</span>
            <select
              className="fw-input"
              name="day"
              defaultValue={String(next ? next.day : facts.weekStart)}
            >
              {WEEK_DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <p className="fw-field__help">
            A change starts with the next week, so this week’s weekly reward limits, weekly goals
            and streaks aren’t cut short. The boards, Meals and Insights follow it then.
          </p>
          <div className="fw-actions">
            <Button type="submit" icon="check">
              Save
            </Button>
            {next ? (
              <Button type="submit" name="keep" value={facts.weekStart} variant="ghost" icon="undo">
                Keep {WEEK_DAYS[facts.weekStart]}
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="fw-card" id="check-offs" aria-labelledby="approval-heading">
        <h2 id="approval-heading">Check-offs</h2>
        <form action={setApprovalMode} className="fw-form" aria-label="Check-offs">
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">When a child checks something off</legend>
            <label className="fw-choice">
              <input
                type="radio"
                name="approval"
                value="off"
                defaultChecked={facts.approvalMode === 'off'}
              />
              It counts straight away; a parent can uncheck it later
            </label>
            <label className="fw-choice">
              <input
                type="radio"
                name="approval"
                value="on"
                defaultChecked={facts.approvalMode === 'on'}
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

      <WeatherSection {...weather} />

      <section className="fw-card" id="admins" aria-labelledby="admins-heading">
        <h2 id="admins-heading">Admins</h2>
        <ul className="fw-list">
          {facts.admins.map((a) => (
            <li key={a.userId} className="fw-list__row">
              <span>{a.email}</span>
              <span className="fw-muted">{a.role === 'owner' ? 'Owner' : 'Admin'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fw-card" id="invite" aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite an admin</h2>
        <InviteForm />
        {facts.invites.length > 0 ? (
          <>
            <h3>Waiting to join</h3>
            <ul className="fw-list" aria-label="Open invites">
              {facts.invites.map((i) => (
                <li key={i.id} className="fw-list__row">
                  <span>
                    {i.email}
                    <span className="fw-muted"> · Expires {i.expires}</span>
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
