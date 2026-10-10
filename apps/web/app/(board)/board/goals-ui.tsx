'use client';

import { Button, GoalMeter, Icon } from '@familywise/ui';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  celebrationKey,
  endsLine,
  type MarkCelebrated,
  ruleMeter,
  ruleNote,
  toCelebrate,
} from '@/lib/board-goals';
import type { BoardGoal } from '@/lib/snapshot';
import { Picture, type PhotoUrl } from './picture';

/** How long the celebration stays without a tap. */
const CELEBRATION_MS = 10_000;

/** One goal: its meters (one per rule) and when it ends; reached, it says so. */
function GoalItem({
  goal,
  today,
  photoUrl,
  compact = false,
}: {
  goal: BoardGoal;
  today: string;
  photoUrl?: PhotoUrl;
  compact?: boolean;
}) {
  const ends = endsLine(goal.endDate, today);
  return (
    <li className="fw-today__goal" data-status={goal.status} data-goal={goal.id}>
      <p className="fw-today__goal-head">
        <Picture
          icon={goal.icon}
          photo={goal.photo}
          size={compact ? 40 : 48}
          photoUrl={photoUrl}
          fallback="trophy"
        />
        <span className="fw-today__goal-title">{goal.title}</span>
        {goal.memberId === null && !compact ? <span className="fw-pill">Family</span> : null}
      </p>
      {goal.status === 'achieved' ? (
        <p className="fw-today__goal-reached">
          <Icon name="trophy" size={28} />
          <span>Reached! A grown-up will sort out the reward.</span>
        </p>
      ) : (
        <>
          {goal.rules.length > 1 ? (
            <p className="fw-today__goal-logic">
              {goal.logic === 'all' ? 'All of these:' : 'Any one of these:'}
            </p>
          ) : null}
          {goal.rules.map((r) => {
            const m = ruleMeter(r);
            const note = ruleNote(r);
            return (
              <div key={r.id} className="fw-today__goal-rule" data-met={r.met || undefined}>
                <GoalMeter label={m.label} value={m.value} target={m.target} />
                {note ? <p className="fw-today__goal-note">{note}</p> : null}
              </div>
            );
          })}
          {ends ? <p className="fw-today__goal-ends">{ends}</p> : null}
        </>
      )}
    </li>
  );
}

/** [RWD-07][US-403] A child's goals, then the family's, each with a meter per rule. */
export function GoalsCard({
  goals,
  today,
  photoUrl,
}: {
  goals: BoardGoal[];
  today: string;
  photoUrl?: PhotoUrl;
}) {
  if (goals.length === 0) return null;
  return (
    <section className="fw-today__card fw-today__goals" aria-labelledby="me-goals">
      <h3 id="me-goals">Goals</h3>
      <ul className="fw-today__goal-list" aria-labelledby="me-goals">
        {goals.map((g) => (
          <GoalItem key={g.id} goal={g} today={today} photoUrl={photoUrl} />
        ))}
      </ul>
    </section>
  );
}

/** [RWD-07] The family's goals under everyone's day. */
export function FamilyGoals({
  goals,
  today,
  photoUrl,
}: {
  goals: BoardGoal[];
  today: string;
  photoUrl?: PhotoUrl;
}) {
  if (goals.length === 0) return null;
  return (
    <section className="fw-today__family-goals" aria-labelledby="family-goals">
      <h2 id="family-goals">
        <Icon name="target" size={36} />
        Family goals
      </h2>
      <ul className="fw-today__goal-list" aria-labelledby="family-goals">
        {goals.map((g) => (
          <GoalItem key={g.id} goal={g} today={today} photoUrl={photoUrl} compact />
        ))}
      </ul>
    </section>
  );
}

/**
 * [RWD-08][US-404] The reached goals to celebrate, one at a time. The board says it has celebrated
 * as soon as one shows, so no other board celebrates it again; if that doesn't reach the server
 * (offline), it says so again with each new snapshot that still shows the goal to celebrate.
 */
export function useCelebrations(goals: BoardGoal[], mark: MarkCelebrated) {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const queue = useMemo(() => toCelebrate(goals, done), [goals, done]);
  // The one showing stays until it is finished here: marking it makes the next snapshot say there is
  // nothing left to celebrate, and that must not cut the celebration short.
  const [showing, setShowing] = useState<BoardGoal | null>(null);
  const next = queue[0] ?? null;
  if (showing === null && next !== null) setShowing(next);
  const current = showing ?? next;
  const sending = useRef(new Set<string>());
  const send = useCallback(
    (g: BoardGoal) => {
      const key = celebrationKey(g);
      if (sending.current.has(key)) return;
      sending.current.add(key);
      void mark(g.id, g.n).finally(() => sending.current.delete(key));
    },
    [mark],
  );
  useEffect(() => {
    if (current) send(current);
  }, [current, send]);
  useEffect(() => {
    for (const g of goals) if (g.celebrate && done.has(celebrationKey(g))) send(g);
  }, [goals, done, send]);
  const finish = useCallback((g: BoardGoal) => {
    setDone((prev) => new Set(prev).add(celebrationKey(g)));
    setShowing(null);
  }, []);
  return { current, finish };
}

/** [RWD-08][US-404] A full-screen celebration; with reduced motion it is still, the words the same. */
export function Celebration({
  goal,
  line,
  photoUrl,
  onDone,
}: {
  goal: BoardGoal;
  line: string;
  photoUrl?: PhotoUrl;
  onDone: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.querySelector('button')?.focus();
    const t = setTimeout(onDone, CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className="fw-celebrate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebrate-title"
      data-goal={goal.id}
    >
      <div className="fw-celebrate__burst" aria-hidden>
        {Array.from({ length: 24 }, (_, k) => (
          <span key={k} style={{ '--k': k } as CSSProperties} />
        ))}
      </div>
      <div ref={card} className="fw-celebrate__card">
        <span className="fw-celebrate__picture">
          <Picture
            icon={goal.icon}
            photo={goal.photo}
            size={160}
            photoUrl={photoUrl}
            fallback="trophy"
          />
        </span>
        <h2 id="celebrate-title">{line}</h2>
        <p>Well done! A grown-up will sort out the reward.</p>
        <Button icon="sparkles" onClick={onDone}>
          Yay!
        </Button>
      </div>
    </div>
  );
}
