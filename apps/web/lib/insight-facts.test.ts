import { describe, expect, it } from 'vitest';
import type { Insights } from './history';
import { checkingLine, dayByDayLine, missedLine, tagLine } from './insight-facts';
import type { FoldLine } from './setup-facts';

// [NFR-18][D-120] Insights' folded headers (WP-97): each detail section's one-line finding.

/** A line as it reads, the bold parts in **. */
const read = (line: FoldLine) =>
  line.map((p) => (typeof p === 'string' ? p : `**${p.b}**`)).join('');

type Day = Insights['days'][number];
const day = (date: string, done: number, missed: number): Day => ({
  date,
  class: missed ? 'bad' : 'good',
  scheduled: done + missed,
  done,
  missed,
});

describe('[RWD-12-a] Insights’ folded findings', () => {
  it('Day by day: the best and lowest weekday, of what was done or missed', () => {
    const days = [
      day('2026-10-05', 3, 1), // Monday 75%
      day('2026-10-06', 4, 0), // Tuesday 100%
      day('2026-10-10', 1, 2), // Saturday 33%
      day('2026-10-13', 2, 0), // Tuesday again: 6 of 6
      // A day with nothing that counted is left out.
      { date: '2026-10-11', class: 'neutral', scheduled: 3, done: 0, missed: 0 },
    ] satisfies Day[];
    expect(read(dayByDayLine(days, 0))).toBe(
      '**Best:** Tuesdays, 100% · **lowest:** Saturdays, 33%',
    );
  });

  it('Day by day: a tie goes to the first in the household’s week; one weekday; all alike; none', () => {
    // Sunday and Monday both 50%; with Monday first in the week, Monday is both best and lowest
    // among equals, so all alike.
    const tie = [day('2026-10-04', 1, 1), day('2026-10-05', 1, 1)];
    expect(read(dayByDayLine(tie, 1))).toBe('**Every day alike:** 50%');
    const tue = [day('2026-10-06', 1, 1), day('2026-10-04', 2, 0), day('2026-10-05', 2, 0)];
    // Week from Monday: Monday 100% before Sunday 100%.
    expect(read(dayByDayLine(tue, 1))).toBe('**Best:** Mondays, 100% · **lowest:** Tuesdays, 50%');
    expect(read(dayByDayLine([day('2026-10-06', 1, 3)], 0))).toBe('**Best:** Tuesdays, 25%');
    expect(read(dayByDayLine([], 0))).toBe('No days that counted yet');
  });

  it('Day by day: a date’s weekday is its own, whatever the hour or daylight saving', () => {
    // Sunday Nov 1 2026, the day daylight saving ends in New York, and Saturday Jan 2.
    const days = [day('2026-11-01', 1, 0), day('2027-01-02', 0, 1)];
    expect(read(dayByDayLine(days, 0))).toBe('**Best:** Sundays, 100% · **lowest:** Saturdays, 0%');
  });

  it('Missed most: the most missed, once or how many times; none', () => {
    expect(
      read(
        missedLine([
          { chore_id: 'a', title: 'Feed the dog', missed: 4 },
          { chore_id: 'b', title: 'Piano practice', missed: 3 },
        ]),
      ),
    ).toBe('**Feed the dog**, missed 4 times');
    expect(read(missedLine([{ chore_id: 'a', title: 'Make bed', missed: 1 }]))).toBe(
      '**Make bed**, missed once',
    );
    expect(read(missedLine([]))).toBe('Nothing missed in these days');
  });

  it('By tag: up to three, most done first, then how many more; none', () => {
    const tag = (name: string, done: number, counted: number) => ({
      tag_id: name,
      name,
      done,
      counted,
    });
    expect(
      read(tagLine([tag('Bedroom', 16, 25), tag('School', 47, 50), tag('Kitchen', 41, 50)])),
    ).toBe('School 94% · Kitchen 82% · Bedroom 64%');
    expect(
      read(
        tagLine([
          tag('A', 1, 1),
          tag('B', 1, 2),
          tag('C', 1, 3),
          tag('D', 1, 4),
          tag('E', 1, 5),
          tag('Empty', 0, 0),
        ]),
      ),
    ).toBe('A 100% · B 50% · C 33% · and 2 more');
    expect(read(tagLine([]))).toBe('No tagged routines in these days');
  });

  it('Checking: checked and sent back while check-offs wait; else check-offs and unchecked; none', () => {
    const trust = (o: Partial<Insights['trust']>): Insights['trust'] => ({
      checkoffs: 0,
      unchecked: 0,
      approved: 0,
      sent_back: 0,
      median_verify_seconds: null,
      ...o,
    });
    expect(read(checkingLine(trust({ checkoffs: 13, approved: 11, sent_back: 1 })))).toBe(
      '**12 checked by a parent** · 1 sent back',
    );
    expect(read(checkingLine(trust({ checkoffs: 34, unchecked: 2 })))).toBe(
      '**34 check-offs** · 2 unchecked by a parent',
    );
    expect(read(checkingLine(trust({ checkoffs: 1 })))).toBe(
      '**1 check-off** · 0 unchecked by a parent',
    );
    expect(read(checkingLine(trust({})))).toBe('No check-offs in these days');
  });
});
