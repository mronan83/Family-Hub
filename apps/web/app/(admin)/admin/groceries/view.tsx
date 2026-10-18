import { Banner, Button, Fold, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { time } from '@/lib/format';
import {
  categoryOrder,
  type GroceryItem,
  gotRecently,
  itemAmount,
  type Person,
  sections,
  storeChips,
  type StoreFilter,
  toGet,
} from '@/lib/groceries';
import type { GroceriesData } from './data';
import { AdminHeader } from '../header';
import {
  moveGroceries,
  movePlace,
  removeGroceries,
  removePlace,
  setGroceriesStore,
  tickGrocery,
} from './actions';
import { AddForm } from './add-form';
import { EditForm, PlaceForm } from './forms';
import { ItemWords, SectionHead } from './rows';
import { MoreMenu } from './more-menu';
import { SelectList } from './select-list';

/** What the page was opened with: the store chip, a row's open panel, Select, a notice. */
export interface GroceriesQuery {
  store?: string;
  did?: string;
  name?: string;
  select?: string;
  sel?: string;
  edit?: string;
  move?: string;
  storeOf?: string;
  cat?: string;
  open?: string;
  ask?: string;
  rename?: string;
  t?: string;
}

const NOTICES: Record<string, (name: string) => string> = {
  added: (n) => `Added ${n}.`,
  merged: (n) => `${n} was already on the list, so it’s one item now.`,
  ticked: () => 'Got it. It’s under Got recently for a week.',
  unticked: () => 'Back on the list.',
  edited: () => 'Saved.',
  'category-added': () => 'Category added. It’s last before Other.',
  'category-renamed': () => 'Category renamed.',
  'category-moved': () => 'Moved.',
  'category-removed': () => 'Category removed. Its items are in Other.',
  'store-added': () => 'Store added.',
  'store-renamed': () => 'Store renamed.',
  'store-moved': () => 'Moved.',
  'store-removed': () => 'Store removed. Its items can be got anywhere.',
};

function noticeOf(did: string | undefined, name: string): string | null {
  if (!did) return null;
  const m = /^(removed|moved|stored)-(\d+)$/.exec(did);
  if (m) {
    const n = Number(m[2]);
    const what = n === 1 ? 'Done: 1 item' : `Done: ${n} items`;
    return m[1] === 'removed'
      ? `${what} taken off the list.`
      : m[1] === 'moved'
        ? `${what} moved.`
        : `${what} given a store.`;
  }
  if (did === 'name-taken') return null;
  return NOTICES[did]?.(name) ?? null;
}

const weekdayTime = (at: string, tz: string) =>
  `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(at))} ${time(at, tz)}`;

/** The ⋯'s "why it's on the list": each reason with what it brought. */
function whyDetail(item: GroceryItem, people: readonly Person[]): string[] {
  const name = (r: GroceryItem['reasons'][number]) =>
    people.find((p) => p.userId !== null && p.userId === r.byUser)?.name ?? 'an admin';
  const lines = item.reasons.map((r) => {
    const amount = r.amount ? `: ${r.amount}` : '';
    if (r.kind === 'meal') return `${r.label ?? 'A meal'}${amount}`;
    if (r.kind === 'ask')
      return `${people.find((p) => p.id === r.memberId)?.name ?? 'A child'} asked${amount}`;
    if (r.kind === 'staple') return `A staple${amount}`;
    return `Added by ${name(r)}${amount}`;
  });
  const meals = item.reasons.filter((r) => r.kind === 'meal');
  if (meals.length > 1) {
    const by = people.find((p) => p.userId !== null && p.userId === meals[0]!.byUser)?.name;
    lines.push(`Merged from ${meals.length} meals${by ? ` · added by ${by}` : ''}`);
  }
  if (item.amount) lines.push(`Changed to ${item.amount}`);
  return lines;
}

/**
 * [MEAL-18][MEAL-23][MEAL-24] The admin app's Groceries (WP-104, D-138): the add field open at the
 * top, the category and store suggested; the list by category, A to Z, each item with its amount,
 * store and why, a tick to get it and ⋯ for the rest; store chips; Select to move, set the store
 * of or remove several at once; Got recently for a week, with Untick; and the household's own
 * Categories and stores. It works the same with no Apple Reminders sync (WP-103, later).
 */
export function GroceriesView({
  data,
  timezone,
  now,
  query,
  error,
  dev,
}: {
  data: GroceriesData;
  timezone: string;
  now: number;
  query: GroceriesQuery;
  error: string | null;
  /** For the dev page only: the add field typed into, an item's ⋯ open, Select's panel open. */
  dev?: { typed?: string; menu?: string; panel?: string };
}) {
  const { categories, stores, items, people } = data;
  const store: StoreFilter = query.store || 'all';
  const open = items.filter((i) => i.status === 'open');
  const chips = storeChips(items, stores);
  const list = sections(items, categories, store);
  const got = gotRecently(items, now);
  const ordered = categoryOrder(categories);
  const selecting = query.select === '1';
  const notice = noticeOf(query.did, query.name ?? 'It');
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (store !== 'all') p.set('store', store);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return `/admin/groceries${s ? `?${s}` : ''}`;
  };
  const hidden = (id: string) => (
    <>
      <input type="hidden" name="ids" value={id} />
      <input type="hidden" name="store" value={store} />
    </>
  );
  const placesOpen = query.open === 'places' || /^(category|store)-/.test(query.did ?? '');
  const placeAsk = query.ask ?? null;
  const onList = (catId: string) => open.filter((i) => i.categoryId === catId).length;
  const atStore = (storeId: string) => open.filter((i) => i.storeId === storeId).length;
  const countWords = (n: number) => (n === 0 ? 'Empty' : `${n} on the list`);

  return (
    <main className="fw-page fw-page--wide fw-groc">
      <AdminHeader current="/admin/groceries" />
      {error || query.did === 'failed' ? (
        <Banner kind="notice">{error ?? 'That didn’t change. Try again in a moment.'}</Banner>
      ) : query.did === 'name-taken' ? (
        <Banner kind="notice">That category name is taken. Pick it from the list instead.</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <section className="fw-card fw-groc__head" aria-labelledby="groceries-heading">
        <div className="fw-bar">
          <h1 id="groceries-heading">Groceries</h1>
          <span className="fw-muted">{toGet(open.length)}</span>
        </div>
        <p className="fw-groc__state">
          <Icon name="info" size={16} />
          FamilyWise’s own list. Apple Reminders sync is off.
        </p>
        <AddForm
          key={query.t ?? 'add'}
          categories={categories}
          stores={stores}
          open={open}
          people={people}
          ctx={{ categories, past: data.past, learned: data.learned }}
          fixedCategory={query.cat ?? null}
          storeFilter={store}
          initial={dev?.typed}
        />
      </section>

      <section className="fw-card fw-groc__list" aria-labelledby="list-heading">
        <div className="fw-groc__listhead">
          <h2 id="list-heading">On the list</h2>
          <span className="fw-groc__count">{open.length}</span>
          <span className="fw-groc__grow" />
          {open.length > 0 ? (
            selecting ? (
              <Link className="fw-btn fw-btn--ghost" href={q({})}>
                Done
              </Link>
            ) : (
              <Link className="fw-btn fw-btn--ghost" href={q({ select: '1' })}>
                <Icon name="select-multiple" className="fw-btn__icon" />
                Select
              </Link>
            )
          ) : null}
        </div>
        {chips.length > 2 ? (
          <nav className="fw-groc__chips" aria-label="Stores">
            {chips.map((c) => (
              <Link
                key={c.filter}
                className="fw-groc__chip"
                aria-current={c.filter === store ? 'true' : undefined}
                href={
                  c.filter === 'all'
                    ? `/admin/groceries${selecting ? '?select=1' : ''}`
                    : `/admin/groceries?store=${c.filter}${selecting ? '&select=1' : ''}`
                }
              >
                {c.filter !== 'all' && c.filter !== 'any' ? <Icon name="store" size={18} /> : null}
                {c.label} <b>{c.count}</b>
              </Link>
            ))}
          </nav>
        ) : null}
        {open.length === 0 ? (
          <p className="fw-groc__empty">Nothing on the list right now.</p>
        ) : selecting ? (
          <SelectList
            sections={list}
            categories={ordered}
            stores={stores}
            people={people}
            initial={query.sel ? query.sel.split(',') : []}
            storeFilter={store}
            initialPanel={dev?.panel === 'move' ? 'move' : null}
          />
        ) : (
          list.map((s) => (
            <section key={s.category.id} aria-labelledby={`cat-${s.category.id}`}>
              <SectionHead section={s}>
                <Link
                  className="fw-groc__secadd"
                  href={`${q({ cat: s.category.id })}#add`}
                  aria-label={`Add to ${s.category.name}`}
                >
                  <Icon name="plus" size={18} />
                </Link>
              </SectionHead>
              <ul className="fw-groc__rows">
                {s.items.map((item) => (
                  <li key={item.id} id={`item-${item.id}`} className="fw-groc__row">
                    <form action={tickGrocery} className="fw-groc__tick">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="ticked" value="true" />
                      <input type="hidden" name="store" value={store} />
                      <button
                        type="submit"
                        className="fw-groc__box"
                        aria-label={`Got ${item.name}`}
                      />
                    </form>
                    <ItemWords item={item} stores={stores} people={people} />
                    <MoreMenu label={`More for ${item.name}`} open={dev?.menu === item.id}>
                      <div className="fw-groc__mh">
                        <b>Why it’s on the list</b>
                        {whyDetail(item, people).map((l, i) => (
                          <span key={i}>{l}</span>
                        ))}
                      </div>
                      <Link
                        className="fw-groc__mi"
                        href={`${q({ edit: item.id })}#item-${item.id}`}
                      >
                        <Icon name="edit" size={20} />
                        Edit
                      </Link>
                      <Link
                        className="fw-groc__mi"
                        href={`${q({ move: item.id })}#item-${item.id}`}
                      >
                        <Icon name="chevron-right" size={20} />
                        <span className="fw-groc__grow">Move to…</span>
                        <span className="fw-muted">{s.category.name}</span>
                      </Link>
                      <Link
                        className="fw-groc__mi"
                        href={`${q({ storeOf: item.id })}#item-${item.id}`}
                      >
                        <Icon name="store" size={20} />
                        <span className="fw-groc__grow">Store…</span>
                        <span className="fw-muted">
                          {stores.find((x) => x.id === item.storeId)?.name ?? 'Any store'}
                        </span>
                      </Link>
                      <Link className="fw-groc__mi" href={q({ select: '1', sel: item.id })}>
                        <Icon name="select-multiple" size={20} />
                        Select several
                      </Link>
                      <form action={removeGroceries}>
                        {hidden(item.id)}
                        <button type="submit" className="fw-groc__mi fw-groc__mi--rm">
                          <Icon name="trash" size={20} />
                          Remove {item.name}
                        </button>
                      </form>
                    </MoreMenu>
                    {query.edit === item.id ? (
                      <EditForm
                        id={item.id}
                        name={item.name}
                        amount={itemAmount(item)}
                        storeFilter={store}
                      />
                    ) : null}
                    {query.move === item.id ? (
                      <form
                        action={moveGroceries}
                        className="fw-groc__panel"
                        aria-label={`Move ${item.name} to`}
                      >
                        {hidden(item.id)}
                        <p className="fw-groc__panel-h">Move {item.name} to</p>
                        {ordered.map((c) => (
                          <label key={c.id} className="fw-choice fw-groc__opt">
                            <input
                              type="radio"
                              name="categoryId"
                              value={c.id}
                              defaultChecked={c.id === item.categoryId}
                            />
                            <Icon name={c.icon as IconName} size={18} />
                            {c.name}
                          </label>
                        ))}
                        <label className="fw-field">
                          <span className="fw-field__label">Or a new category</span>
                          <input
                            className="fw-input"
                            name="newCategory"
                            maxLength={40}
                            autoComplete="off"
                          />
                        </label>
                        <Button type="submit" icon="check">
                          Move
                        </Button>
                      </form>
                    ) : null}
                    {query.storeOf === item.id ? (
                      <form
                        action={setGroceriesStore}
                        className="fw-groc__panel"
                        aria-label={`Store for ${item.name}`}
                      >
                        {hidden(item.id)}
                        <p className="fw-groc__panel-h">Where to get {item.name}</p>
                        {[{ id: '', name: 'Any store' }, ...stores].map((x) => (
                          <label key={x.id || 'any'} className="fw-choice fw-groc__opt">
                            <input
                              type="radio"
                              name="storeId"
                              value={x.id}
                              defaultChecked={(item.storeId ?? '') === x.id}
                            />
                            {x.name}
                          </label>
                        ))}
                        <Button type="submit" icon="check">
                          Set the store
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </section>

      <Fold
        id="got"
        title={
          <>
            Got recently
            {got.length > 0 ? (
              <>
                {' '}
                <span className="fw-groc__count">{got.length}</span>
              </>
            ) : null}
          </>
        }
        headingId="got-heading"
        open={query.open === 'got' || query.did === 'unticked'}
        summary={
          got.length > 0
            ? [
                <span key="s">
                  <b>{got[0]!.name}</b>, {weekdayTime(got[0]!.tickedAt!, timezone)}
                  {got.length > 1 ? `, and ${got.length - 1} more this week` : ''}
                </span>,
              ]
            : [<span key="s">Nothing got this week</span>]
        }
      >
        {got.length === 0 ? (
          <p className="fw-muted">Nothing got in the last 7 days.</p>
        ) : (
          <ul className="fw-groc__rows" aria-label="Got recently">
            {got.map((item) => {
              const by = people.find((p) => p.userId !== null && p.userId === item.tickedBy);
              const amount = itemAmount(item);
              return (
                <li key={item.id} className="fw-groc__row fw-groc__row--got">
                  <span className="fw-groc__words">
                    <span className="fw-groc__l1">
                      <strong>{item.name}</strong>
                      {amount ? <span className="fw-groc__amt">{amount}</span> : null}
                    </span>
                    <span className="fw-groc__l2">
                      Got {weekdayTime(item.tickedAt!, timezone)}
                      {by ? ` by ${by.name}` : ''}
                    </span>
                  </span>
                  <form action={tickGrocery}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="ticked" value="false" />
                    <input type="hidden" name="store" value={store} />
                    <Button
                      type="submit"
                      variant="ghost"
                      icon="undo"
                      aria-label={`Untick ${item.name}`}
                    >
                      Untick
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Fold>

      <Fold
        id="places"
        title="Categories and stores"
        headingId="places-heading"
        open={placesOpen || !!query.rename || !!placeAsk}
        summary={[
          <span key="s">
            <b>{categories.length} categories</b> · {stores.length} stores
          </span>,
        ]}
      >
        <div className="fw-groc__sech">
          <Icon name="list-check" size={18} />
          <h3>Categories</h3>
          <span className="fw-groc__n">{categories.length}</span>
        </div>
        <p className="fw-muted">
          In this order on the list and the board. ⋯ holds Rename and Remove; removing one moves its
          items to Other, and asks first.
        </p>
        <ul className="fw-groc__rows" aria-label="Categories">
          {ordered.map((c, i) => (
            <li key={c.id} className="fw-groc__row fw-groc__place">
              <span className="fw-groc__tile" aria-hidden>
                <Icon name={c.icon as IconName} size={20} />
              </span>
              <span className="fw-groc__words">
                <strong>{c.name}</strong>
                <span className="fw-groc__l2">
                  {countWords(onList(c.id))}
                  {c.isOther ? ' · always last' : ''}
                </span>
              </span>
              {c.isOther ? null : (
                <span className="fw-groc__placeacts">
                  <form action={movePlace}>
                    <input type="hidden" name="kind" value="category" />
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="step" value="-1" />
                    <button
                      type="submit"
                      className="fw-groc__iconbtn"
                      aria-label={`Move ${c.name} up`}
                      disabled={i === 0}
                    >
                      <Icon name="chevron-up" />
                    </button>
                  </form>
                  <form action={movePlace}>
                    <input type="hidden" name="kind" value="category" />
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="step" value="1" />
                    <button
                      type="submit"
                      className="fw-groc__iconbtn"
                      aria-label={`Move ${c.name} down`}
                      disabled={i >= ordered.length - 2}
                    >
                      <Icon name="chevron-down" />
                    </button>
                  </form>
                  <details className="fw-groc__more">
                    <summary className="fw-groc__morebtn" aria-label={`More for ${c.name}`}>
                      <Icon name="more" />
                    </summary>
                    <div className="fw-groc__menu">
                      <Link className="fw-groc__mi" href={`/admin/groceries?rename=${c.id}#places`}>
                        <Icon name="edit" size={20} />
                        Rename
                      </Link>
                      {onList(c.id) > 0 ? (
                        <Link
                          className="fw-groc__mi fw-groc__mi--rm"
                          href={`/admin/groceries?ask=${c.id}#places`}
                        >
                          <Icon name="trash" size={20} />
                          Remove {c.name}
                        </Link>
                      ) : (
                        <form action={removePlace}>
                          <input type="hidden" name="kind" value="category" />
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="fw-groc__mi fw-groc__mi--rm">
                            <Icon name="trash" size={20} />
                            Remove {c.name}
                          </button>
                        </form>
                      )}
                    </div>
                  </details>
                </span>
              )}
              {query.rename === c.id ? <PlaceForm kind="category" id={c.id} name={c.name} /> : null}
              {placeAsk === c.id ? (
                <form
                  action={removePlace}
                  className="fw-groc__panel"
                  aria-label={`Remove ${c.name}`}
                >
                  <input type="hidden" name="kind" value="category" />
                  <input type="hidden" name="id" value={c.id} />
                  <p className="fw-groc__panel-h">
                    Remove {c.name}? Its {onList(c.id)} item{onList(c.id) === 1 ? '' : 's'} go to
                    Other.
                  </p>
                  <div className="fw-actions">
                    <Button type="submit" variant="danger" icon="trash">
                      Remove {c.name}
                    </Button>
                    <Link
                      className="fw-btn fw-btn--ghost"
                      href="/admin/groceries?open=places#places"
                    >
                      Keep it
                    </Link>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <PlaceForm kind="category" placeholder="New category, like Baby" />

        <div className="fw-groc__sech">
          <Icon name="store" size={18} />
          <h3>Stores</h3>
          <span className="fw-groc__n">{stores.length}</span>
        </div>
        <ul className="fw-groc__rows" aria-label="Stores">
          {[...stores]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s, i, all) => (
              <li key={s.id} className="fw-groc__row fw-groc__place">
                <span className="fw-groc__tile" aria-hidden>
                  <Icon name="store" size={20} />
                </span>
                <span className="fw-groc__words">
                  <strong>{s.name}</strong>
                  <span className="fw-groc__l2">
                    {atStore(s.id) === 0 ? 'None on the list' : `${atStore(s.id)} on the list`}
                  </span>
                </span>
                <span className="fw-groc__placeacts">
                  <details className="fw-groc__more">
                    <summary className="fw-groc__morebtn" aria-label={`More for ${s.name}`}>
                      <Icon name="more" />
                    </summary>
                    <div className="fw-groc__menu">
                      <Link className="fw-groc__mi" href={`/admin/groceries?rename=${s.id}#places`}>
                        <Icon name="edit" size={20} />
                        Rename
                      </Link>
                      {(
                        [
                          [-1, 'up', 'chevron-up', i === 0],
                          [1, 'down', 'chevron-down', i === all.length - 1],
                        ] as const
                      ).map(([step, word, icon, off]) =>
                        off ? null : (
                          <form key={word} action={movePlace}>
                            <input type="hidden" name="kind" value="store" />
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="step" value={String(step)} />
                            <button type="submit" className="fw-groc__mi">
                              <Icon name={icon} size={20} />
                              Move {word}
                            </button>
                          </form>
                        ),
                      )}
                      <form action={removePlace}>
                        <input type="hidden" name="kind" value="store" />
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="fw-groc__mi fw-groc__mi--rm">
                          <Icon name="trash" size={20} />
                          Remove {s.name}
                        </button>
                      </form>
                    </div>
                  </details>
                </span>
                {query.rename === s.id ? <PlaceForm kind="store" id={s.id} name={s.name} /> : null}
              </li>
            ))}
        </ul>
        <PlaceForm kind="store" placeholder="New store, like Trader Joe’s" />
      </Fold>
    </main>
  );
}
