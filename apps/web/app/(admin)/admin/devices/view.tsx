import { Banner, Button, Fold, TEXT_SIZES } from '@familywise/ui';
import type { ReactNode } from 'react';
import { type BoardLayout, layoutSummary, readLayout } from '@/lib/board-layout';
import { boardFacts } from '@/lib/board-facts';
import { readBoardSleep, type SchoolDays } from '@/lib/board-sleep';
import { BOARD_THEMES, boardTextSize, boardThemeSetting } from '@/lib/devices';
import { dayAndTime } from '@/lib/format';
import {
  disconnectDevice,
  renameDevice,
  setBoardCalendars,
  setBoardTextSize,
  setBoardTheme,
  setOwnLayout,
} from './actions';
import { LayoutForm } from './layout-form';
import { PairingForm } from './pairing-form';
import { SleepForm } from './sleep-form';

export interface BoardsBoard {
  id: string;
  name: string;
  lastSeenAt: string | null;
  config: unknown;
  /** Its own choice of calendars once one is saved, and the calendars it shows. */
  calendars: { own: boolean; shown: Set<string> };
}

export interface BoardsCalendar {
  id: string;
  name: string;
  color: string;
}

export interface BoardsViewProps {
  header: ReactNode;
  boards: BoardsBoard[];
  disconnected: { id: string; name: string; revokedAt: string | null }[];
  calendars: BoardsCalendar[];
  householdLayout: BoardLayout;
  now: number;
  timeZone: string;
  school: SchoolDays | null;
  /** What was just saved, or not, and where: `board` is a board's id or "household". */
  params: { did?: string; name?: string; error?: string; board?: string };
}

/**
 * [DEV-01][DEV-03][DEV-05][DEV-07][CAL-05][BRD-05][BRD-08][DEV-09][D-118] Boards (WP-91): each paired board
 * folded at first, its header its name and facts (awake or asleep and the next time, last seen, its
 * theme, text size and layout) and Home's not-seen warning; opened, its groups: Display, Sleep and
 * wake, Calendars, Home screen, then Rename and Disconnect set apart. The household's home screen
 * layout folds to one line, Add a board to its button, Disconnected to a count. A board, or the
 * household's layout, comes back open after a save in it (D-120).
 */
export function BoardsView({
  header,
  boards,
  disconnected,
  calendars,
  householdLayout,
  now,
  timeZone: tz,
  school,
  params,
}: BoardsViewProps) {
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
      {header}
      <section className="fw-card" aria-labelledby="boards-heading">
        <h1 id="boards-heading">Boards</h1>
        {boards.length === 0 ? (
          <p className="fw-muted">No boards yet. Pair the first one below.</p>
        ) : (
          <ul className="fw-list fw-fold-list" aria-label="Paired boards">
            {boards.map((d) => {
              const facts = boardFacts(d, now, tz, school);
              const here = params.board === d.id;
              const config = d.config as { sleep?: unknown; layout?: unknown } | null;
              const own = readLayout(config?.layout);
              return (
                <li key={d.id}>
                  <Fold
                    variant="row"
                    id={`board-${d.id}`}
                    title={d.name}
                    meta={facts.meta}
                    warning={facts.warning}
                    open={here}
                  >
                    {here && params.error === 'calendars' ? (
                      <Banner kind="notice">
                        Those calendars weren’t saved. Try again in a moment.
                      </Banner>
                    ) : here && params.did === 'calendars' ? (
                      <Banner kind="info">
                        Saved the calendars on {d.name}. It shows them in a moment.
                      </Banner>
                    ) : null}

                    <div className="fw-fold__group">
                      <h3>Display</h3>
                      <div className="fw-actions">
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
                            defaultValue={boardThemeSetting(d.config)}
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
                        {/* [BRD-08] The board fits its screen by itself; this makes its words
                            smaller or larger for where it hangs (D-73). */}
                        <form
                          action={setBoardTextSize}
                          className="fw-actions"
                          aria-label={`Text size for ${d.name}`}
                        >
                          <input type="hidden" name="id" value={d.id} />
                          <label className="fw-visually-hidden" htmlFor={`text-size-${d.id}`}>
                            Text size for {d.name}
                          </label>
                          <select
                            id={`text-size-${d.id}`}
                            className="fw-input"
                            name="text_size"
                            defaultValue={boardTextSize(d.config)}
                          >
                            {TEXT_SIZES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.value === 'standard' ? 'Standard text' : `${t.label} text`}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="secondary">
                            Set text size
                          </Button>
                        </form>
                      </div>
                    </div>

                    <SleepForm
                      device={d.id}
                      name={d.name}
                      sleep={readBoardSleep(config?.sleep)}
                      notice={
                        !here
                          ? null
                          : params.error === 'sleep'
                            ? 'error'
                            : params.did === 'sleep'
                              ? 'saved'
                              : null
                      }
                    />

                    {calendars.length > 0 ? (
                      <div className="fw-fold__group">
                        <h3>Calendars</h3>
                        <form
                          action={setBoardCalendars}
                          className="fw-form"
                          aria-label={`Calendars on ${d.name}`}
                        >
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="name" value={d.name} />
                          <p className="fw-muted">
                            {d.calendars.own
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
                                    defaultChecked={d.calendars.shown.has(c.id)}
                                  />
                                  <span
                                    className="fw-swatch fw-swatch--small"
                                    style={{ background: `var(--${c.color}-line)` }}
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
                      </div>
                    ) : null}

                    <div id={`layout-${d.id}`} className="fw-fold__group">
                      <h3>Home screen</h3>
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
                            ? `${layoutSummary(own)}. Only this board changes here. Untick to follow the household’s layout again.`
                            : 'This board shows the household’s layout (Home screen, below). Its own starts as a copy.'}
                        </p>
                        <div className="fw-actions">
                          <Button type="submit" variant="secondary">
                            Save
                          </Button>
                        </div>
                      </form>
                      {own ? <LayoutForm layout={own} device={d.id} name={d.name} /> : null}
                    </div>

                    <div className="fw-fold__group fw-fold__apart">
                      <h3>Name and connection</h3>
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
                      {/* Disconnecting is for good, so it asks first (06 §6). */}
                      <details className="fw-more">
                        <summary>Disconnect {d.name}</summary>
                        <p className="fw-muted">
                          It stops showing FamilyWise at once and can’t sign in again. To use this
                          screen again, pair it with a new code.
                        </p>
                        <form action={disconnectDevice}>
                          <input type="hidden" name="id" value={d.id} />
                          <Button type="submit" variant="ghost" icon="minus-circle">
                            Yes, disconnect {d.name}
                          </Button>
                        </form>
                      </details>
                    </div>
                  </Fold>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Fold
        id="layout-household"
        title="Home screen"
        headingId="layout-heading"
        summary={[layoutSummary(householdLayout)]}
        open={params.board === 'household'}
      >
        <p className="fw-muted">
          What every board shows first: the calendar, today’s list beside it, then these cards. A
          board with its own layout (above) keeps it.
        </p>
        {layoutNotice('household')}
        <LayoutForm layout={householdLayout} device={null} name="every board" />
      </Fold>

      {/* With no board yet, adding one is all there is to do here. */}
      <Fold
        id="add-board"
        title="Add a board"
        headingId="pair-heading"
        button={{ label: 'Add a board', icon: 'plus' }}
        open={boards.length === 0}
      >
        <p className="fw-muted">
          Open the board on the display (it starts on the pairing screen), then enter the code you
          get here.
        </p>
        <PairingForm timeZone={tz} />
      </Fold>

      {disconnected.length > 0 ? (
        <Fold
          id="disconnected"
          title="Disconnected"
          headingId="revoked-heading"
          summary={[<b key="n">{disconnected.length} disconnected</b>]}
          open={params.did === 'disconnected'}
        >
          <Banner kind="info">
            A disconnected board reads nothing and cannot sign in again. Pair it again for a new
            code.
          </Banner>
          <ul className="fw-list" aria-label="Disconnected boards">
            {disconnected.map((d) => (
              <li key={d.id} className="fw-list__row">
                <span>{d.name}</span>
                <span className="fw-muted">
                  Disconnected {d.revokedAt ? dayAndTime(d.revokedAt, tz) : ''}
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}
    </main>
  );
}
