import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ReminderSettings } from './reminder-settings';
import {
  adminsLine,
  archiveLine,
  archivedLine,
  checkOffsLine,
  closuresLine,
  cutoffLine,
  devicesFacts,
  errorsLine,
  type FoldLine,
  followersLine,
  invitesWaiting,
  jobsFacts,
  remindLine,
  termsLine,
  usageFacts,
  weatherFacts,
  weekLine,
  yearLine,
} from './setup-facts';

// [NFR-18][D-120] The set-up pages' folded headers (WP-94): what each says while folded.

/** A line as it reads, the bold parts in **. */
const read = (line: FoldLine) =>
  line.map((p) => (typeof p === 'string' ? p : `**${p.b}**`)).join('');

const NY = 'America/New_York';
/** Thursday, Oct 15, 2026 at 2:45 pm in New York. */
const NOW = new Date('2026-10-15T18:45:00Z');

describe('Family options', () => {
  it('[NFR-18-k] the week: its start day, and a change waiting with the day it starts', () => {
    expect(read(weekLine(0, null))).toBe('**Starts on Sunday**');
    expect(read(weekLine(0, { day: 1, on: '2026-10-19' }))).toBe(
      '**Starts on Sunday** · from Monday, Oct 19 it starts on Monday',
    );
  });

  it('[NFR-18-k] check-offs in words, either way', () => {
    expect(read(checkOffsLine('off'))).toBe(
      '**A child’s check-off counts straight away**; a parent can uncheck it later',
    );
    expect(read(checkOffsLine('on'))).toBe(
      '**A child’s check-off waits for a parent** to approve it',
    );
  });

  it('[NFR-18-k] the admins by name and role; one with no member by their email', () => {
    expect(
      read(
        adminsLine([
          { name: 'Alex', role: 'owner' },
          { name: 'sam@example.com', role: 'admin' },
        ]),
      ),
    ).toBe('**Alex** (Owner) · **sam@example.com** (Admin)');
  });

  it('[NFR-18-k] the invites waiting and when the soonest runs out, or none', () => {
    expect(invitesWaiting([], NOW, NY)).toBeNull();
    expect(invitesWaiting(['2026-10-17T20:00:00Z'], NOW, NY)).toBe(
      '1 waiting · runs out in 2 days',
    );
    expect(invitesWaiting(['2026-10-22T20:00:00Z', '2026-10-16T13:00:00Z'], NOW, NY)).toBe(
      '2 waiting · runs out tomorrow',
    );
    expect(invitesWaiting(['2026-10-15T23:00:00Z'], NOW, NY)).toBe('1 waiting · runs out today');
    expect(invitesWaiting(['2026-10-21T13:00:00Z'], NOW, NY)).toBe(
      '1 waiting · runs out in 6 days',
    );
  });

  const reading = {
    temperature: 61.2,
    unit: 'fahrenheit' as const,
    readAt: '2026-10-15T18:10:00Z',
  };

  it('[NFR-18-l] the weather: the place, the unit and the last reading', () => {
    const w = weatherFacts(
      { place: 'Springfield, IL', unit: 'fahrenheit', last: { ...reading, failedAt: null } },
      NOW,
      NY,
    );
    expect(read(w.line)).toBe('**Springfield, IL** · °F · last reading 61°F');
    expect(w.warning).toBeNull();
    expect(
      read(
        weatherFacts(
          {
            place: 'Leeds',
            unit: 'celsius',
            last: { temperature: 11.6, unit: 'celsius', readAt: reading.readAt, failedAt: null },
          },
          NOW,
          NY,
        ).line,
      ),
    ).toBe('**Leeds** · °C · last reading 12°C');
  });

  it('[NFR-18-l] a failed read is the warning, with when it last read well', () => {
    const failed = (readAt: string) =>
      weatherFacts(
        {
          place: 'Springfield, IL',
          unit: 'fahrenheit',
          last: { ...reading, readAt, failedAt: '2026-10-15T18:40:00Z' },
        },
        NOW,
        NY,
      ).warning;
    expect(failed('2026-10-15T18:10:00Z')).toBe('Not updated since 2:10 pm');
    expect(failed('2026-10-14T21:00:00Z')).toBe('Not updated since yesterday');
    expect(failed('2026-10-12T21:00:00Z')).toBe('Not updated since Mon, Oct 12 at 5:00 pm');
  });

  it('[NFR-18-l] with no place, not shown on the boards; a place not read yet says so', () => {
    expect(weatherFacts({ place: null, unit: 'fahrenheit', last: null }, NOW, NY)).toEqual({
      line: ['Not shown on the boards'],
      warning: null,
    });
    expect(
      read(
        weatherFacts({ place: 'Springfield, IL', unit: 'fahrenheit', last: null }, NOW, NY).line,
      ),
    ).toBe('**Springfield, IL** · °F · not read yet');
  });
});

describe('School', () => {
  it('[NFR-18-m] the lunch cut-off, and Archived by count and name', () => {
    expect(read(cutoffLine('08:00'))).toBe('**Today’s lunch can change until 8:00 am**');
    expect(read(cutoffLine('13:30'))).toBe('**Today’s lunch can change until 1:30 pm**');
    expect(read(archivedLine(['Lincoln 2025–26']))).toBe('**1 archived:** Lincoln 2025–26');
  });

  const closures = [
    { name: 'Teacher day', startDate: '2026-10-23', endDate: '2026-10-23' },
    { name: 'Thanksgiving break', startDate: '2026-11-25', endDate: '2026-11-27' },
  ];
  const days = [
    { day: '2026-10-22', dayType: 'school_day' },
    { day: '2026-10-23', dayType: 'no_school' },
    { day: '2026-11-24', dayType: 'school_day' },
    { day: '2026-11-25', dayType: 'break' },
    { day: '2026-11-26', dayType: 'break' },
    { day: '2026-11-27', dayType: 'break' },
    { day: '2026-11-28', dayType: 'weekend' },
  ];

  it('[NFR-18-m] a year’s days off: how many, and the next from today, or none still to come', () => {
    expect(read(closuresLine(days, closures, '2026-10-15'))).toBe(
      '**4 days off** · next: Teacher day, Fri, Oct 23',
    );
    expect(read(closuresLine(days, closures, '2026-11-26'))).toBe(
      '**4 days off** · now: Thanksgiving break, Wed, Nov 25',
    );
    expect(read(closuresLine(days, closures, '2026-12-01'))).toBe(
      '**4 days off** · none still to come',
    );
    expect(closuresLine(days, [], '2026-10-15')).toEqual(['None yet']);
  });

  it('[NFR-18-m] terms, who follows it, its dates and school, and what archiving does', () => {
    expect(read(termsLine(['Fall', 'Spring']))).toBe('**2 terms:** Fall, Spring');
    expect(read(termsLine(['Fall']))).toBe('**1 term:** Fall');
    expect(termsLine([])).toEqual(['None yet']);
    expect(read(followersLine(['Maya', 'Leo'], true))).toBe('**Maya, Leo**');
    expect(followersLine([], true)).toEqual(['Everyone not given another year']);
    expect(followersLine([], false)).toEqual(['Nobody yet']);
    expect(
      yearLine({
        startDate: '2026-08-26',
        endDate: '2027-06-11',
        schoolName: 'Lincoln Elementary',
      }),
    ).toBe('Aug 26, 2026 to Jun 11, 2027 · Lincoln Elementary');
    expect(yearLine({ startDate: '2026-08-26', endDate: '2027-06-11', schoolName: null })).toBe(
      'Aug 26, 2026 to Jun 11, 2027',
    );
    expect(archiveLine(false)).toBe('Stops it applying; its days off stay as a record');
    expect(archiveLine(true)).toBe('It applies again; anyone given it follows it again');
  });
});

describe('Reminders', () => {
  const at = (lastSuccessAt: string | null, enabled = true) => ({ enabled, lastSuccessAt });

  it('[NFR-18-n] devices: how many, on or off, and when one was last reached', () => {
    expect(
      read(
        devicesFacts([at('2026-10-15T13:14:00Z'), at('2026-10-14T20:00:00Z')], false, NOW, NY).line,
      ),
    ).toBe('**2 devices**, both on · last reached 9:14 am');
    expect(
      read(devicesFacts([at('2026-10-14T20:00:00Z'), at(null, false)], false, NOW, NY).line),
    ).toBe('**2 devices**, 1 on, 1 off · last reached yesterday');
    expect(read(devicesFacts([at(null, false)], false, NOW, NY).line)).toBe(
      '**1 device**, off · not reached yet',
    );
    expect(
      read(devicesFacts([at(null, false), at(null, false), at(null, false)], false, NOW, NY).line),
    ).toBe('**3 devices**, all off · not reached yet');
    expect(devicesFacts([], false, NOW, NY)).toEqual({ line: ['None yet'], warning: null });
  });

  it('[NFR-18-n] a device just removed is the warning', () => {
    expect(devicesFacts([at('2026-10-15T13:14:00Z')], true, NOW, NY).warning).toBe('1 removed');
    expect(devicesFacts([], true, NOW, NY).warning).toBe('1 removed');
  });

  it('[NFR-18-n] when to remind me, each setting in one line, either way', () => {
    const on: ReminderSettings = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      defaultLeadMinutes: 15,
      morningTime: '08:00',
      digestTime: '07:00',
      quietStart: '21:30',
      quietEnd: '06:30',
      approvalAlerts: true,
    };
    expect(remindLine(on)).toBe(
      '15 minutes before · no due time at 8:00 am · digest at 7:00 am · quiet 9:30 pm to 6:30 am · approvals on',
    );
    expect(
      remindLine({
        ...on,
        defaultLeadMinutes: 0,
        digestTime: null,
        quietStart: null,
        quietEnd: null,
        approvalAlerts: false,
      }),
    ).toBe('at the due time · no due time at 8:00 am · no digest · no quiet hours · approvals off');
  });
});

describe('Health', () => {
  it('[NFR-18-o] jobs: how many run fine and fail, each failing or late job by name', () => {
    const f = jobsFacts([
      { label: 'Calendar sync', state: 'failing' },
      { label: 'Day close', state: 'ok' },
      { label: 'Reminders', state: 'running' },
      { label: 'Weather', state: 'stale' },
      { label: 'Purge history', state: 'never' },
    ]);
    expect(read(f.line)).toBe('**2 running fine** · 1 failing · 1 late · 1 not run yet');
    expect(f.warning).toBe('Calendar sync: Failing · Weather: Late');
    expect(jobsFacts([{ label: 'Day close', state: 'ok' }]).warning).toBeNull();
    expect(jobsFacts([])).toEqual({ line: ['None scheduled yet'], warning: null });
  });

  it('[NFR-18-o] server errors in 30 days and the latest, or none', () => {
    expect(read(errorsLine(['2026-10-02T23:41:00Z', '2026-10-14T22:02:00Z'], 20, NY))).toBe(
      '**2 in the last 30 days** · latest Oct 14',
    );
    expect(read(errorsLine(Array(20).fill('2026-10-14T22:02:00Z'), 20, NY))).toBe(
      '**20 or more in the last 30 days** · latest Oct 14',
    );
    expect(errorsLine([], 20, NY)).toEqual(['None in the last 30 days']);
  });

  it('[NFR-18-o] usage: the highest share of a free plan; a limit near is the warning', () => {
    const lines = [
      { label: 'Database', share: 0.31, warn: false },
      { label: 'Function calls', share: 0.12, warn: false },
      { label: 'Data transfer', share: null, warn: false },
    ];
    expect(usageFacts(lines)).toEqual({
      line: [{ b: 'Highest: Database' }, ', 31% of the free plan'],
      warning: null,
    });
    const near = usageFacts([...lines, { label: 'Active CPU', share: 0.875, warn: true }]);
    expect(read(near.line)).toBe('**Highest: Active CPU**, 88% of the free plan');
    expect(near.warning).toBe('Near a limit: Active CPU');
    expect(usageFacts([])).toEqual({ line: ['Not read yet'], warning: null });
  });
});

describe('the household’s days', () => {
  it('[NFR-18-p] an invite’s days left count the household’s days, across midnight UTC', () => {
    // 11:30 pm in New York is 3:30 am UTC the next day: still Thursday at home.
    const late = new Date('2026-10-16T03:30:00Z');
    expect(invitesWaiting(['2026-10-16T13:00:00Z'], late, NY)).toBe(
      '1 waiting · runs out tomorrow',
    );
    // And at 12:30 am Friday at home, Friday's run-out is today.
    expect(invitesWaiting(['2026-10-16T13:00:00Z'], new Date('2026-10-16T04:30:00Z'), NY)).toBe(
      '1 waiting · runs out today',
    );
  });

  it('[NFR-18-p] across the end of daylight saving, a day is still a day', () => {
    // Sunday, Nov 1, 2026: New York's clocks go back at 2 am. Saturday 10 pm to Monday 9 am.
    const sat = new Date('2026-11-01T02:00:00Z');
    expect(invitesWaiting(['2026-11-02T14:00:00Z'], sat, NY)).toBe(
      '1 waiting · runs out in 2 days',
    );
    // A device reached at 11:30 pm Saturday (EDT) reads as yesterday on Sunday after the change.
    const sun = new Date('2026-11-01T15:00:00Z');
    expect(
      read(
        devicesFacts([{ enabled: true, lastSuccessAt: '2026-11-01T03:30:00Z' }], false, sun, NY)
          .line,
      ),
    ).toBe('**1 device**, on · last reached yesterday');
    expect(
      read(
        devicesFacts([{ enabled: true, lastSuccessAt: '2026-11-01T06:30:00Z' }], false, sun, NY)
          .line,
      ),
    ).toBe('**1 device**, on · last reached 1:30 am');
  });

  it('[NFR-18-p] a server error’s day is the household’s, not UTC’s', () => {
    // 10:02 pm Oct 14 in New York is Oct 15 in UTC.
    expect(read(errorsLine(['2026-10-15T02:02:00Z'], 20, NY))).toBe(
      '**1 in the last 30 days** · latest Oct 14',
    );
  });
});
