import { Button, Fold, Icon, type IconName } from '@familywise/ui';
import { brandOf, type GroceryBrand, withBrand } from '@/lib/grocery-brands';
import type { GroceryCategory, GroceryStore, SuggestContext } from '@/lib/groceries';
import { suggest } from '@/lib/groceries';
import {
  gapWords,
  notNowUntil,
  runningLowWords,
  type StaplesView,
  staplesSummary,
  statusWords,
} from '@/lib/grocery-staples';
import { addStaple, setStapleChoice } from './actions';

/** A thing's category's icon in a tile, as the mockup draws it. */
function Tile({
  categoryId,
  categories,
}: {
  categoryId: string;
  categories: readonly GroceryCategory[];
}) {
  const icon = (categories.find((c) => c.id === categoryId)?.icon ?? 'shopping-cart') as IconName;
  return (
    <span className="fw-groc__tile" aria-hidden="true">
      <Icon name={icon} size={20} />
    </span>
  );
}

/**
 * [MEAL-21][US-716] Groceries' Running low? (WP-106, D-138 (7), D-150): the staples due and not on
 * the list, most overdue first, each with its usual gap, when it was last got and where, **Add**
 * (the one way in, last time's category, store and brand) and **Not now** (hidden one more gap).
 * Open while anything is due; with nothing due it folds to "Nothing due". Nothing is added by itself.
 */
export function RunningLow({
  view,
  ctx,
  stores,
  brands,
  today,
  open,
}: {
  view: StaplesView;
  ctx: SuggestContext;
  stores: readonly GroceryStore[];
  brands: readonly GroceryBrand[];
  today: string;
  open: boolean;
}) {
  const due = view.runningLow;
  return (
    <Fold
      id="low"
      title={
        <>
          Running low?
          {due.length > 0 ? (
            <>
              {' '}
              <span className="fw-groc__count">{due.length}</span>
            </>
          ) : null}
        </>
      }
      headingId="low-heading"
      open={open || due.length > 0}
      summary={[
        <span key="s">
          {due.length > 0 ? <b>{due.map((s) => s.name).join(', ')}</b> : 'Nothing due'}
        </span>,
      ]}
    >
      {due.length === 0 ? (
        <p className="fw-muted">Nothing is due. Staples shows what’s learned.</p>
      ) : null}
      <ul className="fw-groc__asks" aria-label="Running low">
        {due.map((s) => {
          const at = suggest(s.name, ctx);
          const brand = brandOf(at?.brandId ?? null, brands);
          const store = stores.find((x) => x.id === at?.storeId)?.name ?? null;
          return (
            <li key={s.key} className="fw-groc__ask">
              <Tile categoryId={at?.categoryId ?? ''} categories={ctx.categories} />
              <strong>{withBrand(s.name, brand)}</strong>
              <span className="fw-muted fw-groc__ask-by">{runningLowWords(s, store)}</span>
              <div className="fw-groc__ask-acts">
                <form action={addStaple}>
                  <input type="hidden" name="name" value={s.name} />
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="categoryId" value={at?.categoryId ?? ''} />
                  <input type="hidden" name="storeId" value={at?.storeId ?? ''} />
                  <input type="hidden" name="brandId" value={at?.brandId ?? ''} />
                  <Button
                    type="submit"
                    variant="secondary"
                    icon="plus"
                    aria-label={`Add ${s.name} to the list`}
                  >
                    Add
                  </Button>
                </form>
                <form action={setStapleChoice}>
                  <input type="hidden" name="name" value={s.name} />
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="choice" value="not_now" />
                  <input type="hidden" name="until" value={notNowUntil(today, s.gap)} />
                  <Button type="submit" variant="ghost" aria-label={`Not now: ${s.name}`}>
                    Not now
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="fw-muted fw-groc__lowhelp">
        From how often each is bought. Nothing is added by itself.{' '}
        <a href="?open=staples#staples">Staples</a>
      </p>
    </Fold>
  );
}

/**
 * [MEAL-21] Groceries' Staples (WP-106): what FamilyWise has learned from what's ticked as got, here
 * and at the board, each with its gap and state and **Don't suggest**; what it's still learning;
 * and what the household chose not to have suggested, each with **Suggest again**.
 */
export function Staples({
  view,
  ctx,
  timezone,
  open,
}: {
  view: StaplesView;
  ctx: SuggestContext;
  timezone: string;
  open: boolean;
}) {
  const cat = (name: string) => suggest(name, ctx)?.categoryId ?? '';
  const choice = (key: string, name: string, value: 'off' | 'on', label: string) => (
    <form action={setStapleChoice}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="choice" value={value} />
      <Button
        type="submit"
        variant={value === 'on' ? 'secondary' : 'ghost'}
        aria-label={`${label}: ${name}`}
      >
        {label}
      </Button>
    </form>
  );
  const learning = view.learning;
  const firstFew = learning
    .slice(0, 3)
    .map(
      (l) =>
        `${l.name} (${l.irregular ? 'no steady gap' : `${l.buys} ${l.buys === 1 ? 'buy' : 'buys'}`})`,
    );
  return (
    <Fold
      id="staples"
      title="Staples"
      headingId="staples-heading"
      open={open}
      summary={[<span key="s">{staplesSummary(view)}</span>]}
    >
      <p className="fw-muted">
        Learned from what’s ticked as got, here and at the board. A thing needs 4 buys at a steady
        gap before it’s suggested.
      </p>
      <h3 className="fw-groc__staph">
        Learned <span>{view.learned.length}</span>
      </h3>
      {view.learned.length === 0 ? <p className="fw-muted">Nothing yet.</p> : null}
      <ul className="fw-groc__asks" aria-label="Learned">
        {view.learned.map((s) => (
          <li key={s.key} className="fw-groc__ask">
            <Tile categoryId={cat(s.name)} categories={ctx.categories} />
            <strong>{s.name}</strong>
            <span className="fw-muted fw-groc__ask-by">
              {gapWords(s.gap).replace(/^e/, 'E')} ·{' '}
              {s.status.kind === 'running-low' ? (
                <b className="fw-groc__low">Running low</b>
              ) : (
                statusWords(s)
              )}
            </span>
            <div className="fw-groc__ask-acts">{choice(s.key, s.name, 'off', 'Don’t suggest')}</div>
          </li>
        ))}
      </ul>
      <h3 className="fw-groc__staph">
        Still learning <span>{learning.length}</span>
      </h3>
      <p className="fw-muted">
        {learning.length === 0
          ? 'Nothing.'
          : `${firstFew.join(', ')}${learning.length > 3 ? `, and ${learning.length - 3} more` : ''}`}
      </p>
      {view.off.length > 0 ? (
        <>
          <h3 className="fw-groc__staph">
            Not suggested <span>{view.off.length}</span>
          </h3>
          <ul className="fw-groc__asks" aria-label="Not suggested">
            {view.off.map((s) => (
              <li key={s.key} className="fw-groc__ask">
                <Tile categoryId={cat(s.name)} categories={ctx.categories} />
                <strong>{s.name}</strong>
                <span className="fw-muted fw-groc__ask-by">
                  You chose Don’t suggest on{' '}
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: timezone,
                  }).format(new Date(s.offAt))}
                </span>
                <div className="fw-groc__ask-acts">
                  {choice(s.key, s.name, 'on', 'Suggest again')}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Fold>
  );
}
