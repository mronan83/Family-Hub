'use client';

import { Avatar, Button, Icon, type IconName } from '@familywise/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BoardGroceries, pictureOf } from '@/lib/board-groceries';
import {
  ASK_WORDS,
  askAnswerWords,
  askCard,
  askMatches,
  askTiles,
  brandRow,
  canTakeOff,
  gotTodayCard,
  groceryRefusalWords,
  heldFace,
  type HeldFace,
  MAX_WAITING,
  type PostGroceries,
  readAskAnswer,
  UNDO_MS,
  waitingFor,
} from '@/lib/grocery-asks';
import { brandOf, withBrand } from '@/lib/grocery-brands';
import { itemKey } from '@/lib/grocery-merge';
import {
  forMeals,
  type GroceryItem,
  itemAmount,
  sections,
  storeChips,
  type StoreFilter,
  toGet,
} from '@/lib/groceries';
import { time } from '@/lib/format';
import type { BoardMember } from '@/lib/snapshot';

/** A word from the board for 5 seconds, or 10 with Undo (D-149 (2)). */
interface Bar {
  text: string;
  icon: IconName;
  undo?: { ids: string[]; memberId: string };
}

const noPost: PostGroceries = async () => ({ ok: false, offline: true });

/**
 * [MEAL-18][MEAL-23][US-714] Groceries on the board (WP-104, D-138): the list by the household's
 * categories, A to Z, each thing with its picture, [MEAL-29] its brand ("Milk · Kirkland"), its
 * amount, and why when a meal needs it or someone asked. Store chips change only what the board
 * shows. [MEAL-22][MEAL-30][US-717][US-723] Since WP-107 (D-149): Ask for something, the Asked for
 * and Got today cards, and each thing's sheet to tick it off or take it off, as whoever's face is
 * picked, with Undo.
 */
export function GroceriesBoard({
  groceries,
  members,
  timeZone = 'UTC',
  post = noPost,
  refresh,
}: {
  groceries: BoardGroceries | null | undefined;
  members: BoardMember[];
  /** The household's time zone, for Got today's times. */
  timeZone?: string;
  /** POST /api/groceries on a board; the dev board's fixture otherwise. */
  post?: PostGroceries;
  /** Reads the list again after this board's own change. */
  refresh?: () => void;
}) {
  const [store, setStore] = useState<StoreFilter>('all');
  // The dialog or sheet open, with the face still picked when it opened (null: none).
  const [asking, setAsking] = useState<{ face: string | null } | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [sheet, setSheet] = useState<GroceryItem | null>(null);
  // [MEAL-30] Untick on Got today, when the board doesn't know whose face it is.
  const [untick, setUntick] = useState<{ id: string; name: string } | null>(null);
  const [held, setHeld] = useState<HeldFace | null>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const items = groceries?.items ?? [];
  const asks = groceries?.asks ?? [];
  const brands = groceries?.brands ?? [];
  const chips = groceries ? storeChips(items, groceries.stores) : [];
  // A store whose items have all gone shows the whole list again.
  const shown = chips.some((c) => c.filter === store) ? store : 'all';
  const list = groceries ? sections(items, groceries.categories, shown) : [];
  const card = askCard(asks);
  const got = gotTodayCard(groceries?.got ?? []);

  // The bar goes by itself: 10 seconds with Undo, 5 without.
  useEffect(() => {
    if (!bar) return;
    const t = setTimeout(() => setBar(null), bar.undo ? UNDO_MS : 5_000);
    return () => clearTimeout(t);
  }, [bar]);

  const pick = useCallback((memberId: string) => setHeld({ memberId, at: Date.now() }), []);
  const send: PostGroceries = useCallback(
    async (action) => {
      const answer = await post(action);
      if (answer.ok) refresh?.();
      else
        setBar({
          icon: 'info',
          text:
            'offline' in answer
              ? 'The board is offline. Try again in a moment.'
              : groceryRefusalWords(answer.reason),
        });
      return answer;
    },
    [post, refresh],
  );

  return (
    <section className="fw-bgroc" aria-labelledby="bgroc-title">
      <div className="fw-bgroc__head">
        <h2 id="bgroc-title" className="fw-bgroc__title">
          <Icon name="shopping-cart" size={56} />
          Groceries
          <span className="fw-bgroc__sub">{toGet(items.length)}</span>
        </h2>
        <Button
          icon="plus"
          className="fw-bgroc__ask"
          onClick={() => setAsking({ face: heldFace(held, Date.now()) })}
        >
          Ask for something
        </Button>
      </div>
      {chips.length > 2 ? (
        <div className="fw-bgroc__chips" role="group" aria-label="Stores">
          {chips.map((c) => (
            <button
              key={c.filter}
              type="button"
              className="fw-bgroc__chip"
              aria-pressed={c.filter === shown}
              onClick={() => setStore(c.filter)}
            >
              {c.filter !== 'all' && c.filter !== 'any' ? <Icon name="store" size={32} /> : null}
              {c.label} {c.count}
            </button>
          ))}
        </div>
      ) : null}
      <div className="fw-bgroc__body">
        {items.length === 0 ? (
          <div className="fw-bgroc__empty">
            <Icon name="shopping-cart" size={96} />
            <h3>Nothing on the list right now</h3>
            <p>
              Need something? Tap <b>Ask for something</b>.
            </p>
          </div>
        ) : (
          <div className="fw-bgroc__cols">
            {list.map((s) => (
              <section
                key={s.category.id}
                className="fw-bgroc__sec"
                aria-labelledby={`bgroc-${s.category.id}`}
              >
                <h3 id={`bgroc-${s.category.id}`}>
                  <Icon name={s.category.icon as IconName} size={40} />
                  <span>{s.category.name}</span>
                  <span className="fw-bgroc__n">{s.items.length}</span>
                </h3>
                <ul>
                  {s.items.map((item) => {
                    const amount = itemAmount(item);
                    const brand = brandOf(item.brandId, brands);
                    const meals = forMeals(item);
                    const askers = [
                      ...new Set(
                        item.reasons
                          .filter((r) => r.kind === 'ask' && r.memberId)
                          .map((r) => r.memberId!),
                      ),
                    ]
                      .map((id) => people.get(id))
                      .filter((m): m is BoardMember => !!m);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="fw-bgroc__it"
                          aria-label={`${withBrand(item.name, brand)}${amount ? ` ${amount}` : ''}: got it or take it off`}
                          onClick={() => {
                            setFace(heldFace(held, Date.now()));
                            setSheet(item);
                          }}
                        >
                          <Icon name={pictureOf(item.name, s.category) as IconName} size={40} />
                          <span className="fw-bgroc__nm">
                            {item.name}
                            {brand ? <span className="fw-bgroc__brand"> · {brand}</span> : null}
                            {amount ? <span className="fw-bgroc__amt"> {amount}</span> : null}
                          </span>
                          {meals ? (
                            <span className="fw-bgroc__wy">
                              <Icon name="utensils" size={28} />
                              For {meals}
                            </span>
                          ) : null}
                          {askers.map((m) => (
                            <span key={m.id} className="fw-bgroc__wy">
                              <Avatar
                                name={m.displayName}
                                avatarKey={m.avatarKey}
                                color={m.color}
                                size={32}
                                decorative
                              />
                              {m.displayName} asked
                            </span>
                          ))}
                          <span className="fw-bgroc__tk" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        <div className="fw-bgroc__side">
          <section className="fw-bgroc__card" aria-labelledby="bgroc-asked">
            <h3 id="bgroc-asked">
              <Icon name="gift" size={40} />
              Asked for
            </h3>
            {card.length === 0 ? (
              <p className="fw-bgroc__none">Nothing asked for.</p>
            ) : (
              <ul>
                {card.map(({ ask, state }) => {
                  const m = people.get(ask.memberId);
                  const brand = brandOf(ask.brandId, brands);
                  return (
                    <li key={ask.id} className="fw-bgroc__ask-row" data-state={state}>
                      {m ? (
                        <Avatar
                          name={m.displayName}
                          avatarKey={m.avatarKey}
                          color={m.color}
                          size={56}
                          decorative
                        />
                      ) : (
                        <Icon name="person" size={56} />
                      )}
                      <span className="fw-bgroc__ask-nm">{withBrand(ask.name, brand)}</span>
                      <span className="fw-bgroc__ask-st">
                        <Icon
                          name={
                            state === 'waiting'
                              ? 'hourglass'
                              : state === 'on'
                                ? 'check-circle'
                                : state === 'got'
                                  ? 'sparkles'
                                  : 'minus-circle'
                          }
                          size={28}
                        />
                        {ASK_WORDS[state]}
                      </span>
                      {state === 'waiting' ? (
                        <Button
                          variant="ghost"
                          className="fw-bgroc__calloff"
                          aria-label={`Call off ${ask.name}${m ? `, ${m.displayName}’s ask` : ''}`}
                          onClick={() => void send({ action: 'call_off', ask_id: ask.id })}
                        >
                          Call off
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="fw-bgroc__card" aria-labelledby="bgroc-got">
            <h3 id="bgroc-got">
              <Icon name="check-circle" size={40} />
              Got today
            </h3>
            {got.shown.length === 0 ? (
              <p className="fw-bgroc__none">Nothing ticked off today.</p>
            ) : (
              <ul>
                {got.shown.map((g) => {
                  const m = g.memberId ? people.get(g.memberId) : undefined;
                  const category = groceries?.categories.find((c) => c.id === g.categoryId);
                  return (
                    <li key={g.id} className="fw-bgroc__got">
                      <Icon name={pictureOf(g.name, category) as IconName} size={40} />
                      <span className="fw-bgroc__got-nm">
                        {withBrand(g.name, brandOf(g.brandId, brands))}
                      </span>
                      <span className="fw-bgroc__got-by">
                        {m ? `${m.displayName} · ` : ''}
                        {time(g.tickedAt, timeZone)}
                      </span>
                      <Button
                        variant="ghost"
                        icon="undo"
                        className="fw-bgroc__untick"
                        aria-label={`Untick ${g.name}`}
                        onClick={() => {
                          const who = heldFace(held, Date.now()) ?? g.memberId;
                          if (!who) return setUntick({ id: g.id, name: g.name });
                          void send({ action: 'tick', member_id: who, ids: [g.id], ticked: false });
                        }}
                      >
                        Untick
                      </Button>
                    </li>
                  );
                })}
                {got.more > 0 ? <li className="fw-bgroc__none">and {got.more} more</li> : null}
              </ul>
            )}
          </section>
        </div>
      </div>
      {asking && groceries ? (
        <AskDialog
          groceries={groceries}
          members={members}
          initial={asking.face}
          onPick={pick}
          onCancel={() => setAsking(null)}
          onAsk={async (memberId, name, brandId) => {
            const answer = await send({
              action: 'ask',
              member_id: memberId,
              name,
              brand_id: brandId,
            });
            if (!answer.ok) return;
            setAsking(null);
            const result = readAskAnswer(answer.data) ?? { status: 'waiting', already: false };
            setBar({
              icon: result.status === 'waiting' && !result.already ? 'hourglass' : 'check-circle',
              text: askAnswerWords(result, name, people.get(memberId)?.displayName ?? ''),
            });
          }}
        />
      ) : null}
      {sheet ? (
        <ItemSheet
          item={sheet}
          brand={brandOf(sheet.brandId, brands)}
          members={members}
          initial={face}
          onPick={pick}
          onCancel={() => setSheet(null)}
          onGot={async (memberId) => {
            const answer = await send({
              action: 'tick',
              member_id: memberId,
              ids: [sheet.id],
              ticked: true,
            });
            if (!answer.ok) return;
            setSheet(null);
            setBar({ icon: 'check-circle', text: `Got ${sheet.name}.` });
          }}
          onTakeOff={async (memberId) => {
            const answer = await send({ action: 'remove', member_id: memberId, ids: [sheet.id] });
            if (!answer.ok) return;
            setSheet(null);
            setBar({
              icon: 'trash',
              text: `Took ${sheet.name} off the list.`,
              undo: { ids: [sheet.id], memberId },
            });
          }}
        />
      ) : null}
      {untick ? (
        <WhoDialog
          title={`Who’s unticking ${untick.name}?`}
          action="Untick"
          members={members}
          onCancel={() => setUntick(null)}
          onDone={async (memberId) => {
            pick(memberId);
            const answer = await send({
              action: 'tick',
              member_id: memberId,
              ids: [untick.id],
              ticked: false,
            });
            if (answer.ok) setUntick(null);
          }}
        />
      ) : null}
      <div className="fw-bgroc__bar-slot" aria-live="polite">
        {bar ? (
          <p className="fw-bgroc__bar">
            <Icon name={bar.icon} size={36} />
            <span>{bar.text}</span>
            {bar.undo ? (
              <Button
                variant="secondary"
                icon="undo"
                onClick={() => {
                  const u = bar.undo!;
                  setBar(null);
                  void send({ action: 'restore', member_id: u.memberId, ids: u.ids });
                }}
              >
                Undo
              </Button>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** The faces, as the board's other pickers show them; one picked at a time. */
function Faces({
  members,
  picked,
  onPick,
  first,
}: {
  members: BoardMember[];
  picked: string | null;
  onPick: (id: string) => void;
  first?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <ul className="fw-bgroc__faces" aria-label="People">
      {members.map((m, n) => (
        <li key={m.id}>
          <button
            ref={n === 0 ? first : undefined}
            type="button"
            className="fw-today__person"
            aria-pressed={picked === m.id}
            onClick={() => onPick(m.id)}
          >
            <Avatar
              name={m.displayName}
              avatarKey={m.avatarKey}
              color={m.color}
              size={72}
              decorative
            />
            <span>{m.displayName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Who's doing it, for Untick when the board doesn't know. */
function WhoDialog({
  title,
  action,
  members,
  onCancel,
  onDone,
}: {
  title: string;
  action: string;
  members: BoardMember[];
  onCancel: () => void;
  onDone: (memberId: string) => Promise<void>;
}) {
  const [who, setWho] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEscape(onCancel);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="fw-today__scrim">
      <div
        className="fw-today__picker fw-bgroc__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="who-untick"
      >
        <h2 id="who-untick">{title}</h2>
        <Faces members={members} picked={who} onPick={setWho} first={first} />
        <div className="fw-today__picker-actions">
          <Button icon="undo" disabled={!who} onClick={() => who && void onDone(who)}>
            {action}
          </Button>
          <Button variant="ghost" icon="close" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel]);
}

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/**
 * [MEAL-22][US-717] Ask for something: who, then a tile or Something else on the board's own
 * keyboard, then (D-149 (5)) the thing's brand when it has had one.
 */
function AskDialog({
  groceries,
  members,
  initial,
  onPick,
  onCancel,
  onAsk,
}: {
  groceries: BoardGroceries;
  members: BoardMember[];
  initial: string | null;
  onPick: (id: string) => void;
  onCancel: () => void;
  onAsk: (memberId: string, name: string, brandId: string | null) => Promise<void>;
}) {
  const [who, setWho] = useState<string | null>(initial);
  const [thing, setThing] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEscape(onCancel);
  useEffect(() => first.current?.focus(), []);
  const known = groceries.known ?? [];
  const asks = groceries.asks ?? [];
  const member = members.find((m) => m.id === who) ?? null;
  const full = !!member && member.role === 'child' && waitingFor(asks, member.id) >= MAX_WAITING;
  const tiles = askTiles(known, groceries.items, asks, who);
  const row = thing ? brandRow(thing, known, groceries.brands) : null;
  const ask = async (name: string, brandId: string | null) => {
    if (!who || busy) return;
    setBusy(true);
    await onAsk(who, name, brandId);
    setBusy(false);
  };
  // A tile: a thing with brands shows its brand row; one without asks at once.
  const tap = (name: string) => {
    const r = brandRow(name, known, groceries.brands);
    if (r.brands.length === 0) return void ask(name, null);
    setThing(name);
    setBrand(r.picked);
  };
  const choose = (id: string) => {
    setWho(id);
    onPick(id);
  };
  const name = member?.displayName;

  if (typing) {
    const matches = askMatches(typed, known);
    const onList = new Set(groceries.items.map((i) => itemKey(i.name)));
    return (
      <div className="fw-today__scrim">
        <div
          className="fw-today__picker fw-bgroc__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ask-type-title"
        >
          <h2 id="ask-type-title">What would you like{name ? `, ${name}` : ''}?</h2>
          <p className="fw-bgroc__field" aria-live="polite" data-empty={typed ? undefined : 'true'}>
            {typed || 'Type it here'}
            <span className="fw-bgroc__caret" aria-hidden="true" />
          </p>
          {matches.length > 0 ? (
            <div className="fw-bgroc__matches" role="group" aria-label="Matches">
              {matches.map((m) => (
                <Button
                  key={m.key}
                  variant="secondary"
                  onClick={() => {
                    setTyping(false);
                    tap(m.name);
                  }}
                >
                  {m.name}
                  {onList.has(m.key) ? ' · on the list' : ''}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="fw-bgroc__keys" role="group" aria-label="Keyboard">
            {KEY_ROWS.map((r, n) => (
              <div key={r} className="fw-bgroc__keyrow">
                {[...r].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="fw-bgroc__key"
                    onClick={() =>
                      setTyped((t) => (t.length >= 80 ? t : t ? t + k.toLowerCase() : k))
                    }
                  >
                    {k}
                  </button>
                ))}
                {n === 2 ? (
                  <button
                    type="button"
                    className="fw-bgroc__key fw-bgroc__key--wide"
                    onClick={() => setTyped((t) => t.slice(0, -1))}
                  >
                    <Icon name="chevron-left" size={32} />
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
            <div className="fw-bgroc__keyrow">
              <button
                type="button"
                className="fw-bgroc__key fw-bgroc__key--space"
                onClick={() => setTyped((t) => (t && !t.endsWith(' ') ? `${t} ` : t))}
              >
                space
              </button>
            </div>
          </div>
          <div className="fw-today__picker-actions">
            <Button variant="ghost" icon="chevron-left" onClick={() => setTyping(false)}>
              Back
            </Button>
            <Button
              icon="check"
              disabled={!typed.trim() || !who || busy}
              onClick={() => {
                const t = typed.trim();
                const r = brandRow(t, known, groceries.brands);
                if (r.brands.length === 0) return void ask(t, null);
                setTyping(false);
                setThing(t);
                setBrand(r.picked);
              }}
            >
              Ask for it
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fw-today__scrim">
      <div
        className="fw-today__picker fw-bgroc__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
      >
        <h2 id="ask-title">Ask for something</h2>
        <p className="fw-bgroc__lbl">Who’s asking?</p>
        <Faces members={members} picked={who} onPick={choose} first={first} />
        {who ? (
          <>
            <p className="fw-bgroc__lbl">What would you like, {name}?</p>
            <div className="fw-bgroc__tiles" role="group" aria-label="Things to ask for">
              {tiles.map((t) => {
                const category = groceries.categories.find(
                  (c) => c.id === known.find((k) => k.key === t.key)?.categoryId,
                );
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="fw-bgroc__tile"
                    data-mark={t.mark ?? undefined}
                    aria-pressed={thing !== null && itemKey(thing) === t.key}
                    disabled={full && t.mark !== 'on'}
                    onClick={() => tap(t.name)}
                  >
                    <Icon name={pictureOf(t.name, category) as IconName} size={56} />
                    <span>{t.name}</span>
                    {t.mark ? (
                      <span className="fw-bgroc__mark">
                        {t.mark === 'on' ? 'On the list' : 'Asked'}
                      </span>
                    ) : null}
                  </button>
                );
              })}
              <button
                type="button"
                className="fw-bgroc__tile fw-bgroc__tile--else"
                disabled={full}
                onClick={() => {
                  setThing(null);
                  setTyping(true);
                }}
              >
                <Icon name="edit" size={56} />
                <span>Something else</span>
              </button>
            </div>
          </>
        ) : null}
        {row && thing ? (
          <div className="fw-bgroc__brands" role="group" aria-label={`Brand of ${thing}`}>
            <p className="fw-bgroc__lbl">Which brand of {thing}?</p>
            <div className="fw-bgroc__chips">
              {row.brands.map((b, n) => (
                <button
                  key={b.id}
                  type="button"
                  className="fw-bgroc__chip"
                  aria-pressed={brand === b.id}
                  onClick={() => setBrand(b.id)}
                >
                  {b.name}
                  {n === 0 ? <span className="fw-bgroc__last"> · last time</span> : null}
                </button>
              ))}
              <button
                type="button"
                className="fw-bgroc__chip"
                aria-pressed={brand === null}
                onClick={() => setBrand(null)}
              >
                No brand
              </button>
            </div>
          </div>
        ) : null}
        <div className="fw-bgroc__foot">
          {full ? (
            <p className="fw-bgroc__note fw-bgroc__note--warn">
              <Icon name="hourglass" size={32} />
              {groceryRefusalWords('too_many')}
            </p>
          ) : (
            <span />
          )}
          <div className="fw-today__picker-actions">
            <Button variant="ghost" icon="close" onClick={onCancel}>
              Cancel
            </Button>
            {thing ? (
              <Button icon="check" disabled={busy} onClick={() => void ask(thing, brand)}>
                Ask for {withBrand(thing, brand ? brandOf(brand, groceries.brands) : null)}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * [MEAL-30][US-723] A thing's sheet: who's this, then Got it (a buy) or Take it off the list (not a
 * buy), which a child may do only for what they alone asked for (D-149 (1)).
 */
function ItemSheet({
  item,
  brand,
  members,
  initial,
  onPick,
  onCancel,
  onGot,
  onTakeOff,
}: {
  item: GroceryItem;
  brand: string | null;
  members: BoardMember[];
  initial: string | null;
  onPick: (id: string) => void;
  onCancel: () => void;
  onGot: (memberId: string) => Promise<void>;
  onTakeOff: (memberId: string) => Promise<void>;
}) {
  const [who, setWho] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEscape(onCancel);
  useEffect(() => first.current?.focus(), []);
  const member = members.find((m) => m.id === who) ?? null;
  const may = member ? canTakeOff(item, member) : false;
  const amount = itemAmount(item);
  const run = async (f: (id: string) => Promise<void>) => {
    if (!who || busy) return;
    setBusy(true);
    await f(who);
    setBusy(false);
  };
  return (
    <div className="fw-today__scrim">
      <div
        className="fw-today__picker fw-bgroc__dialog fw-bgroc__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
      >
        <header className="fw-bgroc__what">
          <span className="fw-bgroc__pic">
            <Icon name={pictureOf(item.name, undefined) as IconName} size={72} />
          </span>
          <h2 id="sheet-title">
            {item.name}
            {brand ? <span className="fw-bgroc__brand"> · {brand}</span> : null}
            {amount ? <span className="fw-bgroc__amt"> {amount}</span> : null}
          </h2>
        </header>
        <p className="fw-bgroc__lbl">Who’s this?</p>
        <Faces
          members={members}
          picked={who}
          first={first}
          onPick={(id) => {
            setWho(id);
            onPick(id);
          }}
        />
        <div className="fw-today__picker-actions">
          <Button icon="check" disabled={!who || busy} onClick={() => void run(onGot)}>
            Got it
          </Button>
          <Button
            variant="secondary"
            icon="trash"
            disabled={!who || !may || busy}
            onClick={() => void run(onTakeOff)}
          >
            Take it off the list
          </Button>
          <span className="fw-bgroc__grow" />
          <Button variant="ghost" icon="close" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="fw-bgroc__note">
          <Icon name="info" size={32} />
          {member && !may
            ? `${groceryRefusalWords('not_yours')} You can still tick it: Got it.`
            : 'Got it means it was bought. Take it off if it isn’t needed after all.'}
        </p>
      </div>
    </div>
  );
}
