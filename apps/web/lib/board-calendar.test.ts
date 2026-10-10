import { describe, expect, it } from 'vitest';
import {
  addDays,
  behind,
  covers,
  dayName,
  eventsOn,
  eventWhen,
  heading,
  rangeFor,
  step,
  weekStartOf,
} from './board-calendar';
import { readCalendar, type BoardCalendarSource, type BoardEvent } from './snapshot';

// [CAL-04][CAL-07] The board's calendar screen (WP-23): its dates, its steps, what events say.
const NY = 'America/New_York';
const event = (over: Partial<BoardEvent>): BoardEvent => ({
  id: 'e',
  calendarId: 'c',
  title: 'E',
  allDay: false,
  start: '2026-10-20T21:00:00.000Z',
  end: '2026-10-20T22:00:00.000Z',
  startDate: '2026-10-20',
  endDate: '2026-10-20',
  changed: false,
  ...over,
});

describe('which dates a view shows', () => {
  it('[CAL-04] a week from the household’s first weekday, Sunday or Monday', () => {
    expect(weekStartOf('2026-10-21', 0)).toBe('2026-10-18');
    expect(weekStartOf('2026-10-18', 0)).toBe('2026-10-18');
    expect(weekStartOf('2026-10-18', 1)).toBe('2026-10-12');
    expect(rangeFor('week', '2026-10-21', 1)).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(rangeFor('week', '2026-10-21', 0).days).toHaveLength(7);
  });

  it('[CAL-04] a month as whole weeks: five or six rows, the days around it included', () => {
    const october = rangeFor('month', '2026-10-21', 0);
    expect([october.from, october.to, october.days.length]).toEqual([
      '2026-09-27',
      '2026-10-31',
      35,
    ]);
    const august = rangeFor('month', '2026-08-03', 0);
    expect([august.from, august.to, august.days.length]).toEqual(['2026-07-26', '2026-09-05', 42]);
    expect(rangeFor('month', '2027-02-10', 1).from).toBe('2027-02-01');
  });

  it('[CAL-04] a day is itself', () => {
    expect(rangeFor('day', '2026-10-21', 0)).toEqual({
      from: '2026-10-21',
      to: '2026-10-21',
      days: ['2026-10-21'],
    });
  });
});

describe('moving through the calendar', () => {
  it('[CAL-04] a day, a week or a month at a time, across months and years', () => {
    expect(step('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(step('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(step('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(step('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // the spring clock change is just a date
  });

  it('[CAL-04] titles: the day in full, the week’s span, the month', () => {
    expect(heading('day', '2026-10-20', 0)).toBe('Tuesday, October 20');
    expect(heading('week', '2026-10-20', 0)).toBe('Oct 18 – 24');
    expect(heading('week', '2026-10-28', 0)).toBe('Oct 25 – 31');
    expect(heading('week', '2026-11-03', 0)).toBe('Nov 1 – 7');
    expect(heading('week', '2026-10-30', 1)).toBe('Oct 26 – Nov 1');
    expect(heading('month', '2026-10-20', 0)).toBe('October 2026');
    expect(dayName('2026-10-20')).toBe('Tue, Oct 20');
  });

  it('[DEV-06] the snapshot’s calendar serves the dates it covers; others are read', () => {
    const cal = { from: '2026-10-19', to: '2026-11-03', calendars: [], events: [] };
    expect(covers(cal, '2026-10-20', '2026-10-26')).toBe(true);
    expect(covers(cal, '2026-10-25', '2026-11-07')).toBe(false);
    expect(covers(null, '2026-10-20', '2026-10-20')).toBe(false);
  });
});

describe('a day’s events', () => {
  it('[CAL-07] all-day first, then by start; an event over several days is on each', () => {
    const trip = event({
      id: 'trip',
      title: 'Trip',
      allDay: true,
      startDate: '2026-10-19',
      endDate: '2026-10-21',
    });
    const swim = event({ id: 'swim', title: 'Swim' });
    const early = event({ id: 'early', title: 'Early', start: '2026-10-20T12:00:00.000Z' });
    expect(eventsOn([swim, trip, early], '2026-10-20').map((e) => e.id)).toEqual([
      'trip',
      'early',
      'swim',
    ]);
    expect(eventsOn([swim, trip], '2026-10-21').map((e) => e.id)).toEqual(['trip']);
    expect(eventsOn([swim, trip], '2026-10-22')).toEqual([]);
  });

  it('[CAL-07] says its time in the household’s zone; past midnight, until when', () => {
    expect(eventWhen(event({}), '2026-10-20', NY)).toBe('5:00 pm');
    expect(eventWhen(event({ allDay: true }), '2026-10-20', NY)).toBe('All day');
    const flight = event({
      start: '2026-10-21T02:30:00.000Z', // 10:30 pm on the 20th in New York
      end: '2026-10-21T05:00:00.000Z', // 1:00 am on the 21st
      startDate: '2026-10-20',
      endDate: '2026-10-21',
    });
    expect(eventWhen(flight, '2026-10-20', NY)).toBe('10:30 pm');
    expect(eventWhen(flight, '2026-10-21', NY)).toBe('Until 1:00 am');
  });
});

describe('a calendar behind', () => {
  const cal = (over: Partial<BoardCalendarSource>): BoardCalendarSource => ({
    id: 'c',
    name: 'School',
    color: 'member-3',
    memberId: null,
    status: 'ok',
    lastSuccessAt: '2026-10-20T15:00:00.000Z',
    ...over,
  });
  const now = new Date('2026-10-20T16:00:00.000Z');

  it('[CAL-06] failing, or not synced for three of its 15-minute intervals', () => {
    expect(behind([cal({})], now)).toHaveLength(1);
    expect(behind([cal({ lastSuccessAt: '2026-10-20T15:30:00.000Z' })], now)).toEqual([]);
    expect(
      behind([cal({ status: 'error', lastSuccessAt: '2026-10-20T15:59:00.000Z' })], now),
    ).toHaveLength(1);
    expect(behind([cal({ status: 'pending', lastSuccessAt: null })], now)).toEqual([]);
  });
});

describe('reading the board’s calendar', () => {
  it('[CAL-04] calendars and events as board_calendar() returns them', () => {
    expect(
      readCalendar({
        from: '2026-10-19',
        to: '2026-11-03',
        calendars: [
          {
            id: 'c1',
            name: 'School',
            color: 'member-3',
            member_id: 'm1',
            status: 'error',
            last_success_at: null,
          },
          { name: 'no id' },
        ],
        events: [
          {
            id: 'i1',
            calendar_id: 'c1',
            title: 'Picture day',
            all_day: true,
            start: '2026-10-22T04:00:00+00:00',
            end: '2026-10-23T04:00:00+00:00',
            start_date: '2026-10-22',
            end_date: '2026-10-22',
            changed: false,
          },
          { id: 'broken' },
        ],
      }),
    ).toEqual({
      from: '2026-10-19',
      to: '2026-11-03',
      calendars: [
        {
          id: 'c1',
          name: 'School',
          color: 'member-3',
          memberId: 'm1',
          status: 'error',
          lastSuccessAt: null,
        },
      ],
      events: [
        {
          id: 'i1',
          calendarId: 'c1',
          title: 'Picture day',
          allDay: true,
          start: '2026-10-22T04:00:00+00:00',
          end: '2026-10-23T04:00:00+00:00',
          startDate: '2026-10-22',
          endDate: '2026-10-22',
          changed: false,
        },
      ],
    });
  });

  it('[DEV-05] none from an older database or for anyone but a board', () => {
    expect(readCalendar(undefined)).toBeNull();
    expect(readCalendar(null)).toBeNull();
    expect(readCalendar({ calendars: [] })).toBeNull();
  });
});
