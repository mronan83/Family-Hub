import { describe, expect, it } from 'vitest';
import {
  countDayTypes,
  monthGrid,
  parseClosure,
  parseSchoolYear,
  parseTerm,
  schoolSaveMessage,
  weekdayHeadings,
  type Day,
} from './school';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe('parseSchoolYear', () => {
  it('[SCH-01] reads a default school year with its school', () => {
    expect(
      parseSchoolYear(
        form({
          name: ' 2026–27 ',
          schoolName: 'Demo Elementary',
          startDate: '2026-08-24',
          endDate: '2027-06-11',
          isDefault: 'on',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        name: '2026–27',
        schoolName: 'Demo Elementary',
        startDate: '2026-08-24',
        endDate: '2027-06-11',
        isDefault: true,
      },
    });
  });

  it('[SCH-01] the school is optional and a year need not be the default', () => {
    const parsed = parseSchoolYear(
      form({ name: 'Camp', schoolName: '', startDate: '2027-06-21', endDate: '2027-08-13' }),
    );
    expect(parsed.ok && [parsed.value.schoolName, parsed.value.isDefault]).toEqual([null, false]);
  });

  it('[SCH-01] says what to fix', () => {
    const base = { name: '2026–27', startDate: '2026-08-24', endDate: '2027-06-11' };
    const cases: [Record<string, string>, string][] = [
      [{ name: '' }, 'Give the school year a name of up to 40 characters.'],
      [{ startDate: '' }, 'Choose a start date.'],
      [{ endDate: '2027-02-30' }, 'Choose an end date.'],
      [{ endDate: '2026-08-01' }, 'The end date is before the start date.'],
      [{ endDate: '2026-08-24' }, 'The last day comes after the first day.'],
      [{ endDate: '2027-12-31' }, 'A school year can be up to about 13 months long.'],
      [{ schoolName: 'x'.repeat(81) }, 'Keep the school’s name under 80 characters.'],
    ];
    for (const [change, message] of cases) {
      expect(parseSchoolYear(form({ ...base, ...change })), message).toEqual({
        ok: false,
        message,
      });
    }
  });
});

describe('parseClosure and parseTerm', () => {
  it('[SCH-01] a one-day closure needs no end date', () => {
    expect(
      parseClosure(form({ name: 'Snow day', closureType: 'snow_day', startDate: '2027-01-11' })),
    ).toEqual({
      ok: true,
      value: {
        name: 'Snow day',
        closureType: 'snow_day',
        startDate: '2027-01-11',
        endDate: '2027-01-11',
      },
    });
  });

  it('[SCH-01] a break spans several days; its kind is from the list', () => {
    const parsed = parseClosure(
      form({
        name: 'Winter break',
        closureType: 'break',
        startDate: '2026-12-21',
        endDate: '2027-01-01',
      }),
    );
    expect(parsed.ok && parsed.value.endDate).toBe('2027-01-01');
    expect(
      parseClosure(form({ name: 'Trip', closureType: 'trip', startDate: '2026-11-02' })),
    ).toEqual({ ok: false, message: 'Choose what kind of day off it is.' });
  });

  it('[SCH-01] a term has a name and both dates', () => {
    expect(
      parseTerm(form({ name: 'Fall', startDate: '2026-08-24', endDate: '2026-12-18' })),
    ).toEqual({
      ok: true,
      value: { name: 'Fall', startDate: '2026-08-24', endDate: '2026-12-18' },
    });
    expect(parseTerm(form({ name: 'Fall', startDate: '2026-08-24' })).ok).toBe(false);
  });

  it('[SCH-01] maps the database hints to lines for the admin', () => {
    expect(schoolSaveMessage({ hint: 'default_year_overlap' })).toMatch(/can’t overlap/);
    expect(schoolSaveMessage({ hint: 'outside_school_year' })).toMatch(/outside the school year/);
    expect(schoolSaveMessage({ hint: 'year_excludes_dates' })).toMatch(/Move or remove it first/);
    expect(schoolSaveMessage({ hint: 'profile_overlap' })).toMatch(/another school year/);
    expect(schoolSaveMessage({ code: '08006' })).toBe('That didn’t save. Try again in a moment.');
  });
});

describe('the timeline', () => {
  const days = (from: string, n: number, type: Day['dayType'] = 'school_day'): Day[] =>
    Array.from({ length: n }, (_, i) => ({
      day: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      dayType: type,
    }));

  it('[SCH-01] lays days out in months, weeks starting on the household’s week start', () => {
    // 2026-08-24 is a Monday; August ends on the Monday of the next week.
    const months = monthGrid(days('2026-08-24', 10), 0);
    expect(months.map((m) => m.label)).toEqual(['August 2026', 'September 2026']);
    expect(months[0]!.weeks.map((w) => w.map((c) => c?.day.slice(8) ?? '..'))).toEqual([
      ['..', '24', '25', '26', '27', '28', '29'],
      ['30', '31', '..', '..', '..', '..', '..'],
    ]);
    // September 2026 starts on a Tuesday.
    expect(months[1]!.weeks[0]!.map((c) => c?.day.slice(8) ?? '..')).toEqual([
      '..',
      '..',
      '01',
      '02',
      '..',
      '..',
      '..',
    ]);
    // Weeks starting on Monday.
    expect(monthGrid(days('2026-08-24', 7), 1)[0]!.weeks[0]![0]!.day).toBe('2026-08-24');
    expect(weekdayHeadings(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('[SCH-01] counts each kind of day', () => {
    expect(
      countDayTypes([...days('2026-12-21', 5, 'break'), ...days('2026-12-26', 2, 'weekend')]),
    ).toEqual({ school_day: 0, no_school: 0, break: 5, weekend: 2, summer: 0 });
  });
});
