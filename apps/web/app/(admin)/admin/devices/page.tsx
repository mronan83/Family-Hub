import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { BOARD_THEMES, boardThemeSetting } from '@/lib/devices';
import { dayAndTime } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { effectiveLayout, readLayout } from '@/lib/board-layout';
import {
  disconnectDevice,
  renameDevice,
  setBoardCalendars,
  setBoardTheme,
  setOwnLayout,
} from './actions';
import { LayoutForm } from './layout-form';
import { PairingForm } from './pairing-form';

export const metadata: Metadata = { title: 'Boards' };

interface DeviceRow {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
  board_config: unknown;
}

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  show_on_board: boolean;
}

// [DEV-01][DEV-03][DEV-05] The household's boards: pair a new one, rename, set its theme, see when
// each was last seen, and disconnect one that is lost or retired. Disconnected boards stay listed.
// [CAL-05] Each board's calendars (WP-23): the calendars' own setting until a board's choice is saved.
// [BRD-05][US-1004] The home screen's layout (WP-35, D-67): the household's, and a board's own.
export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; name?: string; error?: string; board?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/devices');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [{ data, error }, cals, choices, settings] = await Promise.all([
    db!
      .from('device')
      .select('id, name, status, last_seen_at, created_at, revoked_at, board_config')
      .eq('household_id', household.id)
      .order('created_at'),
    db!
      .from('calendar_source')
      .select('id, name, color, show_on_board')
      .eq('household_id', household.id)
      .order('created_at'),
    db!
      .from('device_calendar')
      .select('device_id, calendar_source_id, visible')
      .eq('household_id', household.id),
    db!
      .from('household_settings')
      .select('board_layout')
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`devices: ${error.message}`);
  if (cals.error) throw new Error(`calendars: ${cals.error.message}`);
  if (choices.error) throw new Error(`board calendars: ${choices.error.message}`);
  if (settings.error) throw new Error(`settings: ${settings.error.message}`);
  const householdLayout = effectiveLayout(settings.data?.board_layout, null);
  const devices = (data ?? []) as DeviceRow[];
  const calendars = (cals.data ?? []) as CalendarRow[];
  // A board shows its own choice once one is saved, else each calendar's "show on the boards".
  const shownOn = (deviceId: string) => {
    const own = (choices.data ?? []).filter((c) => c.device_id === deviceId);
    return {
      own: own.length > 0,
      shown: new Set(
        own.length > 0
          ? own.filter((c) => c.visible).map((c) => c.calendar_source_id as string)
          : calendars.filter((c) => c.show_on_board).map((c) => c.id),
      ),
    };
  };
  const params = await searchParams;
  const active = devices.filter((d) => d.status === 'active');
  const revoked = devices.filter((d) => d.status === 'revoked');
  const tz = household.timezone;
  // Where a layout was just saved: its notice shows there, not at the top of the page.
  const layoutNotice = (where: string) =>
    params.board !== where ? null : params.error === 'layout' ? (
      <Banner kind="notice">That layout wasn’t saved. Try again in a moment.</Banner>
    ) : params.did === 'layout' ? (
      <Banner kind="info">
        Saved the home screen for {params.name || 'the board'}. It shows the change in a moment.
      </Banner>
    ) : null;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/devices" />
      {params.error === 'calendars' ? (
        <Banner kind="notice">Those calendars weren’t saved. Try again in a moment.</Banner>
      ) : params.did === 'calendars' ? (
        <Banner kind="info">
          Saved the calendars on {params.name || 'the board'}. It shows them in a moment.
        </Banner>
      ) : null}
      <section className="fw-card" aria-labelledby="boards-heading">
        <h1 id="boards-heading">Boards</h1>
        {active.length === 0 ? (
          <p className="fw-muted">No boards yet. Pair the first one below.</p>
        ) : (
          <ul className="fw-list" aria-label="Paired boards">
            {active.map((d) => (
              <li key={d.id} className="fw-list__row">
                <span>
                  <strong>{d.name}</strong>
                  <span className="fw-muted">
                    {' · '}
                    {d.last_seen_at
                      ? `Last seen ${dayAndTime(d.last_seen_at, tz)}`
                      : 'Not seen yet'}
                  </span>
                </span>
                <span className="fw-actions">
                  <form
                    action={renameDevice}
                    className="fw-actions"
                    aria-label={`Rename ${d.name}`}
                  >
                    <input type="hidden" name="id" value={d.id} />
                    <label className="fw-visually-hidden" htmlFor={`name-${d.id}`}>
                      New name for {d.name}
                    </label>
                    <input
                      id={`name-${d.id}`}
                      className="fw-input"
                      name="name"
                      defaultValue={d.name}
                      maxLength={60}
                      required
                    />
                    <Button type="submit" variant="secondary">
                      Rename
                    </Button>
                  </form>
                  <form
                    action={setBoardTheme}
                    className="fw-actions"
                    aria-label={`Theme for ${d.name}`}
                  >
                    <input type="hidden" name="id" value={d.id} />
                    <label className="fw-visually-hidden" htmlFor={`theme-${d.id}`}>
                      Theme for {d.name}
                    </label>
                    <select
                      id={`theme-${d.id}`}
                      className="fw-input"
                      name="theme"
                      defaultValue={boardThemeSetting(d.board_config)}
                    >
                      {BOARD_THEMES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="secondary">
                      Set theme
                    </Button>
                  </form>
                  <form action={disconnectDevice}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="ghost" icon="minus-circle">
                      Disconnect {d.name}
                    </Button>
                  </form>
                </span>
                {calendars.length > 0
                  ? (() => {
                      const { own, shown } = shownOn(d.id);
                      return (
                        <details className="fw-board-cals">
                          <summary>
                            Calendars on {d.name}:{' '}
                            {calendars
                              .filter((c) => shown.has(c.id))
                              .map((c) => c.name)
                              .join(', ') || 'none'}
                          </summary>
                          <form
                            action={setBoardCalendars}
                            className="fw-form"
                            aria-label={`Calendars on ${d.name}`}
                          >
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="name" value={d.name} />
                            <p className="fw-muted">
                              {own
                                ? 'Chosen for this board. A calendar you connect later stays off it until you tick it here.'
                                : 'This board shows the calendars set to show on the boards. Saving here makes it choose its own.'}
                            </p>
                            <fieldset className="fw-field fw-fieldset">
                              <legend className="fw-field__label">Show on {d.name}</legend>
                              <div className="fw-picker">
                                {calendars.map((c) => (
                                  <label key={c.id} className="fw-picker__item">
                                    <input
                                      type="checkbox"
                                      name="calendars"
                                      value={c.id}
                                      defaultChecked={shown.has(c.id)}
                                    />
                                    <span
                                      className="fw-swatch fw-swatch--small"
                                      style={{ background: `var(--${c.color})` }}
                                      aria-hidden
                                    />
                                    {c.name}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                            <div className="fw-actions">
                              <Button type="submit" variant="secondary" icon="calendar">
                                Save calendars
                              </Button>
                            </div>
                          </form>
                        </details>
                      );
                    })()
                  : null}
                {(() => {
                  const own = readLayout((d.board_config as { layout?: unknown } | null)?.layout);
                  return (
                    <details
                      id={`layout-${d.id}`}
                      className="fw-board-cals"
                      open={params.board === d.id}
                    >
                      <summary>
                        Home screen on {d.name}: {own ? 'its own layout' : 'the household’s layout'}
                      </summary>
                      {layoutNotice(d.id)}
                      <form
                        action={setOwnLayout}
                        className="fw-form"
                        aria-label={`Layout for ${d.name}`}
                      >
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="name" value={d.name} />
                        <label className="fw-picker__item">
                          <input type="checkbox" name="own" defaultChecked={own !== null} />
                          Give {d.name} its own layout
                        </label>
                        <p className="fw-muted">
                          {own
                            ? 'Only this board changes here. Untick to follow the household’s layout again.'
                            : 'This board shows the household’s layout below. Its own starts as a copy.'}
                        </p>
                        <div className="fw-actions">
                          <Button type="submit" variant="secondary">
                            Save
                          </Button>
                        </div>
                      </form>
                      {own ? <LayoutForm layout={own} device={d.id} name={d.name} /> : null}
                    </details>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="layout-household" className="fw-card" aria-labelledby="layout-heading">
        <h2 id="layout-heading">Home screen</h2>
        <p className="fw-muted">
          What every board shows first: the calendar, today’s list beside it, then these cards. A
          board with its own layout (above) keeps it.
        </p>
        {layoutNotice('household')}
        <LayoutForm layout={householdLayout} device={null} name="every board" />
      </section>

      <section className="fw-card" aria-labelledby="pair-heading">
        <h2 id="pair-heading">Add a board</h2>
        <p className="fw-muted">
          Open the board on the display (it starts on the pairing screen), then enter the code you
          get here.
        </p>
        <PairingForm timeZone={tz} />
      </section>

      {revoked.length > 0 ? (
        <section className="fw-card" aria-labelledby="revoked-heading">
          <h2 id="revoked-heading">Disconnected</h2>
          <Banner kind="info">
            A disconnected board reads nothing and cannot sign in again. Pair it again for a new
            code.
          </Banner>
          <ul className="fw-list" aria-label="Disconnected boards">
            {revoked.map((d) => (
              <li key={d.id} className="fw-list__row">
                <span>{d.name}</span>
                <span className="fw-muted">
                  Disconnected {d.revoked_at ? dayAndTime(d.revoked_at, tz) : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
