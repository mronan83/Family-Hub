import { Avatar, type AvatarKey, Button, Fold, Icon, type MemberColor } from '@familywise/ui';
import { dayAndTime } from '@/lib/format';
import { brandOf, type GroceryBrand, withBrand } from '@/lib/grocery-brands';
import type { Person, WaitingAsk } from '@/lib/groceries';
import { decideGroceryAsks, setGroceryAskOk } from './actions';

/**
 * [MEAL-22][US-717] Groceries' Asked for (WP-107, D-149): the children's asks from the board that wait
 * for a parent, each with who, when and where, Add it and Not this time, and Add all; at its foot,
 * set apart, each child's "Wait for a grown-up's OK" (D-149 (4)). Open while anything waits; with
 * nothing waiting it folds to "None waiting", so the switches stay a tap away.
 */
export function AskedFor({
  asks,
  people,
  brands,
  timezone,
  open,
}: {
  asks: readonly WaitingAsk[];
  people: readonly Person[];
  brands: readonly GroceryBrand[];
  timezone: string;
  open: boolean;
}) {
  const children = people.filter((p) => p.role === 'child');
  const who = (id: string) => people.find((p) => p.id === id);
  const n = asks.length;
  return (
    <Fold
      id="asked"
      title="Asked for"
      headingId="asked-heading"
      open={open || n > 0}
      waiting={n > 0 ? `${n} waiting` : undefined}
      summary={[<span key="s">None waiting</span>]}
    >
      {n > 1 ? (
        <form action={decideGroceryAsks} className="fw-groc__askall">
          {asks.map((a) => (
            <input key={a.id} type="hidden" name="ids" value={a.id} />
          ))}
          <input type="hidden" name="approve" value="true" />
          <Button type="submit" variant="secondary" icon="check">
            Add all
          </Button>
        </form>
      ) : null}
      {n === 0 ? <p className="fw-muted">No asks wait for you.</p> : null}
      <ul className="fw-groc__asks" aria-label="Asks waiting">
        {asks.map((a) => {
          const m = who(a.memberId);
          const brand = brandOf(a.brandId, brands);
          return (
            <li key={a.id} className="fw-groc__ask">
              {m ? (
                <Avatar
                  name={m.name}
                  avatarKey={m.avatarKey as AvatarKey | null}
                  color={m.color as MemberColor}
                  size={36}
                  decorative
                />
              ) : (
                <Icon name="person" size={36} />
              )}
              <strong>{withBrand(a.name, brand)}</strong>
              <span className="fw-muted fw-groc__ask-by">
                {m?.name ?? 'A child'} asked
                {a.board ? ` at the ${a.board} board` : ''} · {dayAndTime(a.askedAt, timezone)}
              </span>
              <div className="fw-groc__ask-acts">
                <form action={decideGroceryAsks}>
                  <input type="hidden" name="ids" value={a.id} />
                  <input type="hidden" name="approve" value="true" />
                  <Button type="submit" icon="check" aria-label={`Add ${a.name} to the list`}>
                    Add it
                  </Button>
                </form>
                <form action={decideGroceryAsks}>
                  <input type="hidden" name="ids" value={a.id} />
                  <input type="hidden" name="approve" value="false" />
                  <Button
                    type="submit"
                    variant="ghost"
                    aria-label={`Not this time: ${a.name}${m ? `, ${m.name}’s ask` : ''}`}
                  >
                    Not this time
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      {children.length > 0 ? (
        <div className="fw-groc__okset" role="group" aria-labelledby="ask-ok-heading">
          <h3 id="ask-ok-heading">Wait for a grown-up’s OK</h3>
          <p className="fw-muted">
            When it’s on, what a child asks for at the board waits here. When it’s off, it goes
            straight on the list. A grown-up’s ask never waits.
          </p>
          <ul className="fw-groc__oks">
            {children.map((c) => {
              const on = c.askOk !== false;
              return (
                <li key={c.id} className="fw-groc__ok">
                  <Avatar
                    name={c.name}
                    avatarKey={c.avatarKey as AvatarKey | null}
                    color={c.color as MemberColor}
                    size={28}
                    decorative
                  />
                  <span className="fw-groc__grow">{c.name}</span>
                  <form action={setGroceryAskOk}>
                    <input type="hidden" name="member" value={c.id} />
                    <input type="hidden" name="ok" value={on ? 'false' : 'true'} />
                    <button
                      type="submit"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${c.name}’s asks wait for a grown-up’s OK`}
                      className="fw-groc__switch"
                    >
                      <span className="fw-groc__switch-word">{on ? 'On' : 'Off'}</span>
                      <span className="fw-groc__switch-track" aria-hidden="true" />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Fold>
  );
}
