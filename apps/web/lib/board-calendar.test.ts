import { describe, expect, it } from 'vitest';
import {
  addDays,
  allDayLanes,
  behind,
  eventSpan,
  gridHours,
  hourIn,
  hourLabel,
  hourRows,
  nowInRows,
  shortClock,
  spanRange,
  sideBySide,
  splitDays,
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
            location: 'School gym',
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
          location: 'School gym',
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

// [CAL-04][CAL-10] The time grid (WP-52, D-82).
describe('the time grid', () => {
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  // 9:30 am New York on a day = 13:30 UTC (EDT).
  const at = (d: string, hm: string) => new Date(`${d}T${hm}:00-04:00`).toISOString();
  const timed = (id: string, d: string, from: string, to: string, endDate = d) =>
    event({ id, title: id, start: at(d, from), end: at(endDate, to), startDate: d, endDate });
  const allDay = (id: string, from: string, to = from) =>
    event({ id, title: id, allDay: true, startDate: from, endDate: to });

  it('[CAL-04] reads the wall-clock hour in the household’s zone', () => {
    expect(hourIn(at('2026-10-20', '09:30'), NY)).toBe(9.5);
    expect(hourIn(at('2026-10-20', '00:00'), NY)).toBe(0);
    expect(hourIn('2026-11-02T01:00:00Z', NY)).toBe(20); // after the clocks go back: EST
  });

  it('[D-82] splits all-day events from timed ones; a late one is two pieces; a day-long one is a bar', () => {
    const { allDay: lanes, pieces } = splitDays(
      [
        allDay('Visit', '2026-10-20', '2026-10-22'),
        timed('Flight', '2026-10-21', '22:30', '01:00', '2026-10-22'),
        timed('Retreat', '2026-10-19', '09:00', '10:00', '2026-10-20'),
        timed('Swim', '2026-10-19', '17:00', '18:00'),
        timed('Midnight', '2026-10-23', '23:00', '00:00', '2026-10-23'),
        allDay('Long ago', '2026-10-01'),
      ],
      days,
      NY,
    );
    expect(lanes.map((e) => e.title)).toEqual(['Visit', 'Retreat']);
    expect(pieces.map((p) => [p.event.title, p.day, p.start, p.end])).toEqual([
      ['Swim', 0, 17, 18],
      ['Flight', 2, 22.5, 24],
      ['Flight', 3, 0, 1],
      ['Midnight', 4, 23, 24],
    ]);
  });

  it('[D-82] all-day lanes: one bar over its days, longer first, the rest counted on their days', () => {
    const { bars, more } = allDayLanes(
      [
        allDay('Columbus Day', '2026-10-19'),
        allDay('Spirit week', '2026-10-19', '2026-10-23'),
        allDay('Library', '2026-10-19'),
        allDay('Visit', '2026-10-20', '2026-10-22'),
        allDay('Picture day', '2026-10-21'),
        allDay('Trip', '2026-10-17', '2026-10-19'),
      ],
      days,
      2,
    );
    expect(bars.map((b) => [b.event.title, b.lane, b.from, b.to])).toEqual([
      ['Spirit week', 0, 0, 4],
      ['Trip', 1, 0, 0],
      ['Visit', 1, 1, 3],
    ]);
    expect(more).toEqual([2, 0, 1, 0, 0]);
  });

  it('[D-82] the home screen’s rows: an hour for each start, a day’s events together, reaching down', () => {
    const { pieces } = splitDays(
      [
        timed('Dentist', '2026-10-19', '09:30', '10:15'),
        timed('Bus', '2026-10-19', '16:00', '16:15'),
        timed('Tap', '2026-10-19', '16:30', '17:00'),
        timed('Soccer', '2026-10-22', '15:30', '17:00'),
        timed('Pizza', '2026-10-23', '18:00', '20:00'),
        timed('Retro', '2026-10-19', '19:00', '20:00'),
        timed('Swim', '2026-10-22', '17:00', '18:00'),
      ],
      days,
      NY,
    );
    const { hours, groups } = hourRows(pieces);
    expect(hours).toEqual([9, 15, 16, 17, 18, 19]);
    expect(
      groups.map((g) => [
        g.day,
        hours[g.row],
        g.span,
        g.pieces.map((p) => p.event.title).join('+'),
      ]),
    ).toEqual([
      [0, 9, 1, 'Dentist'],
      [0, 16, 1, 'Bus+Tap'],
      [0, 19, 1, 'Retro'],
      // Soccer runs to 5 pm: down through the 4 pm row, short of Swim's.
      [3, 15, 2, 'Soccer'],
      [3, 17, 1, 'Swim'],
      [4, 18, 2, 'Pizza'],
    ]);
    expect(nowInRows(hours, 16 + 40 / 60)).toEqual({ row: 2, at: expect.closeTo(0.667, 2) });
    expect(nowInRows(hours, 12)).toEqual({ row: 1, at: 0 });
    expect(nowInRows(hours, 21)).toEqual({ row: 5, at: 1 });
    expect(nowInRows([], 12)).toBeNull();
  });

  it('[D-82] Week and Day draw 8 am to 8 pm at least, stretched to the events; overlaps side by side', () => {
    const { pieces } = splitDays(
      [
        timed('Meeting', '2026-10-20', '14:00', '15:00'),
        timed('Orthodontist', '2026-10-20', '14:30', '15:15'),
        timed('Bus', '2026-10-20', '16:00', '16:15'),
        timed('Tap', '2026-10-20', '16:15', '17:00'),
        timed('Book club', '2026-10-21', '19:30', '21:00'),
      ],
      days,
      NY,
    );
    expect(gridHours(pieces)).toEqual({ from: 8, to: 21 });
    expect(gridHours([])).toEqual({ from: 8, to: 20 });
    expect(
      gridHours(splitDays([timed('Early', '2026-10-20', '06:45', '07:30')], days, NY).pieces),
    ).toEqual({ from: 6, to: 20 });
    // A late flight: to midnight on its day; its part after midnight doesn't start the grid at 12 am.
    expect(
      gridHours(
        splitDays([timed('Flight', '2026-10-21', '22:30', '01:00', '2026-10-22')], days, NY).pieces,
      ),
    ).toEqual({ from: 8, to: 24 });
    // Today shown at 5:50 am or 10:40 pm: the grid reaches now, so its line is there.
    expect(gridHours(pieces, 5 + 50 / 60)).toEqual({ from: 5, to: 21 });
    expect(gridHours([], 22 + 40 / 60)).toEqual({ from: 8, to: 23 });
    expect(sideBySide(pieces).map((p) => [p.event.title, p.col, p.cols])).toEqual([
      ['Meeting', 0, 2],
      ['Orthodontist', 1, 2],
      // The bus is drawn half an hour tall, so the tap class beside it.
      ['Bus', 0, 2],
      ['Tap', 1, 2],
      ['Book club', 0, 1],
    ]);
  });

  it('[CAL-10] what times and details say', () => {
    expect(shortClock(9.5)).toBe('9:30');
    expect(shortClock(16)).toBe('4:00');
    expect(hourLabel(0)).toBe('12 am');
    expect(hourLabel(12)).toBe('12 pm');
    expect(hourLabel(21)).toBe('9 pm');
    expect(spanRange('2026-10-11', '2026-10-15')).toBe('Oct 11 – 15');
    expect(spanRange('2026-10-30', '2026-11-03')).toBe('Oct 30 – Nov 3');
    expect(eventSpan(timed('Dentist', '2026-10-20', '09:30', '10:15'), NY)).toBe(
      'Tue, Oct 20, 9:30 – 10:15 am',
    );
    expect(eventSpan(timed('Lunch', '2026-10-20', '11:30', '13:00'), NY)).toBe(
      'Tue, Oct 20, 11:30 am – 1:00 pm',
    );
    expect(eventSpan(allDay('Visit', '2026-10-20', '2026-10-22'), NY)).toBe(
      'Tue, Oct 20 – Thu, Oct 22, all day',
    );
    expect(eventSpan(timed('Flight', '2026-10-21', '22:30', '01:00', '2026-10-22'), NY)).toBe(
      'Wed, Oct 21, 10:30 pm – Thu, Oct 22, 1:00 am',
    );
  });
});
