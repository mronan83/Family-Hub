import { describe, expect, it } from 'vitest';
import { datesBetween, dayNumber, toDate, weekOf } from './dates';

describe('household dates', () => {
  it('[RWD-05] reads and writes YYYY-MM-DD dates, leap days included', () => {
    for (const d of ['1970-01-01', '2024-02-29', '2026-10-09', '2099-12-31']) {
      expect(toDate(dayNumber(d))).toBe(d);
    }
    expect(dayNumber('2026-10-10') - dayNumber('2026-10-09')).toBe(1);
  });

  it('[RWD-05] refuses anything that is not a real date', () => {
    for (const d of [
      '2026-02-30',
      '2026-13-01',
      '2026-1-1',
      '10/09/2026',
      '',
      '2026-10-09T00:00',
    ]) {
      expect(() => dayNumber(d)).toThrow(RangeError);
    }
  });

  it('[RWD-05] counts one day at a time across daylight-saving changes', () => {
    // US clocks change on Sunday, Mar 8 and Sunday, Nov 1, 2026: each is still one day.
    expect(datesBetween('2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(datesBetween('2026-10-31', '2026-11-02')).toHaveLength(3);
    expect(datesBetween('2026-10-09', '2026-10-08')).toEqual([]);
  });

  it('[RWD-05] finds the household week a day falls in, for any first day of the week', () => {
    // Friday, Oct 9, 2026.
    expect(weekOf('2026-10-09', 0)).toBe('2026-10-04'); // weeks start on Sunday
    expect(weekOf('2026-10-09', 1)).toBe('2026-10-05'); // on Monday
    expect(weekOf('2026-10-09', 5)).toBe('2026-10-09'); // on Friday: its own first day
    expect(weekOf('2026-10-09', 6)).toBe('2026-10-03'); // on Saturday
    expect(weekOf('2026-10-04', 0)).toBe('2026-10-04');
    expect(weekOf('2026-10-04', 1)).toBe('2026-09-28');
    // Before 1970 too.
    expect(weekOf('1969-12-31', 0)).toBe('1969-12-28');
  });
});
