'use client';

import {
  Avatar,
  Button,
  ChoreTile,
  Icon,
  ICON_NAMES,
  PointsChip,
  type IconName,
} from '@familywise/ui';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Answer,
  type CompletionEvent,
  createOutbox,
  type Outbox,
  type Post,
} from '@/lib/outbox';
import type { BoardStore } from '@/lib/board-store';
import { signed } from '@/lib/points';
import type { BoardMember, BoardSnapshot } from '@/lib/snapshot';
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

/** A tap within this long of the last one on the same tile is the same tap (NFR-03). */
const DEBOUNCE_MS = 500;
/** A person's own screen goes back to everyone after this long untouched. */
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

const iconOf = (icon: string | null): IconName =>
  icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : 'list-check';

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

  return { items, balance, provisional, earns, checkOff, undo, notice, celebrating };
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
}: TileProps) {
  const view = tileView(item, viewer, today, nowTime, name);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <li className="fw-today__tile" data-celebrate={celebrate || undefined} data-item={item.id}>
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
 * [BRD-01][BRD-02][BRD-07][PTS-02] The board's Today: everyone's day in a column each, or one
 * person's own day with their points. Tap a person to see theirs; it goes back to everyone after a
 * while untouched. Slots for events, meals, the goal meter and the streak flame are kept for the
 * work packages that fill them.
 */
export function Today({
  snapshot,
  now,
  post,
  store = null,
  onQueue,
}: {
  snapshot: BoardSnapshot;
  /** The current minute. */
  now: Date;
  post: Post;
  /** [DEV-06] Where the outbox and what the board shows ahead of the snapshot outlast a reload. */
  store?: BoardStore | null;
  onQueue?: (q: QueueState) => void;
}) {
  const t = useToday(snapshot, post, store, onQueue);
  const { members, household, today } = snapshot;
  const [view, setView] = useState<string>('family');
  const [picker, setPicker] = useState<{ item: TodayItem; initial: string[] } | null>(null);
  const nowTime = localTime(now, household.timezone);
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members]);
  const name = useCallback((id: string) => names.get(id) ?? 'someone', [names]);
  const windowSeconds = household.undoWindowSeconds;
  // The minute clock is enough to know an undo button is showing; then it ticks by the second.
  const anyUndoable = t.items.some((i) => (undoUntil(i, windowSeconds) ?? 0) > now.getTime());
  const second = useSecond(anyUndoable);
  const member = members.find((m) => m.id === view) ?? null;

  // Back to everyone after a while untouched, so the next person finds the whole family.
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setView('family'), IDLE_MS);
  }, []);
  useEffect(() => () => (idle.current ? clearTimeout(idle.current) : undefined), []);

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
    />
  );

  return (
    <div className="fw-today" onPointerDown={touched} onKeyDown={touched}>
      <ul className="fw-today__people" aria-label="Family">
        <li>
          <button
            type="button"
            className="fw-today__person fw-today__person--all"
            aria-pressed={view === 'family'}
            onClick={() => setView('family')}
          >
            <Icon name="family" size={64} />
            <span>Everyone</span>
          </button>
        </li>
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="fw-today__person"
              aria-pressed={view === m.id}
              onClick={() => setView(m.id)}
            >
              <Avatar
                name={m.displayName}
                avatarKey={m.avatarKey}
                color={m.color}
                size={64}
                decorative
              />
              <span className="fw-today__person-name">{m.displayName}</span>
            </button>
          </li>
        ))}
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
            </div>
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
                  <h3 id="me-points">Points</h3>
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
              {/* Kept for later work packages: the goal meter (WP-20), the streak flame (WP-17),
                  today's events (WP-23) and meals (WP-28). */}
            </aside>
          </div>
        </section>
      ) : (
        <div className="fw-today__family" role="region" aria-label="Everyone today">
          {members.map((m) => {
            const mine = itemsFor(t.items, m.id);
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
                  {m.points ? (
                    <CountingChip points={t.balance(m)} provisional={t.provisional(m)} />
                  ) : null}
                </header>
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
      )}

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
    </div>
  );
}
