'use client';

import { Button, Icon, PointsChip } from '@familywise/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AskFor,
  askLine,
  askState,
  availableWith,
  type CancelAsk,
  REQUEST_WORDS,
  refusedLine,
  withAsked,
} from '@/lib/shop';
import type { BoardMember, BoardRequest, BoardShopItem, BoardSnapshot } from '@/lib/snapshot';
import { iconOf, Picture, type PhotoUrl } from './picture';

/**
 * [PTS-04][US-1104] Each child's requests with this board's own asks laid over the snapshot until the
 * snapshot shows them, so an ask answers at once; one the server didn't take is taken back and the
 * board says why. A cancel shows as under way until the snapshot shows it settled.
 */
export function useShop(
  snapshot: BoardSnapshot,
  ask: AskFor,
  cancelAsk: CancelAsk,
  say: (text: string) => void,
) {
  const [asked, setAsked] = useState<Map<string, BoardRequest[]>>(() => new Map());
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(() => new Set());
  // What the snapshot shows now: each request's status by id.
  const shown = useMemo(
    () =>
      new Map(snapshot.members.flatMap((m) => m.requests.map((r) => [r.id, r.status] as const))),
    [snapshot.members],
  );
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setAsked((prev) => {
      let changed = false;
      const next = new Map<string, BoardRequest[]>();
      for (const [member, list] of prev) {
        const keep = list.filter((r) => !shown.has(r.id));
        if (keep.length !== list.length) changed = true;
        if (keep.length) next.set(member, keep);
      }
      return changed ? next : prev;
    });
    setCancelling((prev) => {
      const still = [...prev].filter((id) => shown.get(id) === 'requested');
      return still.length === prev.size ? prev : new Set(still);
    });
  }

  const mine = useCallback((m: BoardMember) => asked.get(m.id) ?? [], [asked]);
  const requestsOf = useCallback((m: BoardMember) => withAsked(m.requests, mine(m)), [mine]);
  /** What a child can spend: as the snapshot says, less this board's asks it doesn't show yet. */
  const availableOf = useCallback((m: BoardMember) => availableWith(m, mine(m)), [mine]);
  const sending = useMemo(
    () => new Set([...asked.values()].flatMap((list) => list.map((r) => r.id))),
    [asked],
  );

  const askFor = useCallback(
    (m: BoardMember, item: BoardShopItem) => {
      // Made once per ask: sending it again is the same request (D-53).
      const id = crypto.randomUUID();
      const r: BoardRequest = {
        id,
        itemId: item.id,
        title: item.title,
        icon: item.icon,
        cost: item.cost,
        status: 'requested',
        at: new Date().toISOString(),
      };
      setAsked((prev) => new Map(prev).set(m.id, [r, ...(prev.get(m.id) ?? [])]));
      void ask(id, m.id, item.id).then((answer) => {
        if (answer.ok) {
          say(`Asked for ${item.title}. A grown-up will say yes or not this time.`);
          return;
        }
        setAsked((prev) => {
          const next = new Map(prev);
          const list = (prev.get(m.id) ?? []).filter((x) => x.id !== id);
          if (list.length) next.set(m.id, list);
          else next.delete(m.id);
          return next;
        });
        say('offline' in answer ? 'That didn’t send. Try again.' : refusedLine(answer.reason));
      });
    },
    [ask, say],
  );

  const cancel = useCallback(
    (r: BoardRequest) => {
      setCancelling((prev) => new Set(prev).add(r.id));
      void cancelAsk(r.id).then((answer) => {
        if (answer.ok) {
          say(`Called off ${r.title}. Those points are free again.`);
          return;
        }
        setCancelling((prev) => {
          const next = new Set(prev);
          next.delete(r.id);
          return next;
        });
        say('offline' in answer ? 'That didn’t send. Try again.' : refusedLine(answer.reason));
      });
    },
    [cancelAsk, say],
  );

  return { requestsOf, availableOf, sending, cancelling, askFor, cancel };
}

/**
 * [PTS-03][PTS-04][US-1104] A child's shop: each reward with its cost and what stands between them and
 * asking for it. "Ask for this" asks once more ("Yes, ask"), so a stray tap never spends anything.
 */
export function ShopDialog({
  member,
  shop,
  available,
  online,
  photoUrl,
  initial,
  onAsk,
  onClose,
}: {
  member: BoardMember;
  shop: BoardShopItem[];
  available: number;
  online: boolean;
  photoUrl?: PhotoUrl;
  /** A reward to ask about straight away (the wish card's "Ask for it"). */
  initial: string | null;
  onAsk: (item: BoardShopItem) => void;
  onClose: () => void;
}) {
  const [armed, setArmed] = useState<string | null>(initial);
  const dialog = useRef<HTMLDivElement>(null);
  // Focus goes in once, when it opens: to the question if there is one, else the first reward.
  useEffect(() => {
    const root = dialog.current;
    (
      root?.querySelector<HTMLElement>('[data-confirm] button') ?? root?.querySelector('button')
    )?.focus();
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (armed) setArmed(null);
      else onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [armed, onClose]);
  return (
    <div className="fw-today__scrim">
      <div
        ref={dialog}
        className="fw-today__picker fw-shop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-title"
      >
        <header className="fw-shop__head">
          <h2 id="shop-title">{member.displayName}’s shop</h2>
          <p className="fw-shop__spend" data-available={available}>
            <PointsChip points={available} />
            {available >= 0 ? <span>to spend</span> : null}
          </p>
        </header>
        {shop.length === 0 ? (
          <p className="fw-today__muted">Nothing in the shop yet.</p>
        ) : (
          <ul className="fw-shop__items" aria-label="Rewards">
            {shop.map((i) => {
              const state = askState(i, { available, limited: member.limited }, online);
              return (
                <li key={i.id} className="fw-shop__item" data-can={state.can || undefined}>
                  <span className="fw-shop__picture">
                    <Picture icon={i.icon} photo={i.photo} size={96} photoUrl={photoUrl} />
                  </span>
                  <span className="fw-shop__title">{i.title}</span>
                  <span className="fw-shop__facts">
                    <PointsChip points={i.cost} />
                    {i.left != null && i.left > 0 ? (
                      <span className="fw-shop__left">{i.left} left</span>
                    ) : null}
                  </span>
                  {state.can && armed === i.id ? (
                    <div
                      className="fw-shop__confirm"
                      data-confirm
                      role="group"
                      aria-label={`Ask for ${i.title}?`}
                    >
                      <p>
                        Ask for {i.title} for {i.cost} points?
                      </p>
                      <div className="fw-shop__confirm-actions">
                        <Button icon="check" onClick={() => onAsk(i)}>
                          Yes, ask
                        </Button>
                        <Button variant="ghost" icon="close" onClick={() => setArmed(null)}>
                          Not now
                        </Button>
                      </div>
                    </div>
                  ) : state.can ? (
                    <Button
                      variant="secondary"
                      icon="gift"
                      aria-label={`Ask for this: ${i.title}`}
                      onClick={() => setArmed(i.id)}
                    >
                      Ask for this
                    </Button>
                  ) : (
                    <p className="fw-shop__why" data-why={state.why}>
                      {askLine(state)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="fw-today__picker-actions">
          <Button variant="ghost" icon="close" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * [PTS-04][US-1104][US-1105] What a child has asked for: waiting (they can call it off while it waits),
 * a yes, a "not this time", given or called off; settled ones stay two days.
 */
export function RequestsCard({
  requests,
  sending,
  cancelling,
  online,
  onCancel,
}: {
  requests: BoardRequest[];
  sending: ReadonlySet<string>;
  cancelling: ReadonlySet<string>;
  online: boolean;
  onCancel: (r: BoardRequest) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="fw-today__card fw-today__asks" aria-labelledby="me-asks">
      <h3 id="me-asks">Asked for</h3>
      <ul className="fw-today__ask-list" aria-labelledby="me-asks">
        {requests.map((r) => {
          const busy = sending.has(r.id)
            ? 'Sending…'
            : cancelling.has(r.id)
              ? 'Calling off…'
              : null;
          return (
            <li
              key={r.id}
              className="fw-today__ask"
              data-status={r.status}
              data-busy={busy ? true : undefined}
            >
              <Icon name={iconOf(r.icon, 'gift')} size={40} />
              <span className="fw-today__ask-title">{r.title}</span>
              <PointsChip points={r.cost} />
              <span className="fw-today__ask-state">
                {r.status === 'approved' || r.status === 'fulfilled' ? (
                  <Icon name="sparkles" size={28} />
                ) : null}
                {busy ?? REQUEST_WORDS[r.status]}
              </span>
              {r.status === 'requested' && !busy ? (
                <Button
                  variant="ghost"
                  icon="close"
                  disabled={!online}
                  aria-label={`Call off ${r.title}`}
                  onClick={() => onCancel(r)}
                >
                  Call off
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
