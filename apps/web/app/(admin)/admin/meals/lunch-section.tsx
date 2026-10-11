import { Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { dayName } from '@/lib/board-calendar';
import { type LunchChild, MODE_WORDS, noLunchWords, WEEKDAY_WORDS, WEEKDAYS } from '@/lib/lunch';
import { menuWords } from '@/lib/menus';
import { setLunchDay, setUsualLunch } from './actions';

/**
 * [MEAL-04][US-703] School lunch for the week: each child's school days, buy or bring, a tap to
 * change one (a day changed from the usual says so); days with no school lunch say why. [MEAL-05]
 * A buy day shows what the school serves, from the child's school menu (WP-27). Then each child's
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
        week and school menu below. A day they buy shows what the school serves.
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
                          {d.changed ? <span className="fw-lunch__changed">Changed</span> : null}
                          {d.mode === 'buy' && c.menuSourceId ? (
                            <span className="fw-lunch__menu">
                              {d.menu ? menuWords(d.menu) : 'No menu yet'}
                            </span>
                          ) : null}
                        </form>
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
