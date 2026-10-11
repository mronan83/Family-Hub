'use client';

import { Avatar, Button, ChoreTile, GoalMeter, Icon, PointsChip } from '@familywise/ui';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Answer,
  type CompletionEvent,
  createOutbox,
  type Outbox,
  type Post,
} from '@/lib/outbox';
import type { BoardStore } from '@/lib/board-store';
import { signed } from '@/lib/points';
import { flameDays, flameTier, reachedMilestone } from '@/lib/streak';
import { celebrationLine, goalsFor, type MarkCelebrated, nudgeFor } from '@/lib/board-goals';
import {
  type AskFor,
  askLine,
  askState,
  type AskState,
  type CancelAsk,
  REQUEST_WORDS,
} from '@/lib/shop';
import type { BoardMember, BoardRequest, BoardShopItem, BoardSnapshot } from '@/lib/snapshot';
import {
  boardActivity,
  defaultDoers,
  isOpen,
  itemsFor,
  optimistic,
  pickerOrder,
  pointsHeld,
  progress,
  sections,
  tileView,
  type TodayItem,
  undoUntil,
} from '@/lib/today';
import { type PinWish, wishLine } from '@/lib/wishes';
import { eventsOn, eventWhen } from '@/lib/board-calendar';
import { effectiveLayout } from '@/lib/board-layout';
import { calendarDay, clock, DAY_PART_LABELS, dayPart } from '@/lib/chores';
import { type Chip, CHIP_WORDS, familyList, type ListRow } from '@/lib/dashboard';
import { CalendarScreen, type LoadCalendar } from './calendar-ui';
import { Dashboard } from './dashboard';
import { Celebration, FamilyGoals, GoalsCard, useCelebrations } from './goals-ui';
import { iconOf, type PhotoUrl } from './picture';
import { RequestsCard, ShopDialog, useShop } from './shop-ui';
import { useOnline } from './use-online';

/** A tap within this long of the last one on the same tile is the same tap (NFR-03). */
const DEBOUNCE_MS = 500;
/** Any screen goes back to the dashboard, scrolled to the top, after this long untouched (BRD-06). */
const IDLE_MS = 90_000;
/** How long "Tap again to undo" waits for the second tap. */
const ARM_MS = 4_000;
/** How long a notice stays. */
const NOTICE_MS = 6_000;
/** How long a check-off celebrates (06 §6: about 600 ms for the pop and the count). */
const CELEBRATE_MS = 1_400;

/** What this board did to an item that the snapshot may not show yet. */
interface Override {
  status: TodayItem['status'];
  doneBy: string[];
  rewarded: string[];
  checkedAt: string | null;
  /** When the database wrote what it answered (its clock); null until answered. */
  serverAt: string | null;
}

/** The household's time of day as HH:MM, to compare with due times. */
function localTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The outbox's state, for the board's offline line and provisional points. */
export interface QueueState {
  pending: number;
  /** A send failed and waits to be retried: the board is offline. */
  waiting: boolean;
}

/**
 * [CHR-04][NFR-03][US-304][US-305] Today's items with this board's own check-offs and undos laid
 * over the snapshot until the snapshot shows them, so a tap answers at once (06: 120 ms) and the
 * next read replaces it. Events go out through the outbox with ids made here, so a double tap or a
 * resend counts once. [DEV-06][NFR-01] With a store, both outlast a reload: what this board did
 * shows again at once, and what it had not sent goes first (WP-13).
 */
function useToday(
  snapshot: BoardSnapshot,
  post: Post,
  store: BoardStore | null,
  onQueue?: (q: QueueState) => void,
) {
  const [overrides, setOverrides] = useState<Map<string, Override>>(() => new Map());
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueState>({ pending: 0, waiting: false });
  // Saved overrides are read back before any are written, so a reload can't overwrite them.
  const [restored, setRestored] = useState(!store);
  const lastTap = useRef(new Map<string, number>());
  const outbox = useRef<Outbox | null>(null);

  const say = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const onAnswer = useCallback(
    (a: Answer, event: CompletionEvent | undefined) => {
      const itemId = a.occurrence?.id ?? event?.occurrence_id;
      if (!itemId) return;
      if (a.result === 'recorded' || a.result === 'duplicate') {
        const o = a.occurrence;
        setOverrides((prev) => {
          const was = prev.get(itemId);
          if (!was || !o) return prev;
          const next = new Map(prev);
          next.set(itemId, {
            status: o.status,
            doneBy: [...o.done_by].sort(),
            rewarded: [...o.rewarded].sort(),
            checkedAt: was.checkedAt,
            serverAt: o.status_changed_at ?? new Date().toISOString(),
          });
          return next;
        });
        return;
      }
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
      if (a.result === 'gone') {
        setGone((prev) => new Set(prev).add(itemId));
        say('That one changed. A parent took it off today.');
      } else if (a.reason === 'undo_window_passed') {
        say('Too late to undo here. Ask a parent.');
      } else if (a.result === 'refused') {
        say('Ask a parent for that one.');
      } else {
        say('That didn’t save. Try again.');
      }
    },
    [say],
  );

  useEffect(() => {
    const box = createOutbox(post, onAnswer, {
      store: store?.outbox,
      // [NFR-01] Nothing is sent while the browser says it is offline (D-64).
      isOnline: () => navigator.onLine,
      // A retry that fails again changes nothing, so it renders nothing (a day offline is 2,880).
      onChange: () =>
        setQueue((q) =>
          q.pending === box.pending() && q.waiting === box.waiting()
            ? q
            : { pending: box.pending(), waiting: box.waiting() },
        ),
    });
    outbox.current = box;
    // The network is back: send what waits now rather than at the next retry.
    const online = () => box.retry();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      box.stop();
    };
  }, [post, onAnswer, store]);

  useEffect(() => {
    onQueue?.(queue);
  }, [queue, onQueue]);

  // What this board showed ahead of the snapshot before a reload shows again: an answered one until
  // the snapshot shows it, an unanswered one while its event still waits in the outbox.
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void Promise.all([store.get<[string, Override][]>('overrides'), store.outbox.load()]).then(
      ([saved, waiting]) => {
        if (cancelled) return;
        const queued = new Set(waiting.map((e) => e.occurrence_id));
        const kept = Array.isArray(saved)
          ? saved.filter(([id, o]) => o.serverAt !== null || queued.has(id))
          : [];
        if (kept.length > 0) setOverrides((prev) => new Map([...kept, ...prev]));
        setRestored(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);
  useEffect(() => {
    if (store && restored) void store.set('overrides', [...overrides]);
  }, [store, restored, overrides]);

  // A snapshot read after the database wrote an answer shows it, so that override has done its job:
  // it no longer applies, and the next change of overrides drops it.
  const fetchedAt = snapshot.fetchedAt;
  const live = useCallback(
    (o: Override | undefined) => (o && !(o.serverAt && fetchedAt >= o.serverAt) ? o : undefined),
    [fetchedAt],
  );
  const prune = useCallback(
    (prev: Map<string, Override>) => new Map([...prev].filter(([, o]) => live(o))),
    [live],
  );

  const items = useMemo(
    () =>
      snapshot.occurrences
        .filter((i) => !gone.has(i.id))
        .map((i) => {
          const o = live(overrides.get(i.id));
          return o ? { ...i, ...o } : i;
        }),
    [snapshot.occurrences, overrides, gone, live],
  );

  const earns = useCallback(
    (id: string) => snapshot.members.some((m) => m.id === id && m.earnsRewards),
    [snapshot.members],
  );

  /** Each member's balance as the board shows it: the snapshot's, plus what it has not caught up on. */
  const balance = useCallback(
    (member: BoardMember): number => {
      const base = member.points?.balance ?? 0;
      let delta = 0;
      for (const i of items) {
        const before = snapshot.occurrences.find((s) => s.id === i.id);
        if (before && before !== i)
          delta += pointsHeld(i, member.id) - pointsHeld(before, member.id);
      }
      return base + delta;
    },
    [items, snapshot.occurrences],
  );

  /**
   * [NFR-01] A balance that counts a check-off the database hasn't answered while the board is
   * offline: shown as provisional (01 §7), since the ledger decides on reconnect.
   */
  const provisional = useCallback(
    (member: BoardMember): boolean =>
      queue.waiting &&
      items.some((i) => {
        const o = overrides.get(i.id);
        const before = snapshot.occurrences.find((s) => s.id === i.id);
        return (
          o !== undefined &&
          o.serverAt === null &&
          before !== undefined &&
          pointsHeld(i, member.id) !== pointsHeld(before, member.id)
        );
      }),
    [queue.waiting, items, overrides, snapshot.occurrences],
  );

  const send = useCallback((event: Omit<CompletionEvent, 'id' | 'occurred_at'>) => {
    outbox.current?.send({
      ...event,
      id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
    });
  }, []);

  /** [CHR-04] One tap checks it off for these people; a second tap on a done tile does nothing. */
  const checkOff = useCallback(
    (item: TodayItem, doneBy: string[]) => {
      const at = Date.now();
      if (at - (lastTap.current.get(item.id) ?? 0) < DEBOUNCE_MS) return;
      lastTap.current.set(item.id, at);
      if (!isOpen(item) || doneBy.length === 0) return;
      const next = optimistic(item, doneBy, earns);
      setOverrides((prev) =>
        prune(prev).set(item.id, {
          ...next,
          checkedAt: new Date(at).toISOString(),
          serverAt: null,
        }),
      );
      if (next.status === 'completed' && next.rewarded.length > 0 && item.points > 0) {
        setCelebrating(item.id);
      }
      send({ occurrence_id: item.id, event_type: 'complete', done_by: next.doneBy });
    },
    [earns, send, prune],
  );

  /** [US-305] Puts it back: a compensating undo event (D-46). */
  const undo = useCallback(
    (item: TodayItem) => {
      setOverrides((prev) =>
        prune(prev).set(item.id, {
          status: 'scheduled',
          doneBy: [],
          rewarded: [],
          checkedAt: null,
          serverAt: null,
        }),
      );
      setCelebrating((c) => (c === item.id ? null : c));
      send({ occurrence_id: item.id, event_type: 'undo' });
    },
    [send, prune],
  );

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(null), CELEBRATE_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  return { items, balance, provisional, earns, checkOff, undo, notice, say, celebrating };
}

/** Ticks every second while `active`, for undo buttons that close on time. */
function useSecond(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** [RWD-08] A balance that counts up to its new value (06 §6, about 600 ms; at once with reduced motion). */
function CountingChip({ points, provisional }: { points: number; provisional: boolean }) {
  const [shown, setShown] = useState(points);
  const from = useRef(points);
  useEffect(() => {
    if (prefersReducedMotion() || from.current === points) {
      from.current = points;
      setShown(points);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 600);
      setShown(Math.round(a + (points - a) * k));
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = points;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = points;
    };
  }, [points]);
  return (
    <span
      className={`fw-today__balance${provisional ? ' fw-today__balance--provisional' : ''}`}
      data-balance={points}
      data-provisional={provisional || undefined}
    >
      <PointsChip points={shown} />
      {provisional ? (
        <>
          <Icon name="wifi-off" size={28} className="fw-today__balance-mark" />
          <span className="fw-visually-hidden">Not saved yet</span>
        </>
      ) : null}
    </span>
  );
}

const FLAME_SIZE = [36, 40, 48, 52, 56];

/**
 * [RWD-05][US-408] A child's run of good days, today included once it is good (WP-17): a flame and
 * the count, bigger at each milestone (3, 7, 14, 30 days). It glows once when the run reaches a
 * milestone while the board is open (06 §6), not on every load; reduced motion keeps it still.
 */
function Flame({ days }: { days: number }) {
  const [seen, setSeen] = useState(days);
  const [glow, setGlow] = useState(0);
  if (days !== seen) {
    setSeen(days);
    if (reachedMilestone(seen, days)) setGlow((g) => g + 1);
  }
  if (days < 1) return null;
  const tier = flameTier(days);
  return (
    <span
      key={glow}
      className="fw-today__flame"
      data-days={days}
      data-tier={tier}
      data-glow={glow > 0 || undefined}
    >
      <Icon name="flame" size={FLAME_SIZE[tier]} />
      <span>{days}</span>
      <span className="fw-visually-hidden">{days === 1 ? ' day' : ' days'} in a row</span>
    </span>
  );
}

interface TileProps {
  item: TodayItem;
  viewer: string;
  today: string;
  nowTime: string;
  name: (id: string) => string;
  showPoints: boolean;
  celebrate: boolean;
  undoable: boolean;
  onTap: () => void;
  onUndo: () => void;
  /** [D-66] Opens the item in full: its description, or a title too long for the tile. */
  onMore: () => void;
}

/**
 * [CHR-04][BRD-03] One item: the whole tile is the button while it can be checked off (56 px and
 * up, by touch, click or keyboard alike). Once done, a separate Undo button stays for the undo
 * window, and needs a second tap (06 §6: destructive actions confirm).
 */
function Tile({
  item,
  viewer,
  today,
  nowTime,
  name,
  showPoints,
  celebrate,
  undoable,
  onTap,
  onUndo,
  onMore,
}: TileProps) {
  const view = tileView(item, viewer, today, nowTime, name);
  const [armed, setArmed] = useState(false);
  // [D-66] Tiles are all one height: a title that doesn't fit, or a description, gets "More info".
  const box = useRef<HTMLLIElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const title = box.current?.querySelector<HTMLElement>('.fw-tile__title');
    if (title) setClipped(title.scrollHeight > title.clientHeight + 1);
  }, [item.title]);
  const more = Boolean(item.description) || clipped;
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <li
      ref={box}
      className={`fw-today__tile${more ? ' fw-today__tile--more' : ''}`}
      data-celebrate={celebrate || undefined}
      data-item={item.id}
    >
      <ChoreTile
        title={item.title}
        icon={iconOf(item.icon)}
        status={view.status}
        display={view.display}
        doneBy={view.doneBy}
        coveredBy={view.coveredBy}
        points={showPoints ? item.points || undefined : undefined}
        headingLevel={4}
      />
      {isOpen(item) ? (
        <button
          type="button"
          className="fw-today__hit"
          aria-label={`Check off ${item.title}`}
          onClick={onTap}
        />
      ) : null}
      {more ? (
        <button
          type="button"
          className="fw-info-btn fw-today__more"
          aria-label={`More info about ${item.title}`}
          onClick={onMore}
        >
          <Icon name="info" size={36} />
        </button>
      ) : null}
      {undoable ? (
        <Button
          variant="secondary"
          icon="undo"
          className="fw-today__undo"
          aria-label={armed ? `Tap again to undo ${item.title}` : `Undo ${item.title}`}
          onClick={() => {
            if (armed) {
              setArmed(false);
              onUndo();
            } else setArmed(true);
          }}
        >
          {armed ? 'Tap again to undo' : 'Undo'}
        </Button>
      ) : null}
    </li>
  );
}

function Parts({
  items,
  idPrefix,
  empty,
  tile,
  today,
}: {
  items: TodayItem[];
  idPrefix: string;
  empty: ReactNode;
  tile: (i: TodayItem) => ReactNode;
  today: string;
}) {
  const parts = sections(items, today);
  if (parts.length === 0) return <p className="fw-today__empty">{empty}</p>;
  return (
    <>
      {parts.map((p) => (
        <section key={p.key} className="fw-today__part" aria-labelledby={`${idPrefix}-${p.key}`}>
          <h3 id={`${idPrefix}-${p.key}`} className="fw-today__part-title">
            {p.label}
          </h3>
          <ul className="fw-today__tiles" aria-labelledby={`${idPrefix}-${p.key}`}>
            {p.items.map(tile)}
          </ul>
        </section>
      ))}
    </>
  );
}

/** [BRD-07][US-1006] Who did it, for a shared item in the Family view: its people first, several allowed. */
function WhoDidIt({
  item,
  members,
  initial,
  onDone,
  onCancel,
}: {
  item: TodayItem;
  members: BoardMember[];
  initial: string[];
  onDone: (doneBy: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel]);
  return (
    <div className="fw-today__scrim">
      <div className="fw-today__picker" role="dialog" aria-modal="true" aria-labelledby="who-title">
        <h2 id="who-title">Who did {item.title}?</h2>
        <ul className="fw-today__people fw-today__people--picker" aria-label="People">
          {pickerOrder(item, members).map((m, n) => {
            const on = picked.includes(m.id);
            return (
              <li key={m.id}>
                <button
                  ref={n === 0 ? first : undefined}
                  type="button"
                  className="fw-today__person"
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                  }
                >
                  <Avatar
                    name={m.displayName}
                    avatarKey={m.avatarKey}
                    color={m.color}
                    size={96}
                    decorative
                  />
                  <span>{m.displayName}</span>
                  {on ? <Icon name="check-circle" size={36} className="fw-today__picked" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="fw-today__picker-actions">
          <Button icon="check" disabled={picked.length === 0} onClick={() => onDone(picked)}>
            Done
          </Button>
          <Button variant="ghost" icon="close" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * [D-66] An item in full, from a row's or a tile's "More info": its description, when it's due, its
 * points, and how it stands for each person. Read only; it closes with Close, Escape or idle.
 */
function ItemDetails({
  row,
  members,
  today,
  onClose,
}: {
  row: ListRow;
  members: BoardMember[];
  today: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.fw-details__close')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const people = new Map(members.map((m) => [m.id, m]));
  const when =
    row.dueDate < today
      ? `Overdue since ${calendarDay(row.dueDate)}`
      : row.dueTime
        ? `By ${clock(row.dueTime)} (${DAY_PART_LABELS[dayPart(row.dueTime)].toLowerCase()})`
        : DAY_PART_LABELS.anytime;
  return (
    <div className="fw-today__scrim">
      <div
        ref={box}
        className="fw-today__picker fw-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="details-title"
      >
        <header className="fw-details__head">
          <Icon name={iconOf(row.icon)} size={64} />
          <h2 id="details-title">{row.title}</h2>
        </header>
        {row.description ? <p className="fw-details__text">{row.description}</p> : null}
        <dl className="fw-details__facts">
          <dt>When</dt>
          <dd>{when}</dd>
          {row.points ? (
            <>
              <dt>Points</dt>
              <dd>
                <PointsChip points={row.points} signed />
              </dd>
            </>
          ) : null}
          <dt>Who</dt>
          <dd>
            <ul className="fw-details__who">
              {row.chips.map((c) => {
                const m = c.memberId ? people.get(c.memberId) : undefined;
                return (
                  <li key={`${c.item.id}:${c.memberId ?? 'anyone'}`}>
                    {m ? (
                      <Avatar
                        name={m.displayName}
                        avatarKey={m.avatarKey}
                        color={m.color}
                        size={56}
                        decorative
                      />
                    ) : (
                      <Icon name="family" size={56} />
                    )}
                    <span>
                      {m?.displayName ?? 'Anyone'}: {CHIP_WORDS[c.state]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </dd>
        </dl>
        <div className="fw-today__picker-actions">
          <Button variant="secondary" icon="close" className="fw-details__close" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * [PTS-06][US-1108] What a child is saving for (WP-30): the reward they pinned and a meter of their
 * balance against its cost, and when they have enough, a nudge to ask for it. Choosing needs the
 * network (a wish isn't queued like a check-off).
 */
function WishCard({
  wish,
  balance,
  shopOpen,
  online,
  ask,
  onChoose,
  onAsk,
}: {
  wish: BoardShopItem | null;
  /** What they can spend: their balance less what they have asked for (WP-20). */
  balance: number;
  shopOpen: boolean;
  online: boolean;
  /** [PTS-04] Whether the wish can be asked for now, and a request for it already open (WP-20). */
  ask: { state: AskState; open: BoardRequest | null } | null;
  onChoose: () => void;
  onAsk: () => void;
}) {
  const enough = wish ? balance >= wish.cost : false;
  // Why it can't be asked for, when that isn't the points the meter already counts.
  const why = ask && !ask.state.can && ask.state.why !== 'points' ? askLine(ask.state) : null;
  return (
    <section className="fw-today__card fw-today__wish" aria-labelledby="me-wish">
      <h3 id="me-wish">Saving for</h3>
      {wish ? (
        <>
          <p className="fw-today__wish-item">
            <Icon name={iconOf(wish.icon)} size={40} />
            <span>{wish.title}</span>
          </p>
          <GoalMeter
            label="Saved"
            value={Math.min(Math.max(balance, 0), wish.cost)}
            target={wish.cost}
          />
          <p className="fw-today__wish-line" data-enough={enough || undefined}>
            {enough ? <Icon name="sparkles" size={28} /> : null}
            <span>{wishLine(balance, wish.cost)}</span>
          </p>
          {ask?.open ? (
            <p className="fw-today__wish-asked" data-status={ask.open.status}>
              Asked: {REQUEST_WORDS[ask.open.status]}
            </p>
          ) : ask?.state.can ? (
            <Button icon="gift" onClick={onAsk}>
              Ask for it
            </Button>
          ) : enough && why ? (
            <p className="fw-today__muted">{why}</p>
          ) : null}
        </>
      ) : (
        <p className="fw-today__muted">
          {shopOpen ? 'Pick a reward from the shop to save up for.' : 'Nothing in the shop yet.'}
        </p>
      )}
      {shopOpen ? (
        <Button
          variant={wish ? 'secondary' : 'primary'}
          icon={wish ? 'edit' : 'gift'}
          disabled={!online}
          onClick={onChoose}
        >
          {wish ? 'Change' : 'Choose a wish'}
        </Button>
      ) : null}
      {shopOpen && !online ? (
        <p className="fw-today__muted">Choosing a wish needs the internet.</p>
      ) : null}
    </section>
  );
}

/** [PTS-06] The shop's rewards to save for, the one pinned now pressed, and "No wish". */
function WishPicker({
  member,
  shop,
  current,
  onPick,
  onCancel,
}: {
  member: BoardMember;
  shop: BoardShopItem[];
  current: string | null;
  onPick: (itemId: string | null) => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  // Focus goes in once, when it opens; the board redrawing (each minute, each snapshot) leaves it be.
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel]);
  return (
    <div className="fw-today__scrim">
      <div
        className="fw-today__picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wish-title"
      >
        <h2 id="wish-title">What is {member.displayName} saving for?</h2>
        <ul className="fw-today__wishes" aria-label="Rewards">
          {shop.map((i, n) => (
            <li key={i.id}>
              <button
                ref={n === 0 ? first : undefined}
                type="button"
                className="fw-today__wish-option"
                aria-pressed={current === i.id}
                onClick={() => onPick(i.id)}
              >
                <Icon name={iconOf(i.icon)} size={48} />
                <span className="fw-today__wish-title">{i.title}</span>
                <PointsChip points={i.cost} />
                {current === i.id ? (
                  <Icon name="check-circle" size={36} className="fw-today__picked" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="fw-today__picker-actions">
          {current ? (
            <Button variant="secondary" icon="minus-circle" onClick={() => onPick(null)}>
              No wish
            </Button>
          ) : null}
          <Button variant="ghost" icon="close" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * [PTS-06] Each child's wish with this board's own choice laid over the snapshot until the
 * snapshot shows it, so a pick answers at once; a pick the server didn't take is put back.
 */
function useWishes(snapshot: BoardSnapshot, pinWish: PinWish, say: (text: string) => void) {
  const [chosen, setChosen] = useState<Map<string, BoardShopItem | null>>(() => new Map());
  // What the snapshot shows now wins: a choice it already shows is no longer needed.
  const shown = useMemo(
    () => new Map(snapshot.members.map((m) => [m.id, m.wish?.id ?? null])),
    [snapshot.members],
  );
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setChosen((prev) => {
      const next = new Map([...prev].filter(([id, w]) => (w?.id ?? null) !== shown.get(id)));
      return next.size === prev.size ? prev : next;
    });
  }
  const wishOf = useCallback(
    (m: BoardMember) => (chosen.has(m.id) ? (chosen.get(m.id) ?? null) : m.wish),
    [chosen],
  );
  const pick = useCallback(
    (m: BoardMember, itemId: string | null) => {
      const item = itemId ? (snapshot.shop.find((i) => i.id === itemId) ?? null) : null;
      const before = chosen.has(m.id) ? (chosen.get(m.id) ?? null) : m.wish;
      setChosen((prev) => new Map(prev).set(m.id, item));
      void pinWish(m.id, itemId).then((answer) => {
        if (answer === 'saved') return;
        setChosen((prev) => new Map(prev).set(m.id, before));
        say(
          answer === 'refused' ? 'That one isn’t in the shop now.' : 'That didn’t save. Try again.',
        );
      });
    },
    [snapshot.shop, chosen, pinWish, say],
  );
  return { wishOf, pick };
}

/** Without a server to ask (a board that can't pin), a wish never saves. */
const noPin: PinWish = async () => 'offline';
/** Without a server to ask (a board that can't ask), nothing is sent. */
const noAsk: AskFor = async () => ({ ok: false, offline: true });
const noCancel: CancelAsk = async () => ({ ok: false, offline: true });
const noMark: MarkCelebrated = async () => false;

/**
 * [BRD-01][BRD-02][BRD-05][BRD-07][PTS-02][PTS-04][RWD-07][RWD-08] The board: its home is the family
 * dashboard (WP-35, D-66) laid out as the household or this board says (D-67). A person's own screen
 * has their day with their points, the shop, what they've asked for, what they're saving for and
 * their goals; Chores has everyone's day in a column each; Calendar opens on the week, or on a day
 * tapped on the dashboard. Every screen goes back to the dashboard after a while untouched. A reached
 * goal is celebrated once, whoever is showing.
 */
export function Today({
  snapshot,
  now,
  post,
  store = null,
  onQueue,
  pinWish = noPin,
  ask = noAsk,
  cancelAsk = noCancel,
  markCelebrated = noMark,
  photoUrl,
  loadCalendar,
}: {
  snapshot: BoardSnapshot;
  /** The current minute. */
  now: Date;
  post: Post;
  /** [PTS-06] Pins the reward a child is saving for (POST /api/wishes on a board). */
  pinWish?: PinWish;
  /** [PTS-04] Asks for a reward, and calls a request off (POST /api/redemptions[/cancel]). */
  ask?: AskFor;
  cancelAsk?: CancelAsk;
  /** [RWD-08] Says a reached goal has been celebrated (POST /api/goals/celebrated). */
  markCelebrated?: MarkCelebrated;
  /** [PTS-03] Signed links to reward and goal photos; without them, icons. */
  photoUrl?: PhotoUrl;
  /** [CAL-04] Reads a range of the calendar the snapshot doesn't hold (WP-23). */
  loadCalendar?: LoadCalendar;
  /** [DEV-06] Where the outbox and what the board shows ahead of the snapshot outlast a reload. */
  store?: BoardStore | null;
  onQueue?: (q: QueueState) => void;
}) {
  const t = useToday(snapshot, post, store, onQueue);
  const w = useWishes(snapshot, pinWish, t.say);
  const shop = useShop(snapshot, ask, cancelAsk, t.say);
  const party = useCelebrations(snapshot.goals, markCelebrated);
  const online = useOnline();
  const { members, household, today } = snapshot;
  // 'home' (the dashboard), 'chores', 'calendar', or a member's id.
  const [view, setView] = useState<string>('home');
  // [D-66] A day tapped on the dashboard opens the calendar on that day.
  const [calDay, setCalDay] = useState<string | null>(null);
  const [details, setDetails] = useState<ListRow | null>(null);
  const layout = effectiveLayout(snapshot.layout.household, snapshot.layout.board);
  const [picker, setPicker] = useState<{ item: TodayItem; initial: string[] } | null>(null);
  // Whose wish is being chosen: the picker closes with the person's screen.
  const [wishing, setWishing] = useState<string | null>(null);
  // Whose shop is open, and a reward to ask about straight away.
  const [shopping, setShopping] = useState<{ member: string; item: string | null } | null>(null);
  const nowTime = localTime(now, household.timezone);
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members]);
  const name = useCallback((id: string) => names.get(id) ?? 'someone', [names]);
  const windowSeconds = household.undoWindowSeconds;
  // The minute clock is enough to know an undo button is showing; then it ticks by the second.
  const anyUndoable = t.items.some((i) => (undoUntil(i, windowSeconds) ?? 0) > now.getTime());
  const second = useSecond(anyUndoable);
  const member = members.find((m) => m.id === view) ?? null;
  const familyGoals = useMemo(
    () => snapshot.goals.filter((g) => g.memberId === null),
    [snapshot.goals],
  );
  /**
   * [PTS-04] What a child can spend now: the balance as shown (with this board's own check-offs)
   * less what they have asked for, this board's asks the snapshot doesn't show yet included.
   */
  const spendable = useCallback(
    (m: BoardMember) => t.balance(m) - (m.points?.balance ?? 0) + shop.availableOf(m),
    [t, shop],
  );

  // Back to everyone after a while untouched, so the next person finds the whole family.
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      setView('home');
      setCalDay(null);
      setDetails(null);
      setWishing(null);
      setShopping(null);
      // [D-66] The dashboard scrolls; untouched, it goes back to the top.
      window.scrollTo({ top: 0 });
    }, IDLE_MS);
  }, []);
  useEffect(() => () => (idle.current ? clearTimeout(idle.current) : undefined), []);
  const celebrating = party.current;
  const endCelebration = useCallback(() => {
    if (celebrating) party.finish(celebrating);
  }, [celebrating, party]);

  const tile = (i: TodayItem, viewer: string, mode: 'member' | 'family') => (
    <Tile
      key={`${viewer}:${i.id}`}
      item={i}
      viewer={viewer}
      today={today}
      nowTime={nowTime}
      name={name}
      // Points still to earn, or earned by this person; not someone else's (D-32).
      showPoints={t.earns(viewer) && (isOpen(i) || i.rewarded.includes(viewer))}
      celebrate={t.celebrating === i.id}
      undoable={(undoUntil(i, windowSeconds) ?? 0) > second}
      onTap={() => {
        const doers = defaultDoers(i, mode, viewer);
        if (doers) t.checkOff(i, doers);
        else setPicker({ item: i, initial: i.assignees.includes(viewer) ? [viewer] : [] });
      }}
      onUndo={() => t.undo(i)}
      onMore={() => {
        const row = familyList([i], members, today, nowTime)[0]?.rows[0];
        if (row) setDetails(row);
      }}
    />
  );
  const canUndo = (i: TodayItem) => (undoUntil(i, windowSeconds) ?? 0) > second;
  const open = (next: string) => {
    setView(next);
    setCalDay(null);
    window.scrollTo({ top: 0 });
  };

  const shopFor = member && shopping?.member === member.id ? member : null;

  return (
    <div className="fw-today" onPointerDown={touched} onKeyDown={touched}>
      <ul className="fw-today__people" aria-label="Family">
        <li>
          <button
            type="button"
            className="fw-today__person fw-today__person--all"
            aria-pressed={view === 'home'}
            onClick={() => open('home')}
          >
            <Icon name="home" size={64} />
            <span>Home</span>
          </button>
        </li>
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="fw-today__person"
              aria-pressed={view === m.id}
              onClick={() => open(m.id)}
            >
              <Avatar
                name={m.displayName}
                avatarKey={m.avatarKey}
                color={m.color}
                size={64}
                decorative
              />
              <span className="fw-today__person-name">{m.displayName}</span>
              {/* [PTS-02][D-66] Each balance in the top bar, in sight while the dashboard scrolls. */}
              {m.points ? (
                <span
                  className="fw-today__pill-balance"
                  data-pill-balance={t.balance(m)}
                  aria-hidden
                >
                  <PointsChip points={t.balance(m)} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {/* [BRD-07][D-66] Everyone's day in a column each. */}
        <li>
          <button
            type="button"
            className="fw-today__person fw-today__person--all"
            aria-pressed={view === 'chores'}
            onClick={() => open('chores')}
          >
            <Icon name="list-check" size={64} />
            <span>Chores</span>
          </button>
        </li>
        {/* [CAL-04] The family's calendar (WP-23). */}
        <li>
          <button
            type="button"
            className="fw-today__person fw-today__person--all"
            aria-pressed={view === 'calendar'}
            onClick={() => open('calendar')}
          >
            <Icon name="calendar" size={64} />
            <span>Calendar</span>
          </button>
        </li>
      </ul>

      <div className="fw-today__notice" aria-live="polite">
        {t.notice ? (
          <p className="fw-banner fw-banner--notice">
            <Icon name="info" className="fw-banner__icon" />
            <span>{t.notice}</span>
          </p>
        ) : null}
      </div>

      {member ? (
        <section className="fw-today__me" aria-labelledby="me-name">
          <header className="fw-today__me-head">
            <Avatar
              name={member.displayName}
              avatarKey={member.avatarKey}
              color={member.color}
              size={96}
              decorative
            />
            <div>
              <h2 id="me-name">{member.displayName}</h2>
              <p className="fw-today__progress">
                {(() => {
                  const p = progress(itemsFor(t.items, member.id));
                  return p.total ? `${p.done} of ${p.total} done` : 'Nothing on the list today';
                })()}
              </p>
              {(() => {
                const line = member.earnsRewards ? nudgeFor(snapshot.goals, member.id) : null;
                return line ? (
                  <p className="fw-today__nudge">
                    <Icon name="target" size={32} />
                    <span>{line}</span>
                  </p>
                ) : null;
              })()}
            </div>
            {member.streak ? (
              <Flame days={flameDays(member.streak, t.items, member.id, today)} />
            ) : null}
            {member.points ? (
              <CountingChip points={t.balance(member)} provisional={t.provisional(member)} />
            ) : null}
          </header>
          <div className="fw-today__me-body">
            <div className="fw-today__list">
              <Parts
                items={itemsFor(t.items, member.id)}
                idPrefix="me"
                today={today}
                empty="Nothing on the list today."
                tile={(i) => tile(i, member.id, 'member')}
              />
              {(() => {
                const p = progress(itemsFor(t.items, member.id));
                return p.total > 0 && p.done === p.total ? (
                  <p className="fw-today__empty">All done today. Nice work!</p>
                ) : null;
              })()}
            </div>
            <aside className="fw-today__side" aria-label={`More for ${member.displayName}`}>
              {member.points ? (
                <section className="fw-today__card" aria-labelledby="me-points">
                  <div className="fw-today__card-head">
                    <h3 id="me-points">Points</h3>
                    {snapshot.shop.length > 0 ? (
                      <Button
                        variant="secondary"
                        icon="gift"
                        onClick={() => setShopping({ member: member.id, item: null })}
                      >
                        Shop
                      </Button>
                    ) : null}
                  </div>
                  {(() => {
                    const held = t.balance(member) - spendable(member);
                    return held > 0 ? (
                      <p className="fw-today__spend" data-available={spendable(member)}>
                        {Math.max(0, spendable(member))} to spend · {held} waiting for a grown-up
                      </p>
                    ) : null;
                  })()}
                  {member.points.recent.length === 0 ? (
                    <p className="fw-today__muted">Points arrive as chores get done.</p>
                  ) : (
                    <ul className="fw-today__activity" aria-labelledby="me-points">
                      {member.points.recent.map((e) => (
                        <li key={e.id}>
                          <span>{boardActivity(e)}</span>
                          <strong>{signed(e.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
              {member.earnsRewards ? (
                <RequestsCard
                  requests={shop.requestsOf(member)}
                  sending={shop.sending}
                  cancelling={shop.cancelling}
                  online={online}
                  onCancel={shop.cancel}
                />
              ) : null}
              {member.earnsRewards
                ? (() => {
                    const wish = w.wishOf(member);
                    const item = wish
                      ? (snapshot.shop.find((i) => i.id === wish.id) ?? wish)
                      : null;
                    const open = item
                      ? (shop
                          .requestsOf(member)
                          .find(
                            (r) =>
                              r.itemId === item.id &&
                              (r.status === 'requested' || r.status === 'approved'),
                          ) ?? null)
                      : null;
                    return (
                      <WishCard
                        wish={wish}
                        balance={spendable(member)}
                        shopOpen={snapshot.shop.length > 0}
                        online={online}
                        ask={
                          item
                            ? {
                                state: askState(
                                  item,
                                  { available: spendable(member), limited: member.limited },
                                  online,
                                ),
                                open,
                              }
                            : null
                        }
                        onChoose={() => setWishing(member.id)}
                        onAsk={() => item && setShopping({ member: member.id, item: item.id })}
                      />
                    );
                  })()
                : null}
              {member.earnsRewards ? (
                <GoalsCard
                  goals={goalsFor(snapshot.goals, member.id)}
                  today={today}
                  photoUrl={photoUrl}
                />
              ) : null}
              {(() => {
                // [CAL-04] Today's events: this person's calendars and the whole family's (WP-23).
                const cal = snapshot.calendar;
                const theirs = new Map(
                  (cal?.calendars ?? [])
                    .filter((c) => c.memberId === null || c.memberId === member.id)
                    .map((c) => [c.id, c]),
                );
                const list = eventsOn(
                  (cal?.events ?? []).filter((e) => theirs.has(e.calendarId)),
                  today,
                );
                return list.length ? (
                  <section className="fw-today__card" aria-labelledby="me-events">
                    <h3 id="me-events">Today</h3>
                    <ol className="fw-bcal__list">
                      {list.map((e) => (
                        <li
                          key={e.id}
                          className="fw-bcal__event"
                          style={{
                            ['--cal' as string]: `var(--${theirs.get(e.calendarId)?.color ?? 'member-6'}-line)`,
                          }}
                        >
                          <span className="fw-bcal__when">
                            {eventWhen(e, today, household.timezone)}
                          </span>
                          <span className="fw-bcal__title">{e.title || 'Untitled event'}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null;
              })()}
              {/* Kept for a later work package: meals (WP-28). The streak flame (WP-17) is beside
                  the name. */}
            </aside>
          </div>
        </section>
      ) : view === 'calendar' ? (
        <CalendarScreen
          key={calDay ?? 'week'}
          snapshot={snapshot}
          now={now}
          load={loadCalendar}
          initialView={calDay ? 'day' : 'week'}
          initialDate={calDay ?? undefined}
        />
      ) : view === 'home' ? (
        <Dashboard
          snapshot={snapshot}
          items={t.items}
          layout={layout}
          nowTime={nowTime}
          load={loadCalendar}
          photoUrl={photoUrl}
          canUndo={canUndo}
          celebrating={t.celebrating}
          onCheck={(c: Chip) => {
            if (c.memberId) t.checkOff(c.item, [c.memberId]);
            else setPicker({ item: c.item, initial: [] });
          }}
          onUndo={(i) => t.undo(i)}
          onMore={setDetails}
          onOpenDay={(d) => {
            setCalDay(d);
            setView('calendar');
            window.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <>
          <div className="fw-today__family" role="region" aria-label="Everyone today">
            {members.map((m) => {
              const mine = itemsFor(t.items, m.id);
              const nudge = m.earnsRewards ? nudgeFor(snapshot.goals, m.id, { own: true }) : null;
              return (
                <section key={m.id} className="fw-today__col" aria-labelledby={`col-${m.id}`}>
                  <header className="fw-today__col-head">
                    <Avatar
                      name={m.displayName}
                      avatarKey={m.avatarKey}
                      color={m.color}
                      size={64}
                      decorative
                    />
                    <h2 id={`col-${m.id}`}>{m.displayName}</h2>
                    {m.streak ? <Flame days={flameDays(m.streak, t.items, m.id, today)} /> : null}
                    {m.points ? (
                      <CountingChip points={t.balance(m)} provisional={t.provisional(m)} />
                    ) : null}
                  </header>
                  {nudge ? (
                    <p className="fw-today__nudge fw-today__nudge--col">
                      <Icon name="target" size={28} />
                      <span>{nudge}</span>
                    </p>
                  ) : null}
                  <Parts
                    items={mine}
                    idPrefix={`col-${m.id}`}
                    today={today}
                    empty="Nothing today"
                    tile={(i) => tile(i, m.id, 'family')}
                  />
                </section>
              );
            })}
          </div>
          <FamilyGoals goals={familyGoals} today={today} photoUrl={photoUrl} />
        </>
      )}

      {member && wishing === member.id ? (
        <WishPicker
          member={member}
          shop={snapshot.shop}
          current={w.wishOf(member)?.id ?? null}
          onCancel={() => setWishing(null)}
          onPick={(itemId) => {
            w.pick(member, itemId);
            setWishing(null);
          }}
        />
      ) : null}

      {shopFor ? (
        <ShopDialog
          member={shopFor}
          shop={snapshot.shop}
          available={spendable(shopFor)}
          online={online}
          photoUrl={photoUrl}
          initial={shopping?.item ?? null}
          onClose={() => setShopping(null)}
          onAsk={(item) => {
            shop.askFor(shopFor, item);
            setShopping(null);
          }}
        />
      ) : null}

      {details ? (
        <ItemDetails
          row={details}
          members={members}
          today={today}
          onClose={() => setDetails(null)}
        />
      ) : null}

      {picker ? (
        <WhoDidIt
          item={picker.item}
          members={members}
          initial={picker.initial}
          onCancel={() => setPicker(null)}
          onDone={(doneBy) => {
            t.checkOff(picker.item, doneBy);
            setPicker(null);
          }}
        />
      ) : null}

      {celebrating ? (
        <Celebration
          key={`${celebrating.id}:${celebrating.n}`}
          goal={celebrating}
          line={celebrationLine(celebrating, name)}
          photoUrl={photoUrl}
          onDone={endCelebration}
        />
      ) : null}
    </div>
  );
}
