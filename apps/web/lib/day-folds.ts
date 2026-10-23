// [NFR-18][D-120] What Today's and My tasks' folds say, and when Today's parts fold (WP-97), as the
// fold audit draws them. A part of the day folds once everything in it is done or skipped; the part
// a parent just changed stays open with its count, and folds on the next load (D-145). Each line is
// words and bold facts (`FoldLine`, drawn by `Line`).
import type { OccurrenceStatus } from '@familywise/rules-engine';
import { clock, relativeDay } from './chores';
import type { FoldLine } from './setup-facts';
import type { SectionKey } from './today';

/** A part is finished once each item in it is done or skipped (waiting for a parent is not). */
const FINISHED: readonly OccurrenceStatus[] = ['completed', 'approved', 'skipped'];

type Counted = { id: string; title: string; status: OccurrenceStatus };

export interface PartFacts {
  /** How many are done or skipped. */
  done: number;
  total: number;
  /** Everything in it done or skipped: the part folds (on the next load, D-145). */
  finished: boolean;
  /** "6 of 6 done", on the header while open. */
  count: string;
  /** The folded header: "6 of 6 done · Make bed, Brush teeth, Feed the dog and 2 more". */
  line: FoldLine;
}

/**
 * [CHR-12] A part of the day's count and folded line. Done counts done and skipped: sent back, waiting
 * for a parent, missed and still to do are not. A finished part names its first three items (each
 * name once) and how many more.
 */
export function partFacts(items: Counted[]): PartFacts {
  const done = items.filter((i) => FINISHED.includes(i.status)).length;
  const total = items.length;
  const finished = total > 0 && done === total;
  const count = `${done} of ${total} done`;
  if (!finished) return { done, total, finished, count, line: [{ b: count }] };
  const names = [...new Set(items.map((i) => i.title))];
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(', ')} and ${more} more`
      : shown.length < 2
        ? (shown[0] ?? '')
        : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return { done, total, finished, count, line: [{ b: count }, ` · ${list}`] };
}

/**
 * [CHR-12][D-145] Whether a part shows open: Overdue always, while it has anything; any other part
 * while something in it is still to do, or when it holds the item a parent just changed, so the
 * page doesn't fold under their finger and Uncheck stays where it was.
 */
export function partOpen(key: SectionKey, items: Counted[], changed: string | null): boolean {
  if (key === 'overdue') return true;
  if (changed && items.some((i) => i.id === changed)) return true;
  return !partFacts(items).finished;
}

/** [CHR-12] Overdue's header: how many are still open ("1 open"). */
export function overdueWaiting(items: Counted[]): string {
  const open = items.filter((i) => !FINISHED.includes(i.status)).length;
  return `${open} open`;
}

/** [CHR-12] A day as Today's heading says it: "Friday, October 16". */
export function longDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

/**
 * [CHR-14] My tasks' Coming up, folded: how many in the next seven days and the next one, its day
 * and time ("5 in the next 7 days · next: Leo's dentist, Tuesday 3:30 pm"); nothing coming up.
 * The items come in order (`myTaskGroups`).
 */
export function comingUpLine(
  upcoming: { title: string; dueDate: string; dueTime: string | null }[],
  today: string,
): FoldLine {
  const next = upcoming[0];
  if (!next) return ['Nothing in the next 7 days'];
  const day = relativeDay(next.dueDate, today);
  const when = next.dueTime ? `${day} ${clock(next.dueTime)}` : day;
  return [{ b: `${upcoming.length} in the next 7 days` }, ` · next: ${next.title}, ${when}`];
}
