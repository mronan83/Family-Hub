import { Banner, Button, Fold } from '@familywise/ui';
import type { ComponentProps } from 'react';
import {
  adminsLine,
  checkOffsLine,
  invitesWaiting,
  switchDay,
  WEEK_DAYS,
  weekLine,
} from '@/lib/setup-facts';
import { revokeInvite, setApprovalMode, setWeekStart } from '../../actions';
import { Line } from '../../fold-line';
import { AdminHeader } from '../../header';
import { InviteForm } from '../../invite-form';
import type { NavWho } from '../../nav';
import { WeatherSection } from '../../weather-section';

export { WEEK_DAYS, switchDay };

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
  /** Each admin by the name of the member that is theirs, else their email. */
  admins: { userId: string; email: string; name: string; role: string }[];
  /** `expiresAt` is when it runs out; `expires` says it in words. */
  invites: { id: string; email: string; expires: string; expiresAt: string }[];
}

/** [NFR-18] Which section comes back open after a save in it (WP-94). */
export type FamilySection = 'week' | 'check-offs' | 'weather' | 'invite';

/** The section a redirect back to Family options opens: the one saved in, or its failure. */
export function familyOpen(params: {
  done?: string;
  weather?: string;
  place?: string;
  open?: string;
}): FamilySection | null {
  if (params.open === 'week' || params.open === 'check-offs') return params.open;
  if (params.done?.startsWith('approval-')) return 'check-offs';
  if (params.done?.startsWith('week-')) return 'week';
  if (params.weather || params.place) return 'weather';
  return null;
}

/**
 * [ACC-08][US-110] Family options (WP-57, D-84): the household's options in one place in Settings —
 * the week's start day, how check-offs count, the weather on the boards, and who manages the family.
 * [NFR-18][D-120] Set once and left alone, so each section folds to what it is set to (WP-94): a
 * change waiting to start, a failing weather read and the invites waiting show on its header.
 */
export function FamilyView({
  facts,
  weather,
  notice,
  open = null,
  now = new Date(),
  waiting,
  who,
}: {
  facts: FamilyFacts;
  weather: ComponentProps<typeof WeatherSection>;
  notice?: string | null;
  /** The section saved in, open again. */
  open?: FamilySection | null;
  /** For the invites' days left; a dev page fixes it. */
  now?: Date;
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

      <Fold
        id="week"
        title="The week"
        headingId="week-heading"
        open={open === 'week'}
        summary={[<Line key="w" line={weekLine(facts.weekStart, next)} />]}
      >
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
      </Fold>

      <Fold
        id="check-offs"
        title="Check-offs"
        headingId="approval-heading"
        open={open === 'check-offs'}
        summary={[<Line key="c" line={checkOffsLine(facts.approvalMode)} />]}
      >
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
      </Fold>

      <WeatherSection {...weather} open={open === 'weather'} now={now} />

      <Fold
        id="admins"
        title="Admins"
        headingId="admins-heading"
        summary={[<Line key="a" line={adminsLine(facts.admins)} />]}
      >
        <ul className="fw-list" aria-label="Admins">
          {facts.admins.map((a) => (
            <li key={a.userId} className="fw-list__row">
              <span>
                {a.name}
                {a.name !== a.email ? <span className="fw-muted"> · {a.email}</span> : null}
              </span>
              <span className="fw-muted">{a.role === 'owner' ? 'Owner' : 'Admin'}</span>
            </li>
          ))}
        </ul>
      </Fold>

      <Fold
        id="invite"
        title="Invite an admin"
        headingId="invite-heading"
        open={open === 'invite'}
        button={{ label: 'Invite', icon: 'plus' }}
        waiting={invitesWaiting(
          facts.invites.map((i) => i.expiresAt),
          now,
          facts.timezone,
        )}
      >
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
      </Fold>
    </main>
  );
}
