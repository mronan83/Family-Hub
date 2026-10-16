import { describe, expect, it } from 'vitest';
import {
  boardNote,
  daysLine,
  daysNeeded,
  type GoalPeriod,
  missedDaysLine,
  notDueLine,
  periodLabel,
  shownDays,
  spanWords,
  startsAgainLine,
  startsAgainShort,
  thisPeriod,
  wonLine,
} from './goal-periods';

// [RWD-15][RWD-16] A repeating goal's words (WP-80), on Goals and the board. Thursday, Oct 15, 2026 is
// today; the week runs Monday, Oct 12 to Sunday, Oct 18, and Friday, Oct 16 is a day off school.
const TODAY = '2026-10-15';
const week = (o: Partial<GoalPeriod> = {}): GoalPeriod => ({
  start: '2026-10-12',
  end: '2026-10-18',
  outcome: 'open',
  nextStart: '2026-10-19',
  daysDue: 4,
  daysDone: 3,
  daysMissed: 0,
  missesAllowed: 0,
  days: [
    { date: '2026-10-12', mark: 'done' },
    { date: '2026-10-13', mark: 'done' },
    { date: '2026-10-14', mark: 'done' },
    { date: '2026-10-15', mark: 'today' },
    { date: '2026-10-16', mark: 'none', dayType: 'no_school' },
    { date: '2026-10-17', mark: 'none', dayType: 'weekend' },
    { date: '2026-10-18', mark: 'none', dayType: 'weekend' },
  ],
  ...o,
});

describe('a week’s days', () => {
  it('[RWD-15-k] shows each school day and a day off with nothing due, never the weekend', () => {
    expect(
      shownDays(week()).map((d) => `${d.label}:${d.mark}${d.note ? `:${d.note}` : ''}`),
    ).toEqual(['Mon:done', 'Tue:done', 'Wed:done', 'Thu:today', 'Fri:none:no school']);
    // Without a day type, Saturday and Sunday are the weekend; a weekday with nothing due isn't.
    const plain = week({
      days: [
        { date: '2026-10-16', mark: 'none' },
        { date: '2026-10-17', mark: 'none' },
      ],
    });
    expect(shownDays(plain).map((d) => d.note)).toEqual(['nothing due']);
    expect(shownDays({ days: null })).toEqual([]);
  });

  it('[RWD-15-k] says "3 of 4 days · Friday no school", and what is left', () => {
    expect(daysLine(week())).toBe('3 of 4 days');
    expect(daysLine(week({ daysDue: 1, daysDone: 0 }))).toBe('0 of 1 day');
    expect(daysLine(week({ daysDue: null }))).toBeNull();
    expect(notDueLine(week())).toBe('Friday no school');
    expect(notDueLine(week({ days: null }))).toBeNull();
    expect(boardNote(week(), TODAY)).toBe('Today makes it! No school Friday.');
    expect(boardNote(week({ daysDone: 1 }), TODAY)).toBe('3 more days to go. No school Friday.');
    expect(boardNote(week({ outcome: 'won' }), TODAY)).toBeNull();
    expect(boardNote(week({ daysDone: 4, days: [] }), TODAY)).toBeNull();
  });

  it('[RWD-16] needs every day due less the misses allowed, and at least one', () => {
    expect(daysNeeded({ daysDue: 5, missesAllowed: 1 })).toBe(4);
    expect(daysNeeded({ daysDue: 1, missesAllowed: 3 })).toBe(1);
    expect(daysNeeded({ daysDue: 0, missesAllowed: 0 })).toBe(0);
    expect(daysNeeded({ daysDue: null, missesAllowed: null })).toBe(0);
  });
});

describe('a lost or won week', () => {
  it('[RWD-15-k] lost: "Missed, starts again Monday, Oct 19", and which days', () => {
    const lost = week({
      outcome: 'missed',
      days: [
        { date: '2026-10-12', mark: 'done' },
        { date: '2026-10-13', mark: 'missed' },
        { date: '2026-10-14', mark: 'missed' },
      ],
    });
    expect(startsAgainLine(lost, 'week')).toBe('Missed, starts again Monday, Oct 19');
    expect(startsAgainShort(lost)).toBe('Starts again Monday, Oct 19.');
    expect(missedDaysLine(lost)).toBe('Missed Tuesday and Wednesday.');
    expect(
      missedDaysLine({
        days: ['2026-10-12', '2026-10-13', '2026-10-14'].map((date) => ({ date, mark: 'missed' })),
      }),
    ).toBe('Missed Monday, Tuesday and Wednesday.');
    expect(missedDaysLine(week())).toBeNull();
    // The goal's last week: nothing follows.
    expect(startsAgainLine(week({ nextStart: null }), 'week')).toBe('Missed this week');
    expect(startsAgainShort(week({ nextStart: null }))).toBeNull();
  });

  it('[RWD-15-k] the weeks: "Won 3 of the last 4 weeks", a break week left out', () => {
    const p = (start: string, outcome: GoalPeriod['outcome']) => ({ start, end: start, outcome });
    const history = [
      p('2026-09-14', 'won'),
      p('2026-09-21', 'won'),
      p('2026-09-28', 'missed'),
      p('2026-10-05', 'won'),
      p('2026-10-12', 'open'),
    ];
    expect(wonLine(history, 'week')).toBe('Won 3 of the last 4 weeks');
    expect(wonLine([p('2026-09-14', 'neutral'), p('2026-09-21', 'won')], 'week')).toBe(
      'Won the last week',
    );
    expect(wonLine([p('2026-09-21', 'missed')], 'month')).toBe('Missed the last month');
    expect(wonLine([p('2026-10-12', 'open')], 'week')).toBeNull();
    expect(periodLabel(p('2026-10-05', 'won'), 'week')).toBe('Week of Oct 5: won');
    expect(periodLabel(p('2026-10-01', 'open'), 'month')).toBe('October 2026: going now');
    expect(periodLabel(p('2026-08-19', 'neutral'), 'term')).toBe('Term of Aug 19: nothing due');
    expect(periodLabel(p('2026-08-19', 'missed'), 'term')).toBe('Term of Aug 19: missed');
    expect(thisPeriod('term')).toBe('This term');
    expect(spanWords({ start: '2026-09-28', end: '2026-10-04', outcome: 'won' })).toBe(
      'Sep 28 to Oct 4',
    );
  });
});
