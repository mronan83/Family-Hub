import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { dayName } from '@/lib/board-calendar';
import type { School } from '@/lib/menu/nutrislice';
import { fetchStatus, type MenuSourceRow, sourceWords } from '@/lib/menus';
import { AdminHeader } from '../../header';
import { clearMenuDay, type CsvState, fetchMenuNow, removeMenu, renameMenu } from './actions';
import { AddMenuForm } from './add-form';
import { MenuDayForm } from './day-form';
import { MenuText } from '../menu-text';
import { MenuFileForm } from './file-form';

export interface MenusViewProps {
  menus: MenuSourceRow[];
  /** Children by id, for "whose lunch comes from it". */
  names: Map<string, string>;
  timezone: string;
  today: string;
  notice: string | null;
  error: string | null;
  /** The dev page's: the add form with schools found, a file looked at. */
  found?: { district: string; schools: School[] };
  fileState?: CsvState;
}

const STATE_ICONS: Record<'ok' | 'error' | 'pending', IconName> = {
  ok: 'check-circle',
  error: 'x-circle',
  pending: 'hourglass',
};

/** "Mon, Feb 1" for a date. */
const dayWords = dayName;

/**
 * [MENU-01..05][US-801..803] School menus (WP-27): each menu with where it comes from, how its fetches
 * are going (a feed that fails keeps its menus and says why), whose lunch comes from it, and its next
 * four weeks, a day at a time to change (the parent's own from then on) or hand back to the feed. A
 * file's menus load after a look at what the file holds. Children choose their menu on Meals.
 */
export function MenusView({
  menus,
  names,
  timezone,
  today,
  notice,
  error,
  found,
  fileState,
}: MenusViewProps) {
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/meals" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <section className="fw-card" aria-labelledby="menus-heading">
        <div className="fw-goals__head">
          <h1 id="menus-heading">School menus</h1>
          <Link href="/admin/meals#lunch" className="fw-btn fw-btn--ghost">
            <Icon name="chevron-left" className="fw-btn__icon" />
            <span>Meals</span>
          </Link>
        </div>
        <p className="fw-muted">
          What the school serves for lunch, shown on the days a child buys. Choose each child’s menu
          with their usual lunches on Meals.
        </p>
        {menus.length === 0 ? (
          <p className="fw-muted">No school menus yet. Add one below.</p>
        ) : (
          <ul className="fw-list" aria-label="School menus">
            {menus.map((m) => {
              const status = fetchStatus(m, timezone);
              const whose = m.childIds.map((id) => names.get(id)).filter(Boolean);
              const feed = m.adapter === 'nutrislice';
              return (
                <li key={m.id} className="fw-list__row fw-list__row--stack">
                  <span className="fw-bar">
                    <strong>{m.name}</strong>
                    <span className="fw-muted">{sourceWords(m)}</span>
                  </span>
                  <span className="fw-muted">
                    {whose.length > 0
                      ? `Lunch for ${whose.join(' and ')}`
                      : 'No child has this menu yet: choose it on Meals.'}
                  </span>
                  {status ? (
                    <p className="fw-calendar__sync" data-state={status.kind}>
                      <span className="fw-health__state">
                        <Icon name={STATE_ICONS[status.kind]} size={20} />
                        {status.label}
                      </span>
                      <span className="fw-health__message">{status.detail}</span>
                    </p>
                  ) : null}
                  {m.days.length > 0 ? (
                    <ul className="fw-menu-days" aria-label={`Lunch at ${m.name}`}>
                      {m.days.map((d) => (
                        <li key={d.date} data-today={d.date === today ? '' : undefined}>
                          <span className="fw-menu-days__date">{dayWords(d.date)}</span>{' '}
                          <MenuText day={d} />
                          {feed && d.own ? (
                            <span className="fw-pill fw-pill--tag">Yours</span>
                          ) : null}
                          <details className="fw-menu-days__change">
                            <summary aria-label={`Change ${dayWords(d.date)}`}>Change</summary>
                            <MenuDayForm id={m.id} label={`Change ${dayWords(d.date)}`} day={d} />
                            {!feed || d.own ? (
                              <form action={clearMenuDay}>
                                <input type="hidden" name="id" value={m.id} />
                                <input type="hidden" name="date" value={d.date} />
                                <input type="hidden" name="feed" value={String(feed)} />
                                <Button
                                  type="submit"
                                  variant="ghost"
                                  icon={feed ? 'undo' : 'trash'}
                                >
                                  {feed
                                    ? 'Use Nutrislice’s menu again'
                                    : `Remove ${dayWords(d.date)}`}
                                </Button>
                              </form>
                            ) : null}
                          </details>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="fw-muted">
                      {feed
                        ? 'No menus in the next four weeks yet.'
                        : 'No days in the next four weeks.'}
                    </p>
                  )}
                  {m.adapter === 'csv' ? (
                    <details open={fileState ? true : undefined}>
                      <summary>Load a file into {m.name}</summary>
                      <MenuFileForm id={m.id} name={m.name} initial={fileState} />
                    </details>
                  ) : null}
                  <details>
                    <summary>Add a day to {m.name}</summary>
                    <MenuDayForm id={m.id} label={`Add a day to ${m.name}`} />
                  </details>
                  {feed ? (
                    <form action={fetchMenuNow}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" variant="ghost" icon="sync">
                        Fetch {m.name} now
                      </Button>
                    </form>
                  ) : null}
                  <details>
                    <summary>Rename {m.name}</summary>
                    <form action={renameMenu} className="fw-form" aria-label={`Rename ${m.name}`}>
                      <input type="hidden" name="id" value={m.id} />
                      <label className="fw-field">
                        <span className="fw-field__label">Name</span>
                        <input
                          className="fw-input"
                          name="name"
                          maxLength={40}
                          required
                          defaultValue={m.name}
                        />
                      </label>
                      <Button type="submit" variant="secondary" icon="check">
                        Save the name
                      </Button>
                    </form>
                  </details>
                  <details>
                    <summary>Remove {m.name}</summary>
                    <p className="fw-muted">
                      Its menus go, and the children who had it have no menu until you choose
                      another.
                    </p>
                    <form action={removeMenu}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="name" value={m.name} />
                      <Button type="submit" variant="ghost" icon="trash">
                        Remove {m.name}
                      </Button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="add-menu-heading">
        <h2 id="add-menu-heading">Add a school menu</h2>
        <AddMenuForm found={found} />
      </section>
    </main>
  );
}
