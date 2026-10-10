import { describe, expect, it } from 'vitest';
import { covered, done, fact, missed, open, pending, skipped, taskDone } from './fixtures';
import { evaluateHistory } from './history';
import type { OccurrenceFact } from './types';

// Friday, Oct 9, 2026 is today.
const TODAY = '2026-10-09';
const history = (occurrences: OccurrenceFact[], asOf = TODAY) =>
  evaluateHistory({ memberId: 'maya', occurrences, asOf });
const classes = (occurrences: OccurrenceFact[], asOf = TODAY) =>
  Object.fromEntries(history(occurrences, asOf).days.map((d) => [d.date, d.dayClass]));

/** Two routines on each date, both done. */
const allDone = (...dates: string[]) => dates.flatMap((d) => [done(d), done(d, { points: 2 })]);

describe('evaluateHistory: days and raw runs', () => {
  it('[RWD-11] six finalized days with everything done are a good run of 6', () => {
    const h = history([
      ...allDone(
        '2026-10-03',
        '2026-10-04',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
      ),
      open(TODAY),
    ]);
    expect(h.current).toEqual({ kind: 'good', length: 6 });
    expect(h.bestGood).toBe(6);
    expect(h.days.map((d) => d.dayClass)).toEqual([...Array(6).fill('good'), 'open']);
    expect(h.segments).toEqual([{ kind: 'good', start: '2026-10-03', end: null, length: 6 }]);
  });

  it('[RWD-11][RWD-05] three finalized days with misses are a bad run of 3; today, still open, is not bad', () => {
    const h = history([
      done('2026-10-05'),
      missed('2026-10-06'),
      missed('2026-10-07'),
      done('2026-10-08'),
      missed('2026-10-08'),
      open(TODAY),
    ]);
    expect(h.current).toEqual({ kind: 'bad', length: 3 });
    expect(h.worstBad).toBe(3);
    expect(h.days.at(-1)).toMatchObject({ date: TODAY, dayClass: 'open' });
  });

  it('[RWD-11][RWD-05] days with no routines (a weekend) neither break nor extend a run', () => {
    // Mon Sep 28 – Fri Oct 2 done, nothing on the weekend, Mon Oct 5 – Tue Oct 6 done.
    const h = history(
      allDone(
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
        '2026-10-05',
        '2026-10-06',
      ),
      '2026-10-07',
    );
    expect(classes(allDone('2026-10-02', '2026-10-05'), '2026-10-06')).toMatchObject({
      '2026-10-03': 'neutral',
      '2026-10-04': 'neutral',
    });
    expect(h.segments).toEqual([{ kind: 'good', start: '2026-09-28', end: null, length: 7 }]);
  });

  it('[RWD-11][D-30] skipped and covered routines are neutral: a day of only those is neutral', () => {
    expect(
      classes([
        skipped('2026-10-06'),
        covered('2026-10-06'),
        done('2026-10-07'),
        skipped('2026-10-07'),
        done('2026-10-08'),
        covered('2026-10-08'),
      ]),
    ).toMatchObject({ '2026-10-06': 'neutral', '2026-10-07': 'good', '2026-10-08': 'good' });
  });

  it('[RWD-11][D-31] tasks never make a day good or bad, but count as done on the day they were done', () => {
    const h = history([
      skipped('2026-10-05'),
      done('2026-10-07'),
      // A task due on the 5th, done late on the 7th; another still open from the 6th.
      taskDone('2026-10-05', '2026-10-07', { points: 3 }),
      fact('2026-10-06', 'scheduled', { kind: 'task' }),
    ]);
    const byDate = Object.fromEntries(h.days.map((d) => [d.date, d]));
    expect(byDate['2026-10-05']).toMatchObject({ scheduled: 1, done: 0, dayClass: 'neutral' });
    expect(byDate['2026-10-06']).toMatchObject({ scheduled: 0, dayClass: 'neutral' });
    expect(byDate['2026-10-07']).toMatchObject({
      scheduled: 1,
      done: 2,
      points: 8,
      dayClass: 'good',
    });
  });

  it('[RWD-05][D-51] a past day still waiting for a parent, or not yet closed, is open: never bad', () => {
    expect(
      classes([
        done('2026-10-06'),
        pending('2026-10-06'),
        open('2026-10-07'),
        fact('2026-10-08', 'rejected'),
      ]),
    ).toMatchObject({ '2026-10-06': 'open', '2026-10-07': 'open', '2026-10-08': 'open' });
  });

  it('[RWD-05] today is never bad, even with a miss already recorded (a replay as of an earlier day)', () => {
    expect(classes([done('2026-10-08'), missed(TODAY)])).toMatchObject({ [TODAY]: 'open' });
    expect(history([done('2026-10-08'), missed(TODAY)]).current).toEqual({
      kind: 'good',
      length: 1,
    });
  });

  it('[RWD-05][D-51] today counts as good the moment it is all done, and an unfinished today breaks nothing', () => {
    expect(history([...allDone('2026-10-08', TODAY)]).current).toEqual({ kind: 'good', length: 2 });
    expect(history([...allDone('2026-10-08'), done(TODAY), open(TODAY)]).current).toEqual({
      kind: 'good',
      length: 1,
    });
  });

  it('[RWD-11] each day records what was due, done, missed, skipped, covered and the points', () => {
    const [day] = history([
      done('2026-10-08', { points: 5 }),
      done('2026-10-08', { points: 2 }),
      missed('2026-10-08'),
      skipped('2026-10-08'),
      covered('2026-10-08'),
    ]).days;
    expect(day).toEqual({
      date: '2026-10-08',
      scheduled: 5,
      done: 2,
      missed: 1,
      skipped: 1,
      covered: 1,
      points: 7,
      dayClass: 'bad',
    });
  });

  it('[RWD-11] runs end when the other kind starts; only the last one is still going', () => {
    const h = history([
      ...allDone('2026-10-01', '2026-10-02'),
      missed('2026-10-03'),
      missed('2026-10-04'),
      ...allDone('2026-10-05'),
    ]);
    expect(h.segments).toEqual([
      { kind: 'good', start: '2026-10-01', end: '2026-10-02', length: 2 },
      { kind: 'bad', start: '2026-10-03', end: '2026-10-04', length: 2 },
      { kind: 'good', start: '2026-10-05', end: null, length: 1 },
    ]);
    expect(h).toMatchObject({ current: { kind: 'good', length: 1 }, bestGood: 2, worstBad: 2 });
  });

  it('[RWD-11][D-30] counts only this member, and nothing after today', () => {
    const h = history([
      done('2026-10-08'),
      missed('2026-10-08', { member_id: 'leo' }),
      missed('2026-10-10'),
    ]);
    expect(h.days.map((d) => [d.date, d.dayClass])).toEqual([
      ['2026-10-08', 'good'],
      [TODAY, 'neutral'],
    ]);
  });

  it('[RWD-11] no history yet: no days, no runs', () => {
    expect(history([open('2026-10-12'), done('2026-10-08', { member_id: 'leo' })])).toEqual({
      days: [],
      segments: [],
      current: { kind: null, length: 0 },
      bestGood: 0,
      worstBad: 0,
    });
  });
});
