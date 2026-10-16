import type { DayMark, PeriodOutcome, Repeat } from '@familywise/rules-engine';

// [RWD-15][RWD-16] A repeating goal's periods in words (WP-80, D-101): the same lines on Goals in the
// admin app and on the board, from the period going now and the last few, as the database stores
// them (reward_goal_period).

export interface GoalPeriod {
  start: string;
  end: string;
  outcome: PeriodOutcome;
  /** The next period's first day inside the goal's dates; null when none follows. */
  nextStart: string | null;
  daysDue: number | null;
  daysDone: number | null;
  daysMissed: number | null;
  missesAllowed: number | null;
  /** A week's days: each one's mark, and for a day with nothing due its day type. */
  days: { date: string; mark: DayMark; dayType?: string | null }[] | null;
}

export interface PeriodOutline {
  start: string;
  end: string;
  outcome: PeriodOutcome;
}

/** How a goal repeats, as the form and the goal's line say it. */
export const REPEAT_WORDS: Record<Repeat, string> = {
  none: 'Doesn’t repeat',
  week: 'Each week',
  month: 'Each month',
  term: 'Each school term',
};

const NOUN: Record<Exclude<Repeat, 'none'>, [string, string]> = {
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  term: ['term', 'terms'],
};

/** "week" / "weeks" for a repeating goal. */
export const periodWord = (repeat: Exclude<Repeat, 'none'>, n = 1) => NOUN[repeat][n === 1 ? 0 : 1];

const at = (date: string) => new Date(`${date}T12:00:00Z`);
const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
  at(date).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
/** "Monday", "Mon", "Oct 19" for a household-local date. */
export const weekday = (date: string) => fmt(date, { weekday: 'long' });
export const shortDay = (date: string) => fmt(date, { weekday: 'short' });
export const monthDay = (date: string) => fmt(date, { month: 'short', day: 'numeric' });

const isWeekend = (d: { date: string; dayType?: string | null }) =>
  d.dayType ? d.dayType === 'weekend' : [0, 6].includes(at(d.date).getUTCDay());

/**
 * [RWD-16] The days a week shows: every day but a weekend day with nothing due, each with its short
 * name, and for a weekday with nothing due why ("no school").
 */
export function shownDays(p: Pick<GoalPeriod, 'days'>) {
  return (p.days ?? [])
    .filter((d) => d.mark !== 'none' || !isWeekend(d))
    .map((d) => ({
      date: d.date,
      label: shortDay(d.date),
      mark: d.mark,
      note: d.mark === 'none' ? noneWords(d.dayType) : undefined,
    }));
}

function noneWords(dayType: string | null | undefined): string {
  return dayType && dayType !== 'school_day' && dayType !== 'weekend' ? 'no school' : 'nothing due';
}

/** "Friday no school" for each weekday of the week with nothing due, joined. */
export function notDueLine(p: Pick<GoalPeriod, 'days'>): string | null {
  const days = (p.days ?? []).filter((d) => d.mark === 'none' && !isWeekend(d));
  if (days.length === 0) return null;
  return days.map((d) => `${weekday(d.date)} ${noneWords(d.dayType)}`).join(', ');
}

/** [RWD-16] The days an "every day it's due" period needs: every day due less the misses allowed. */
export function daysNeeded(p: Pick<GoalPeriod, 'daysDue' | 'missesAllowed'>): number {
  const due = p.daysDue ?? 0;
  return due === 0 ? 0 : Math.max(1, due - (p.missesAllowed ?? 0));
}

/** "3 of 4 days" for an "every day it's due" period. */
export function daysLine(p: GoalPeriod): string | null {
  if (p.daysDue === null) return null;
  const needed = daysNeeded(p);
  return `${p.daysDone ?? 0} of ${needed} ${needed === 1 ? 'day' : 'days'}`;
}

function andList(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** "Missed Tuesday and Wednesday." from a week's days; null when no day is marked missed. */
export function missedDaysLine(p: Pick<GoalPeriod, 'days'>): string | null {
  const missed = (p.days ?? []).filter((d) => d.mark === 'missed').map((d) => weekday(d.date));
  return missed.length ? `Missed ${andList(missed)}.` : null;
}

/** [RWD-16] "Missed, starts again Monday, Oct 19" (or "Missed this week" when nothing follows). */
export function startsAgainLine(p: GoalPeriod, repeat: Exclude<Repeat, 'none'>): string {
  return p.nextStart
    ? `Missed, starts again ${weekday(p.nextStart)}, ${monthDay(p.nextStart)}`
    : `Missed this ${periodWord(repeat)}`;
}

/** "Starts again Monday, Oct 19." after the missed days, on Goals. */
export function startsAgainShort(p: GoalPeriod): string | null {
  return p.nextStart ? `Starts again ${weekday(p.nextStart)}, ${monthDay(p.nextStart)}.` : null;
}

/**
 * [RWD-15] "Won 3 of the last 4 weeks": the last four periods settled (won or missed; a break week
 * neither), the one going now only once it is won. Null before any is settled.
 */
export function wonLine(history: PeriodOutline[], repeat: Exclude<Repeat, 'none'>): string | null {
  const settled = history.filter((h) => h.outcome === 'won' || h.outcome === 'missed').slice(-4);
  if (settled.length === 0) return null;
  const won = settled.filter((h) => h.outcome === 'won').length;
  return settled.length === 1
    ? won
      ? `Won the last ${periodWord(repeat)}`
      : `Missed the last ${periodWord(repeat)}`
    : `Won ${won} of the last ${settled.length} ${periodWord(repeat, 2)}`;
}

/** "Week of Oct 5: won" for a period's mark. */
export function periodLabel(p: PeriodOutline, repeat: Exclude<Repeat, 'none'>): string {
  const head =
    repeat === 'month'
      ? fmt(p.start, { month: 'long', year: 'numeric' })
      : `${repeat === 'week' ? 'Week' : 'Term'} of ${monthDay(p.start)}`;
  const words: Record<PeriodOutcome, string> = {
    won: 'won',
    missed: 'missed',
    neutral: 'nothing due',
    open: 'going now',
  };
  return `${head}: ${words[p.outcome]}`;
}

/** "This week", "This month", "This term". */
export const thisPeriod = (repeat: Exclude<Repeat, 'none'>) => `This ${periodWord(repeat)}`;

/** "Oct 5 to 9" or "Sep 28 to Oct 2" for a period's row. */
export function spanWords(p: PeriodOutline): string {
  const sameMonth = p.start.slice(0, 7) === p.end.slice(0, 7);
  return `${monthDay(p.start)} to ${sameMonth ? Number(p.end.slice(8)) : monthDay(p.end)}`;
}

/**
 * [RWD-16] The nudge under the days on the board: "Today makes it!", "2 more days to go", plus why
 * a weekday isn't needed ("No school Friday.").
 */
export function boardNote(p: GoalPeriod, today: string): string | null {
  if (p.outcome !== 'open' || p.daysDue === null) return null;
  const left = daysNeeded(p) - (p.daysDone ?? 0);
  const todayOpen = (p.days ?? []).some((d) => d.date === today && d.mark === 'today');
  const head =
    left === 1 && todayOpen
      ? 'Today makes it!'
      : left > 0
        ? `${left} more ${left === 1 ? 'day' : 'days'} to go.`
        : null;
  const notDue = (p.days ?? [])
    .filter((d) => d.mark === 'none' && !isWeekend(d) && noneWords(d.dayType) === 'no school')
    .map((d) => `No school ${weekday(d.date)}.`);
  const line = [head, ...notDue].filter(Boolean).join(' ');
  return line || null;
}
