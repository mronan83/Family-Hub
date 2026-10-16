'use client';

import { Avatar, Button, DayMarks, GoalMeter, Icon, PeriodMarks } from '@familywise/ui';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  celebrationKey,
  endsLine,
  type MarkCelebrated,
  ruleMeter,
  ruleNote,
  toCelebrate,
} from '@/lib/board-goals';
import {
  boardNote,
  daysNeeded,
  periodLabel,
  periodWord,
  shownDays,
  startsAgainLine,
  wonLine,
} from '@/lib/goal-periods';
import {
  type Counted,
  countedLabel,
  familyMissedLine,
  familyWonLine,
  makesLine,
} from '@/lib/goal-perfect';
import { boardSteps, lateLine, markedStep, stepChips, stepNudge } from '@/lib/goal-steps';
import type { BoardGoal, BoardGoalRule, BoardMember } from '@/lib/snapshot';
import { Picture, type PhotoUrl } from './picture';

/** [RWD-18] A goal's steps as chips, the one in reach (or reached) marked. */
function StepChips({ chips, on }: { chips: string[]; on: number | null }) {
  return (
    <ul className="fw-steps" aria-label="Steps">
      {chips.map((c, i) => (
        <li
          key={i}
          className="fw-steps__step"
          data-on={i === on || undefined}
          aria-current={i === on ? 'step' : undefined}
        >
          {c}
        </li>
      ))}
    </ul>
  );
}

/**
 * [RWD-20] Each child of an every-child goal (the approved mockup): their avatar and name, and their
 * days this period, or "Nothing due this week" (or, a goal that doesn't repeat, how far they are).
 */
function ChildRows({
  kids,
  word,
  members,
}: {
  kids: NonNullable<BoardGoal['children']>;
  word: string | null;
  members: BoardMember[];
}) {
  return (
    <ul className="fw-goal__kids" aria-label="Each child">
      {kids.map((c) => {
        const m = members.find((x) => x.id === c.memberId);
        const name = m?.displayName ?? 'Someone';
        const days = c.contributes ? shownDays(c) : [];
        return (
          <li key={c.memberId} className="fw-goal__kid" data-outcome={c.outcome}>
            <Avatar
              name={name}
              avatarKey={m?.avatarKey ?? null}
              color={m?.color}
              size={48}
              decorative
            />
            <span className="fw-goal__kid-body">
              <b>{name}</b>
              {!c.contributes ? (
                <span className="fw-today__goal-note">
                  {word ? `Nothing due this ${word}` : 'Nothing due'}
                </span>
              ) : !days.length ? (
                <span className="fw-today__goal-note">
                  {c.outcome === 'won' ? 'Made it!' : `${Math.round(c.pct)}% of the way`}
                </span>
              ) : null}
            </span>
            {days.length ? <DayMarks days={days} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * [RWD-19] A rule counting another goal's weeks (the approved mockup): "1 of 3 weeks in a row" with
 * what it pays, the counted goal's weeks, and "This week makes 2 in a row."
 */
function CountedRule({ rule: r, pays }: { rule: BoardGoalRule; pays: string | null }) {
  const source = r.source;
  if (!source || source.repeat === 'none') return null;
  const c: Counted = {
    current: r.current,
    target: r.target,
    inARow: r.inARow === true,
    best: r.best,
    met: r.met,
    repeat: source.repeat,
  };
  const makes = makesLine(c, source.history, 'board');
  return (
    <div className="fw-today__goal-rule" data-met={r.met || undefined}>
      <GoalMeter
        label={countedLabel(c, pays)}
        value={Math.min(c.current, r.target)}
        target={r.target}
      />
      {source.history.length ? (
        <PeriodMarks
          label={`${source.title}: the last ${source.history.length}`}
          periods={source.history.map((h) => ({
            key: h.start,
            outcome: h.outcome,
            label: periodLabel(h, source.repeat as 'week' | 'month' | 'term'),
          }))}
        />
      ) : null}
      {makes ? <p className="fw-today__goal-note">{makes}</p> : null}
    </div>
  );
}

/** How long the celebration stays without a tap. */
const CELEBRATION_MS = 10_000;

/** One goal: its meters (one per rule) and when it ends; reached, it says so. */
export function GoalItem({
  goal,
  today,
  photoUrl,
  compact = false,
  who,
  action,
  members = [],
}: {
  goal: BoardGoal;
  today: string;
  photoUrl?: PhotoUrl;
  compact?: boolean;
  /** [D-66] Whose goal it is, on the dashboard where everyone's show together. */
  who?: ReactNode;
  /** [D-74] A button over the whole goal, on the dashboard: it opens whose goal it is. */
  action?: ReactNode;
  /** [RWD-20] The family, for an every-child goal's children. */
  members?: BoardMember[];
}) {
  if (goal.repeat !== 'none') {
    return (
      <RepeatingGoal
        goal={goal}
        repeat={goal.repeat}
        today={today}
        photoUrl={photoUrl}
        compact={compact}
        who={who}
        action={action}
        members={members}
      />
    );
  }
  const ends = endsLine(goal.endDate, today);
  const { steps, kind } = boardSteps(goal);
  const weighted = steps.length > 0 && goal.rules.length > 1;
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
        {who}
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
              {weighted
                ? `${Math.round(goal.pct)}% of the way`
                : goal.logic === 'all'
                  ? 'All of these:'
                  : 'Any one of these:'}
            </p>
          ) : null}
          {goal.rules.map((r) => {
            if (r.type === 'PERIODS_WON') {
              return (
                <CountedRule key={r.id} rule={r} pays={goal.pays ? `${goal.pays} points` : null} />
              );
            }
            const m = ruleMeter(r);
            const note = ruleNote(r);
            return (
              <div key={r.id} className="fw-today__goal-rule" data-met={r.met || undefined}>
                <GoalMeter
                  label={weighted && r.weight ? `${m.label} · ${r.weight}%` : m.label}
                  value={m.value}
                  target={m.target}
                />
                {note ? <p className="fw-today__goal-note">{note}</p> : null}
              </div>
            );
          })}
          {steps.length ? (
            <>
              <StepChips
                chips={stepChips(steps, kind)}
                on={markedStep(kind, {
                  won: false,
                  reached: goal.step ?? null,
                  best: goal.stepBest ?? null,
                })}
              />
              {stepNudge(
                steps,
                { reached: goal.step ?? null, best: goal.stepBest ?? null },
                kind,
              ) ? (
                <p className="fw-today__goal-note">
                  {stepNudge(
                    steps,
                    { reached: goal.step ?? null, best: goal.stepBest ?? null },
                    kind,
                  )}
                </p>
              ) : null}
            </>
          ) : null}
          {goal.eachChild && goal.children?.length ? (
            <ChildRows kids={goal.children} word={null} members={members} />
          ) : null}
          {ends ? <p className="fw-today__goal-ends">{ends}</p> : null}
        </>
      )}
      {action}
    </li>
  );
}

/**
 * [RWD-15][RWD-16] A repeating goal (the approved mockup, D-123): this period's days, each a mark
 * (a day off school a dash), "3 of 4 days" with what it pays, "Today makes it!"; lost, "Missed,
 * starts again Monday, Oct 19"; won, "Won this week! 10 points."; and the last weeks as marks.
 */
function RepeatingGoal({
  goal,
  repeat,
  today,
  photoUrl,
  compact,
  who,
  action,
  members,
}: {
  goal: BoardGoal;
  repeat: 'week' | 'month' | 'term';
  today: string;
  photoUrl?: PhotoUrl;
  compact: boolean;
  who?: ReactNode;
  action?: ReactNode;
  members: BoardMember[];
}) {
  const p = goal.period;
  // [RWD-20] An every-child goal: each child's days, and who lost or won it.
  const kids = goal.eachChild && p?.children ? p.children : null;
  const name = (id: string) => members.find((m) => m.id === id)?.displayName ?? 'Someone';
  const word = periodWord(repeat);
  const days = p ? shownDays(p) : [];
  const needed = p ? daysNeeded(p) : 0;
  const note = p ? boardNote(p, today) : null;
  const won = wonLine(goal.history, repeat);
  const pays = goal.pays ? `${goal.pays} ${goal.pays === 1 ? 'point' : 'points'}` : null;
  const daysRule = goal.rules.some((r) => r.type === 'DAYS_DUE');
  // [RWD-17][RWD-18] Its steps and the first rule's time.
  const { steps, kind } = boardSteps(goal);
  const weighted = steps.length > 0 && goal.rules.length > 1;
  const late = p ? lateLine(p.days, goal.rules[0]?.onTime) : null;
  const wonPays =
    steps.length && p?.step != null && steps[p.step] ? `${steps[p.step]!.amount} points` : pays;
  return (
    <li
      className="fw-today__goal"
      data-status={goal.status}
      data-goal={goal.id}
      data-period={p?.outcome ?? 'none'}
    >
      <p className="fw-today__goal-head">
        <Picture
          icon={goal.icon}
          photo={goal.photo}
          size={compact ? 40 : 48}
          photoUrl={photoUrl}
          fallback="trophy"
        />
        <span className="fw-today__goal-title">{goal.title}</span>
        {who}
        {goal.memberId === null && !compact ? <span className="fw-pill">Family</span> : null}
      </p>
      {p === null ? (
        <p className="fw-today__goal-ends">Its first {word} hasn’t started yet.</p>
      ) : (
        <>
          <p className="fw-today__goal-ends">
            {kids
              ? `Every child, ${daysRule ? 'every day it’s due' : 'all of it'} this ${word}${pays ? ` · ${pays} each` : ''}`
              : daysRule && !weighted
                ? `Every day it’s due this ${word}`
                : `This ${word}`}
          </p>
          {kids ? (
            <ChildRows kids={kids} word={word} members={members} />
          ) : days.length ? (
            <DayMarks days={days} />
          ) : null}
          {kids && p.outcome === 'missed' ? (
            <p className="fw-goal-line" data-kind="missed">
              <Icon name="repeat" size={36} />
              <span>{familyMissedLine(p, name) ?? startsAgainLine(p, repeat)}</span>
            </p>
          ) : kids && p.outcome === 'won' ? (
            <p className="fw-goal-line" data-kind="won">
              <Icon name="trophy" size={36} />
              <span>{familyWonLine(p, name, goal.pays ?? null)}</span>
            </p>
          ) : kids ? null : p.outcome === 'missed' ? (
            <p className="fw-goal-line" data-kind="missed">
              <Icon name="repeat" size={36} />
              <span>{startsAgainLine(p, repeat)}</span>
            </p>
          ) : p.outcome === 'won' ? (
            <p className="fw-goal-line" data-kind="won">
              <Icon name="trophy" size={36} />
              <span>
                Won this {word}!{wonPays ? ` ${wonPays}.` : ''}
              </span>
            </p>
          ) : weighted ? (
            <>
              {goal.rules.map((r) => {
                const m = ruleMeter(r);
                return (
                  <div key={r.id} className="fw-today__goal-rule" data-met={r.met || undefined}>
                    <GoalMeter
                      label={`${m.label}${r.weight ? ` · ${r.weight}%` : ''}`}
                      value={m.value}
                      target={m.target}
                    />
                  </div>
                );
              })}
              <p className="fw-today__goal-logic">{`${Math.round(goal.pct)}% this ${word}`}</p>
            </>
          ) : steps.length && daysRule ? null : daysRule && p.daysDue !== null ? (
            <GoalMeter
              label={pays ? `Days · ${pays}` : 'Days'}
              value={Math.min(p.daysDone ?? 0, needed)}
              target={needed}
            />
          ) : (
            goal.rules
              .filter((r) => r.type !== 'DAYS_DUE')
              .map((r) => {
                const m = ruleMeter(r);
                return (
                  <div key={r.id} className="fw-today__goal-rule" data-met={r.met || undefined}>
                    <GoalMeter label={m.label} value={m.value} target={m.target} />
                  </div>
                );
              })
          )}
          {steps.length ? (
            <StepChips
              chips={stepChips(steps, kind, p.daysDue)}
              on={markedStep(kind, {
                won: p.outcome === 'won',
                reached: p.step ?? null,
                best: p.stepBest ?? null,
              })}
            />
          ) : null}
          {p.outcome === 'open' &&
          (late ||
            (steps.length &&
              stepNudge(steps, { reached: p.step ?? null, best: p.stepBest ?? null }, kind))) ? (
            <p className="fw-today__goal-note">
              {[
                late,
                steps.length
                  ? stepNudge(steps, { reached: p.step ?? null, best: p.stepBest ?? null }, kind)
                  : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          ) : null}
          {note && !steps.length ? <p className="fw-today__goal-note">{note}</p> : null}
          {p.outcome === 'won' && p.nextStart ? (
            <p className="fw-today__goal-note">
              {`Next ${word} starts ${new Date(`${p.nextStart}T12:00:00Z`).toLocaleDateString(
                'en-US',
                { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' },
              )}.`}
            </p>
          ) : null}
        </>
      )}
      {goal.history.length ? (
        <div className="fw-goal__weeks">
          <span className="fw-today__goal-note">{won ?? `First ${word} going now`}</span>
          <PeriodMarks
            label={`The last ${goal.history.length} ${periodWord(repeat, goal.history.length)}`}
            periods={goal.history.map((h) => ({
              key: h.start,
              outcome: h.outcome,
              label: periodLabel(h, repeat),
            }))}
          />
        </div>
      ) : null}
      {action}
    </li>
  );
}

/** [RWD-07][US-403] A child's goals, then the family's, each with a meter per rule. */
export function GoalsCard({
  goals,
  today,
  photoUrl,
  members = [],
}: {
  goals: BoardGoal[];
  today: string;
  photoUrl?: PhotoUrl;
  /** [RWD-20] The family, for an every-child goal's children. */
  members?: BoardMember[];
}) {
  if (goals.length === 0) return null;
  return (
    <section className="fw-today__card fw-today__goals" aria-labelledby="me-goals">
      <h3 id="me-goals">Goals</h3>
      <ul className="fw-today__goal-list" aria-labelledby="me-goals">
        {goals.map((g) => (
          <GoalItem key={g.id} goal={g} today={today} photoUrl={photoUrl} members={members} />
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
  members = [],
}: {
  goals: BoardGoal[];
  today: string;
  photoUrl?: PhotoUrl;
  /** [RWD-20] The family, for an every-child goal's children. */
  members?: BoardMember[];
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
          <GoalItem
            key={g.id}
            goal={g}
            today={today}
            photoUrl={photoUrl}
            compact
            members={members}
          />
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
