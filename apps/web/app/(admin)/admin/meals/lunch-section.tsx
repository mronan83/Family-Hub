import { type AvatarKey, Button, Icon, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import { type LunchChild, WEEKDAY_WORDS, WEEKDAYS } from '@/lib/lunch';
import { setUsualLunch } from './actions';
import { LunchWeek } from './lunch-week';

/**
 * [MEAL-04][US-703] School lunch for the week: [MEAL-13] one child's Monday to Friday as a list of
 * days (WP-74, D-98), each day's Buy or Bring and, on a Buy day, the day's menu to pick from (WP-49,
 * WP-64); then each child's usual week, Monday to Friday, and the school menu their lunch comes from.
 */
export function LunchSection({
  week,
  today,
  lunch,
  menus = [],
  members,
}: {
  week: string;
  /** The household's today, outlined on the list. */
  today: string;
  lunch: LunchChild[];
  /** The household's school menus (WP-27). */
  menus?: { id: string; name: string }[];
  /** The family, for each child's name and face. */
  members: { id: string; displayName: string; avatarKey?: AvatarKey | null; color?: MemberColor }[];
}) {
  if (lunch.length === 0) return null;
  const names = new Map(members.map((m) => [m.id, m.displayName]));
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
        Open a day to change Buy or Bring and, on a Buy day, pick from the school’s menu. A check
        means the day is set. A change a child made on the board waits for you on Today; your own
        change here is made at once.
      </p>
      <LunchWeek
        week={week}
        today={today}
        lunch={lunch.map((c) => {
          const m = members.find((x) => x.id === c.memberId);
          return {
            ...c,
            name: m?.displayName ?? 'A child',
            avatarKey: m?.avatarKey ?? null,
            ...(m?.color ? { color: m.color } : {}),
          };
        })}
      />

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
