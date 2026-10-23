// [NFR-18][D-120] What Insights' folds say while folded (WP-97), as the fold audit draws them: Day by
// day, Missed most, By tag and Checking, each its one-line finding. Each line is words and bold facts
// (`FoldLine`, drawn by `Line`).
import type { Insights } from './history';
import type { FoldLine } from './setup-facts';

const WEEKDAYS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

const pct = (done: number, counted: number) => Math.round((done / counted) * 100);

/**
 * [RWD-12] Day by day, folded: the weekday with the most done of what counted and the one with the
 * least ("Best: Tuesdays, 96% · lowest: Saturdays, 61%"), in the household's week order, the first
 * one on a tie. What counted on a day is what was done or missed; a day with neither is left out.
 */
export function dayByDayLine(days: Insights['days'], weekStart: number): FoldLine {
  const sums = Array.from({ length: 7 }, () => ({ done: 0, counted: 0 }));
  for (const d of days) {
    const s = sums[new Date(`${d.date}T12:00:00Z`).getUTCDay()]!;
    s.done += d.done;
    s.counted += d.done + d.missed;
  }
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7).filter(
    (w) => sums[w]!.counted > 0,
  );
  if (order.length === 0) return ['No days that counted yet'];
  const rate = (w: number) => pct(sums[w]!.done, sums[w]!.counted);
  let best = order[0]!;
  let low = order[0]!;
  for (const w of order) {
    if (rate(w) > rate(best)) best = w;
    if (rate(w) < rate(low)) low = w;
  }
  if (order.length === 1) return [{ b: 'Best:' }, ` ${WEEKDAYS[best]}, ${rate(best)}%`];
  if (rate(best) === rate(low)) return [{ b: 'Every day alike:' }, ` ${rate(best)}%`];
  return [
    { b: 'Best:' },
    ` ${WEEKDAYS[best]}, ${rate(best)}% · `,
    { b: 'lowest:' },
    ` ${WEEKDAYS[low]}, ${rate(low)}%`,
  ];
}

/** [RWD-12] Missed most, folded: the most missed ("Feed the dog, missed 4 times"), or none. */
export function missedLine(missed: Insights['most_missed']): FoldLine {
  const top = missed[0];
  if (!top) return ['Nothing missed in these days'];
  return [{ b: top.title }, `, missed ${top.missed === 1 ? 'once' : `${top.missed} times`}`];
}

/**
 * [RWD-12] By tag, folded: up to three tags, most done first ("School 94% · Kitchen 82% · Bedroom
 * 64%"), then how many more; a tag with nothing that counted is left out.
 */
export function tagLine(tags: Insights['by_tag']): FoldLine {
  const counted = tags
    .filter((t) => t.counted > 0)
    .map((t) => ({ name: t.name, rate: pct(t.done, t.counted) }))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  if (counted.length === 0) return ['No tagged routines in these days'];
  const shown = counted
    .slice(0, 3)
    .map((t) => `${t.name} ${t.rate}%`)
    .join(' · ');
  const more = counted.length - 3;
  return [more > 0 ? `${shown} · and ${more} more` : shown];
}

/**
 * [RWD-12] Checking, folded. While check-offs wait for a parent: how many a parent checked and sent
 * back ("12 checked by a parent · 1 sent back"); while they count straight away: the check-offs and
 * how many a parent unchecked. None in these days.
 */
export function checkingLine(trust: Insights['trust']): FoldLine {
  if (trust.checkoffs === 0) return ['No check-offs in these days'];
  const judged = trust.approved + trust.sent_back;
  if (judged > 0)
    return [{ b: `${judged} checked by a parent` }, ` · ${trust.sent_back} sent back`];
  return [
    { b: `${trust.checkoffs} ${trust.checkoffs === 1 ? 'check-off' : 'check-offs'}` },
    ` · ${trust.unchecked} unchecked by a parent`,
  ];
}
