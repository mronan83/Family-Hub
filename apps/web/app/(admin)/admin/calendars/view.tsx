import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import { syncStatus, whenWords, type CalendarRow } from '@/lib/calendars';
import { AdminHeader } from '../header';
import { removeCalendar } from './actions';
import { CalendarForm } from './calendar-form';

export interface CalendarsViewProps {
  calendars: CalendarRow[];
  /** Members still in the family, for "whose calendar". */
  members: { id: string; displayName: string }[];
  timezone: string;
  notice: string | null;
  error: string | null;
}

const SYNC_ICONS: Record<'ok' | 'error' | 'pending', IconName> = {
  ok: 'check-circle',
  error: 'x-circle',
  pending: 'hourglass',
};

/**
 * [CAL-01][CAL-03][CAL-06] The household's calendars (WP-22): each with its color, whose it is, how
 * its sync went (US-505) and what's coming up, to edit, re-link or remove; and a form to add one by
 * its public link. Events themselves are never edited here: Apple Calendar is where they change.
 */
export function CalendarsView({ calendars, members, timezone, notice, error }: CalendarsViewProps) {
  const whose = (id: string | null) => members.find((m) => m.id === id)?.displayName ?? null;
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/calendars" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <section className="fw-card" aria-labelledby="calendars-heading">
        <h1 id="calendars-heading">Calendars</h1>
        <p className="fw-muted">
          Connect the family’s calendars from Apple Calendar by their public link. FamilyWise only
          reads them: add and change events in Apple Calendar, and they show here within 15 minutes.
        </p>
        {calendars.length === 0 ? (
          <p className="fw-muted">No calendars yet. Add one below.</p>
        ) : (
          <ul className="fw-list" aria-label="Calendars">
            {calendars.map((c) => {
              const sync = syncStatus(c, timezone);
              const person = whose(c.memberId);
              const more = c.upcomingCount - c.upcoming.length;
              return (
                <li key={c.id} className="fw-list__row fw-list__row--stack">
                  <span className="fw-bar">
                    <span className="fw-pill fw-pill--tag">
                      <span
                        className="fw-swatch fw-swatch--small"
                        style={{ background: `var(--${c.color})` }}
                        aria-hidden
                      />
                      <strong>{c.name}</strong>
                    </span>
                    <span className="fw-muted">
                      {person ? `${person}’s` : 'The whole family'}
                      {c.showOnBoard ? '' : ' · Not on the boards'}
                    </span>
                  </span>
                  <p className="fw-calendar__sync" data-state={sync.kind}>
                    <span className="fw-health__state">
                      <Icon name={SYNC_ICONS[sync.kind]} size={20} />
                      {sync.label}
                    </span>
                    <span className="fw-health__message">{sync.detail}</span>
                  </p>
                  {c.upcoming.length > 0 ? (
                    <ul className="fw-calendar__events" aria-label={`Coming up on ${c.name}`}>
                      {c.upcoming.map((e) => (
                        <li key={e.id}>
                          <span className="fw-calendar__when">{whenWords(e, timezone)}</span>{' '}
                          {e.title || 'Untitled event'}
                          {e.changed ? <span className="fw-muted"> · moved</span> : null}
                        </li>
                      ))}
                      {more > 0 ? (
                        <li className="fw-muted">and {more} more in the next four months</li>
                      ) : null}
                    </ul>
                  ) : sync.kind === 'ok' ? (
                    <p className="fw-muted">Nothing coming up in the next four months.</p>
                  ) : null}
                  <details>
                    <summary>Edit {c.name}</summary>
                    <CalendarForm
                      id={c.id}
                      initial={{
                        name: c.name,
                        color: c.color,
                        memberId: c.memberId,
                        showOnBoard: c.showOnBoard,
                      }}
                      members={members}
                    />
                  </details>
                  <details>
                    <summary>Remove {c.name}</summary>
                    <p className="fw-muted">
                      Its events leave FamilyWise and the boards. The calendar itself stays in Apple
                      Calendar, and you can add it again any time.
                    </p>
                    <form action={removeCalendar}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="name" value={c.name} />
                      <Button type="submit" variant="ghost" icon="trash">
                        Remove {c.name}
                      </Button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="add-calendar-heading">
        <h2 id="add-calendar-heading">Add a calendar</h2>
        <CalendarForm members={members} />
      </section>
    </main>
  );
}
