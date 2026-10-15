import { Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { dayName } from '@/lib/board-calendar';
import { type LunchChild, MODE_WORDS, noLunchWords, WEEKDAY_WORDS, WEEKDAYS } from '@/lib/lunch';
import { setLunchDay, setLunchPicks, setUsualLunch } from './actions';
import { menuChanged, pickName, pickValue, picksWords } from '@/lib/lunch-picks';
import { menuSections, pickOne, sectionLabel } from '@/lib/menu/sections';
import type { LunchDay } from '@/lib/lunch';

/**
 * [MEAL-11][US-707] A buy day's picks (WP-49): what the child picked, "Menu changed" when the menu
 * no longer has a pick, and a form a parent changes them with, a section each (one where it says
 * "Choice of"), which saves at once. Each section's inputs have a name of their own, so the radios
 * of one "Choice of" section don't take the pick off another's (WP-78).
 */
function Picks({
  week,
  memberId,
  name,
  d,
}: {
  week: string;
  memberId: string;
  name: string;
  d: LunchDay;
}) {
  const sections = d.menu && !d.menu.noService ? menuSections(d.menu.items) : [];
  const picks = d.choices ?? [];
  return (
    <>
      {picks.length ? (
        <span className="fw-lunch__picks">
          <strong>Picked:</strong> {picksWords(picks, sections)}
          {menuChanged(picks, sections) ? (
            <span className="fw-lunch__flag">Menu changed</span>
          ) : null}
        </span>
      ) : null}
      {sections.length ? (
        <details className="fw-lunch__edit">
          <summary>{picks.length ? 'Change picks' : 'Pick'}</summary>
          <form action={setLunchPicks} className="fw-form">
            <input type="hidden" name="week" value={week} />
            <input type="hidden" name="member" value={memberId} />
            <input type="hidden" name="day" value={d.date} />
            {sections.map((s, i) => {
              const key = s.title ?? '';
              const one = pickOne(s.title);
              const mine = picks.find((p) => p.section === key)?.options ?? [];
              return (
                <fieldset key={key || i} className="fw-lunch__section">
                  <legend>
                    {s.title ? sectionLabel(s.title) : 'Menu'}
                    <span className="fw-muted">{one ? ' · pick one' : ' · pick any'}</span>
                  </legend>
                  {s.options.map((o, j) => (
                    <label key={j} className="fw-picker__item">
                      <input
                        type={one ? 'radio' : 'checkbox'}
                        name={pickName(i)}
                        value={pickValue(key, j + 1, o.name)}
                        defaultChecked={mine.includes(j + 1)}
                      />
                      <span>{o.name}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
            <Button type="submit" variant="secondary" icon="check">
              {`Save ${name}’s picks`}
            </Button>
          </form>
        </details>
      ) : null}
    </>
  );
}
import { MenuText } from './menu-text';

/**
 * [MEAL-04][US-703] School lunch for the week: each child's school days, buy or bring, a tap to
 * change one (a day changed from the usual says so); days with no school lunch say why. [MEAL-05]
 * A buy day shows what the school serves, from the child's school menu (WP-27), a line a section
 * (WP-64). Then each child's
 * usual week, Monday to Friday, and the school menu their lunch comes from.
 */
export function LunchSection({
  week,
  days,
  lunch,
  menus = [],
  names,
}: {
  week: string;
  days: string[];
  lunch: LunchChild[];
  /** The household's school menus (WP-27). */
  menus?: { id: string; name: string }[];
  names: Map<string, string>;
}) {
  if (lunch.length === 0) return null;
  return (
    <section className="fw-card" id="lunch" aria-labelledby="lunch-heading">
      <div className="fw-goals__head">
        <h2 id="lunch-heading">School lunch</h2>
        <Link href="/admin/meals/menus" className="fw-btn fw-btn--secondary">
          <Icon name="lunch" className="fw-btn__icon" />
          <span>School menus</span>
        </Link>
      </div>
      <p className="fw-muted">
        Buy or bring, on each child’s school days. Tap a day to change it; set each child’s usual
        week and school menu below. A day they buy shows what the school serves, or what they
        picked. A change a child made on the board waits for you on Today; your own change here is
        made at once.
      </p>
      <div className="fw-lunch__table">
        <table>
          <thead>
            <tr>
              <th scope="col">Child</th>
              {days.map((d) => (
                <th key={d} scope="col">
                  {dayName(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lunch.map((c) => {
              const name = names.get(c.memberId) ?? 'A child';
              return (
                <tr key={c.memberId}>
                  <th scope="row">{name}</th>
                  {c.days.map((d) => (
                    <td key={d.date} data-mode={d.mode ?? 'none'}>
                      {d.mode ? (
                        <>
                          <form action={setLunchDay}>
                            <input type="hidden" name="week" value={week} />
                            <Button
                              type="submit"
                              name="lunch"
                              value={`${c.memberId}:${d.date}:${d.mode === 'buy' ? 'bring' : 'buy'}`}
                              variant={d.mode === 'buy' ? 'secondary' : 'ghost'}
                              aria-label={`${name}, ${dayName(d.date)}: ${MODE_WORDS[d.mode].toLowerCase()}${d.changed ? ' (changed)' : ''}. Change to ${d.mode === 'buy' ? 'bring' : 'buy'}`}
                            >
                              {MODE_WORDS[d.mode]}
                            </Button>
                            {d.changed ? (
                              <span className="fw-lunch__changed">
                                {d.byBoard ? 'Changed on the board' : 'Changed'}
                              </span>
                            ) : null}
                            {/* [MEAL-09] A child's change waiting for a parent (WP-49). */}
                            {d.request?.status === 'waiting' ? (
                              <Link href="/admin/today" className="fw-lunch__waiting">
                                {d.request.mode === d.mode
                                  ? 'New picks waiting'
                                  : `${MODE_WORDS[d.request.mode]}? waiting`}
                              </Link>
                            ) : null}
                            {d.mode === 'buy' && c.menuSourceId && !d.choices?.length ? (
                              <span className="fw-lunch__menu">
                                {d.menu ? <MenuText day={d.menu} /> : 'No menu yet'}
                              </span>
                            ) : null}
                          </form>
                          {d.mode === 'buy' && c.menuSourceId ? (
                            <Picks week={week} memberId={c.memberId} name={name} d={d} />
                          ) : null}
                        </>
                      ) : (
                        <span className="fw-muted">{noLunchWords(d.dayType)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Usual week</h3>
      {lunch.map((c) => {
        const name = names.get(c.memberId) ?? 'A child';
        return (
          <form
            key={c.memberId}
            action={setUsualLunch}
            className="fw-form fw-lunch__usual"
            aria-label={`${name}’s usual lunches`}
          >
            <input type="hidden" name="week" value={week} />
            <input type="hidden" name="member" value={c.memberId} />
            <strong>{name}</strong>
            <div className="fw-lunch__weekdays">
              {WEEKDAYS.map((w) => (
                <label key={w} className="fw-field">
                  <span className="fw-field__label">{WEEKDAY_WORDS[w]}</span>
                  <select
                    className="fw-input"
                    name={`usual-${w}`}
                    defaultValue={c.usual[w] ?? 'bring'}
                  >
                    <option value="bring">Bring</option>
                    <option value="buy">Buy</option>
                  </select>
                </label>
              ))}
            </div>
            {menus.length > 0 ? (
              <label className="fw-field">
                <span className="fw-field__label">School menu</span>
                <select className="fw-input" name="menu" defaultValue={c.menuSourceId ?? ''}>
                  <option value="">None</option>
                  {menus.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="fw-actions">
              <Button type="submit" variant="secondary" icon="check">
                {`Save ${name}’s usual lunches`}
              </Button>
            </div>
          </form>
        );
      })}
    </section>
  );
}
