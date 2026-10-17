import { Avatar, Banner, Button, Fold, Icon, type IconName } from '@familywise/ui';
import { calendarFacts, syncStatus, whenWords, type CalendarRow } from '@/lib/calendars';
import { AdminHeader } from '../header';
import { removeCalendar } from './actions';
import { CalendarForm, type CalendarPerson } from './calendar-form';

export interface CalendarsViewProps {
  calendars: CalendarRow[];
  /** The family's members in its order, archived ones too, for who a calendar is for. */
  members: (CalendarPerson & { archived: boolean })[];
  timezone: string;
  /** Now, for how long ago each calendar synced. */
  now: number;
  /** The calendar to show open: one just saved in (its id). */
  open?: string | null;
  notice: string | null;
  error: string | null;
}

const SYNC_ICONS: Record<'ok' | 'error' | 'pending', IconName> = {
  ok: 'check-circle',
  error: 'x-circle',
  pending: 'hourglass',
};

/**
 * [CAL-01][CAL-03][CAL-06][CAL-09][NFR-18] The household's calendars (WP-22): each folded (WP-93) to
 * its color, name and facts (who it's for with their faces (WP-50), on the boards or not, its sync,
 * how many events are coming up), "Can’t sync" on its header; opened, how its sync went (US-505) and
 * what's coming up, then Edit and Remove as folds. Add a calendar by its public link folds to its
 * button. A calendar comes back open after a save in it (D-120). Events themselves are never edited
 * here: Apple Calendar is where they change.
 */
export function CalendarsView({
  calendars,
  members,
  timezone,
  now,
  open,
  notice,
  error,
}: CalendarsViewProps) {
  const current = members.filter((m) => !m.archived);
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
          <ul className="fw-list fw-fold-list" aria-label="Calendars">
            {calendars.map((c) => {
              const sync = syncStatus(c, timezone);
              const facts = calendarFacts(c, members, now, timezone);
              const faces = current.filter((m) => c.memberIds.includes(m.id));
              const more = c.upcomingCount - c.upcoming.length;
              return (
                <li key={c.id}>
                  <Fold
                    variant="row"
                    id={`calendar-${c.id}`}
                    title={
                      <>
                        <span
                          className="fw-swatch fw-swatch--small fw-calendar__swatch"
                          style={{ background: `var(--${c.color}-line)` }}
                          aria-hidden
                        />
                        {c.name}
                      </>
                    }
                    meta={
                      <span className="fw-calendar__who">
                        {faces.length ? (
                          <span className="fw-calendar__faces" aria-hidden>
                            {faces.map((m) => (
                              <Avatar
                                key={m.id}
                                name={m.displayName}
                                avatarKey={m.avatarKey}
                                color={m.color}
                                size={24}
                                decorative
                              />
                            ))}
                          </span>
                        ) : null}
                        {facts.meta}
                      </span>
                    }
                    warning={facts.warning}
                    open={open === c.id}
                  >
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
                    <Fold variant="inner" title={`Edit ${c.name}`}>
                      <CalendarForm
                        id={c.id}
                        initial={{
                          name: c.name,
                          color: c.color,
                          memberIds: c.memberIds,
                          showOnBoard: c.showOnBoard,
                        }}
                        members={current}
                      />
                    </Fold>
                    <Fold variant="inner" title={`Remove ${c.name}`}>
                      <p className="fw-muted">
                        Its events leave FamilyWise and the boards. The calendar itself stays in
                        Apple Calendar, and you can add it again any time.
                      </p>
                      <form action={removeCalendar}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="name" value={c.name} />
                        <Button type="submit" variant="ghost" icon="trash">
                          Remove {c.name}
                        </Button>
                      </form>
                    </Fold>
                  </Fold>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* With no calendar yet, adding one is all there is to do here. */}
      <Fold
        id="add-calendar"
        title="Add a calendar"
        headingId="add-calendar-heading"
        button={{ label: 'Add a calendar', icon: 'plus' }}
        open={calendars.length === 0}
      >
        <CalendarForm members={current} />
      </Fold>
    </main>
  );
}
