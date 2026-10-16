import { dayNumber, toDate, weekOf } from './dates';
import type { Repeat } from './types';

/** A period's days, whole (as the calendar has them), before the goal's dates cut it. */
export interface Span {
  from: string;
  to: string;
}

const addDays = (date: string, n: number) => toDate(dayNumber(date) + n);

function monthOf(date: string): Span {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/**
 * [RWD-15] The whole periods of a repeating goal that touch `from` to `to`, in order: each household
 * week (from `weekStart`), each calendar month, or each school term (days between terms belong to
 * none). The caller cuts the first and last to the goal's dates.
 */
export function spansBetween(
  repeat: Exclude<Repeat, 'none'>,
  from: string,
  to: string,
  weekStart: number,
  terms: readonly { start_date: string; end_date: string }[] = [],
): Span[] {
  if (to < from) return [];
  const out: Span[] = [];
  if (repeat === 'term') {
    for (const t of [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
      dayNumber(t.start_date);
      dayNumber(t.end_date);
      if (t.end_date < t.start_date) throw new RangeError('a term ends before it starts');
      if (t.end_date >= from && t.start_date <= to)
        out.push({ from: t.start_date, to: t.end_date });
    }
    return out;
  }
  let at = repeat === 'week' ? weekOf(from, weekStart) : monthOf(from).from;
  while (at <= to) {
    const span = repeat === 'week' ? { from: at, to: addDays(at, 6) } : monthOf(at);
    out.push(span);
    at = addDays(span.to, 1);
  }
  return out;
}

/** The first day of the whole period after `span` (null when no term follows). */
export function nextSpanStart(
  repeat: Exclude<Repeat, 'none'>,
  span: Span,
  terms: readonly { start_date: string; end_date: string }[] = [],
): string | null {
  if (repeat !== 'term') return addDays(span.to, 1);
  const later = terms.map((t) => t.start_date).filter((d) => d > span.to);
  return later.length ? later.sort()[0]! : null;
}
