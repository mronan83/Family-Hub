import type { Repeat } from '@familywise/rules-engine';
import {
  type ChildPeriod,
  daysLine,
  type GoalPeriod,
  missedDaysLine,
  type PeriodOutline,
  periodWord,
  startsAgainShort,
} from './goal-periods';

// [RWD-19][RWD-20] Perfect periods, and a family goal every child meets, in words (WP-82, D-103,
// D-126): the same lines on Goals in the admin app and on the board.

type Period = Exclude<Repeat, 'none'>;

/** [RWD-19] A rule counting another goal's periods, as it stands. */
export interface Counted {
  current: number;
  target: number;
  inARow: boolean;
  /** The best run so far, in a row; null in total. */
  best: number | null;
  met: boolean;
  /** How the counted goal repeats. */
  repeat: Period;
}

/** [RWD-19] "1 of 3 weeks in a row" / "2 of 4 weeks won". */
export function countedLine(c: Counted): string {
  const n = Math.min(c.current, c.target);
  return `${n} of ${c.target} ${periodWord(c.repeat, c.target)}${c.inARow ? ' in a row' : ' won'}`;
}

/** [RWD-19] A meter's label, its count beside it: "Weeks in a row · 20 points", "Months won". */
export function countedLabel(c: Pick<Counted, 'inARow' | 'repeat'>, pays: string | null): string {
  const unit = periodWord(c.repeat, 2);
  const head = `${unit.charAt(0).toUpperCase()}${unit.slice(1)}${c.inARow ? ' in a row' : ' won'}`;
  return pays ? `${head} · ${pays}` : head;
}

/** [RWD-19] "best so far 2", in a row while it isn't reached; null otherwise. */
export function bestLine(c: Counted): string | null {
  return c.inARow && !c.met && c.best !== null ? `best so far ${c.best}` : null;
}

/**
 * [RWD-19] What the period going now would make, while it is going and the goal isn't reached: "This
 * week makes 2 in a row." on the board, "This week makes 2 if it’s won" on Goals. Null otherwise.
 */
export function makesLine(
  c: Counted,
  history: PeriodOutline[],
  where: 'board' | 'admin',
): string | null {
  if (c.met || history.at(-1)?.outcome !== 'open') return null;
  const head = `This ${periodWord(c.repeat)} makes ${c.current + 1}${c.inARow ? ' in a row' : ''}`;
  return where === 'board' ? `${head}.` : `${head} if it’s won`;
}

/** [RWD-20] A child's line in an every-child period: "3 of 4 days", "Missed Tuesday", "Nothing due this week". */
export function childLine(
  c: ChildPeriod,
  p: Pick<GoalPeriod, 'missesAllowed'>,
  repeat: Period,
): string {
  if (!c.contributes) return `Nothing due this ${periodWord(repeat)}`;
  if (c.outcome === 'missed') return missedDaysLine(c)?.replace(/\.$/, '') ?? 'Missed';
  if (c.daysDue !== null) {
    return daysLine({ ...childAsPeriod(c), missesAllowed: p.missesAllowed }) ?? '';
  }
  return c.outcome === 'won' ? 'Made it' : `${Math.round(c.pct)}% there`;
}

const childAsPeriod = (c: ChildPeriod): GoalPeriod => ({
  start: '',
  end: '',
  outcome: c.outcome,
  nextStart: null,
  daysDue: c.daysDue,
  daysDone: c.daysDone,
  daysMissed: c.daysMissed,
  missesAllowed: null,
  days: c.days,
});

function andList(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * [RWD-20] Who lost an every-child period, and when it starts again: "Leo missed Tuesday. Starts
 * again Monday, Oct 19." Null when no child lost it.
 */
export function familyMissedLine(p: GoalPeriod, name: (id: string) => string): string | null {
  const lost = (p.children ?? []).filter((c) => c.contributes && c.outcome === 'missed');
  if (lost.length === 0) return null;
  const who = lost.map((c) => {
    const days = missedDaysLine(c);
    return days
      ? `${name(c.memberId)} ${days.charAt(0).toLowerCase()}${days.slice(1)}`
      : `${name(c.memberId)} missed it.`;
  });
  return [who.join(' '), startsAgainShort(p)].filter(Boolean).join(' ');
}

/**
 * [RWD-20][D-126] A won every-child period: "Everyone made it! 20 points each." when every child had
 * something due, else the children who did ("Maya made it! 20 points."): only they are paid.
 */
export function familyWonLine(
  p: GoalPeriod,
  name: (id: string) => string,
  pays: number | null,
): string {
  const kids = p.children ?? [];
  const paid = kids.filter((c) => c.contributes);
  const all = paid.length === kids.length && kids.length > 1;
  const who = all ? 'Everyone' : andList(paid.map((c) => name(c.memberId)));
  const points = pays
    ? ` ${pays.toLocaleString('en-US')} ${pays === 1 ? 'point' : 'points'}${paid.length > 1 ? ' each' : ''}.`
    : '';
  return `${who} made it!${points}`;
}

/**
 * [RWD-20] An every-child period's row in a goal's Weeks: "Won · Maya 5 of 5 days · Leo had nothing
 * due", "Missed · Maya 3 of 4 days · Leo missed Tuesday".
 */
export function familyWeekDetail(
  p: GoalPeriod,
  name: (id: string) => string,
  repeat: Period,
): string {
  const head = { won: 'Won', missed: 'Missed', neutral: 'Nothing due for anyone', open: 'Going' }[
    p.outcome
  ];
  if (p.outcome === 'neutral') return head;
  const kids = (p.children ?? []).map((c) =>
    c.contributes
      ? `${name(c.memberId)} ${childLine(c, p, repeat).replace(/^Missed/, 'missed')}`
      : `${name(c.memberId)} had nothing due`,
  );
  return [head, ...kids].join(' · ');
}

/** [RWD-20][D-126] The points a won every-child period paid: its points for each child with something due. */
export function familyPaid(p: GoalPeriod, pays: number | null): number {
  if (p.outcome !== 'won' || pays === null) return 0;
  return pays * (p.children ?? []).filter((c) => c.contributes).length;
}
