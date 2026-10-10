import { datesBetween, dayNumber } from './dates';
import { ALL_DONE, classifyDay, creditDate, memberUnits, tallyRoutines } from './facts';
import type { DailySummary, HistoryEvaluation, HistoryInput, StreakSegment } from './types';

/**
 * [RWD-11][RWD-05] A member's days and their raw runs of good and bad days (02 §5): no grace, and
 * neutral and open days are passed over, neither extending nor breaking a run. What the board's
 * streak flame, the heatmap and the parents' insights show; day close stores it (WP-17).
 *
 * Days run from the member's first routine or credited check-off to `asOf`, every day included
 * (none when that is after `asOf`).
 */
export function evaluateHistory(input: HistoryInput): HistoryEvaluation {
  const { asOf } = input;
  dayNumber(asOf);
  const units = memberUnits(input.occurrences, input.memberId);

  let first: string | null = null;
  for (const u of units) {
    const d =
      u.fact.kind === 'chore' ? u.fact.due_date : u.state === 'done' ? creditDate(u.fact) : null;
    if (d !== null && (first === null || d < first)) first = d;
  }
  if (first === null) {
    return { days: [], segments: [], current: { kind: null, length: 0 }, bestGood: 0, worstBad: 0 };
  }

  const routines = tallyRoutines(units);
  const done = new Map<string, { count: number; points: number }>();
  for (const u of units) {
    if (u.state !== 'done') continue;
    const d = creditDate(u.fact);
    const had = done.get(d) ?? { count: 0, points: 0 };
    done.set(d, { count: had.count + 1, points: had.points + u.fact.points });
  }

  const days: DailySummary[] = datesBetween(first, asOf).map((date) => {
    const t = routines.get(date);
    const credited = done.get(date);
    return {
      date,
      scheduled: t ? t.done + t.pending + t.open + t.missed + t.skipped + t.covered : 0,
      done: credited?.count ?? 0,
      missed: t?.missed ?? 0,
      skipped: t?.skipped ?? 0,
      covered: t?.covered ?? 0,
      points: credited?.points ?? 0,
      dayClass: t ? classifyDay(date, t, asOf, ALL_DONE) : 'neutral',
    };
  });

  const segments: StreakSegment[] = [];
  for (const day of days) {
    if (day.dayClass !== 'good' && day.dayClass !== 'bad') continue;
    const last = segments.at(-1);
    if (last && last.kind === day.dayClass) {
      last.end = day.date;
      last.length += 1;
    } else {
      segments.push({ kind: day.dayClass, start: day.date, end: day.date, length: 1 });
    }
  }
  // The last run is still going: only a day of the other kind ends it.
  const current = segments.at(-1);
  if (current) current.end = null;

  return {
    days,
    segments,
    current: current ? { kind: current.kind, length: current.length } : { kind: null, length: 0 },
    bestGood: Math.max(0, ...segments.filter((s) => s.kind === 'good').map((s) => s.length)),
    worstBad: Math.max(0, ...segments.filter((s) => s.kind === 'bad').map((s) => s.length)),
  };
}
