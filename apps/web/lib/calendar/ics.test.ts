import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandIcs, icsUrl, scrubIcs } from './ics';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const synthetic = fixture('synthetic.ics');
// The shape iCloud publishes (SPIKE-02: its properties, zone block and rule kinds), made-up events.
const icloud = fixture('icloud-shape.ics');
const AUTUMN = { from: '2026-10-01', to: '2027-01-01', timeZone: 'America/Chicago' };

describe('published calendar links', () => {
  it('[CAL-01] fetches a webcal link Apple shares over https', () => {
    expect(icsUrl(' webcal://p01-caldav.icloud.com/published/2/abc ').href).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    );
    expect(icsUrl('https://example.com/a.ics').protocol).toBe('https:');
    expect(() => icsUrl('http://example.com/a.ics')).toThrow('https or webcal');
  });
});

describe('expanding a calendar', () => {
  const all = expandIcs(synthetic, AUTUMN);
  const weekly = all.filter((i) => i.uid === 'weekly@synthetic');

  it('[CAL-07] a weekly series keeps its local time across the end of daylight saving', () => {
    expect(weekly.map((i) => i.start)).toEqual([
      '2026-10-13T22:00:00.000Z', // 5 pm CDT
      '2026-10-20T22:00:00.000Z',
      '2026-10-28T22:00:00.000Z', // moved from the 27th
      '2026-11-03T23:00:00.000Z', // 5 pm CST, after Nov 1
      '2026-11-17T23:00:00.000Z', // the 10th was cancelled
      '2026-11-24T23:00:00.000Z',
      '2026-12-01T23:00:00.000Z',
    ]);
    expect(weekly.every((i) => Date.parse(i.end) - Date.parse(i.start) === 3_600_000)).toBe(true);
  });

  it('[CAL-07] a moved instance replaces the original, and only it is marked as changed', () => {
    expect(weekly.filter((i) => i.changed).map((i) => i.start)).toEqual([
      '2026-10-28T22:00:00.000Z',
    ]);
  });

  it('[CAL-07] all-day events are dates, the end exclusive; a missing end means one day', () => {
    expect(all.filter((i) => i.allDay).map((i) => [i.title, i.start, i.end])).toEqual([
      ['Day off', '2026-10-23', '2026-10-24'],
      ['Trip', '2026-11-26', '2026-11-30'],
      ['One day without an end', '2026-12-31', '2027-01-01'],
    ]);
  });

  it('[CAL-07] only instances that overlap the window are returned', () => {
    const november = expandIcs(synthetic, { ...AUTUMN, from: '2026-11-01', to: '2026-11-27' });
    expect(november.map((i) => i.title)).toEqual(['Weekly', 'Weekly', 'Weekly', 'Trip']);
  });
});

describe('fixtures from a real calendar', () => {
  const scrubbed = scrubIcs(synthetic);

  it('removes personal details: places, notes, people, alarms and Apple extras', () => {
    for (const gone of [
      'Somewhere private',
      'Personal note',
      'someone@example.com',
      'VALARM',
      'X-APPLE',
      'Synthetic',
      '@synthetic',
    ]) {
      expect(scrubbed).not.toContain(gone);
    }
  });

  it('[CAL-07] keeps the calendar shape: the same instances, titled by the order series start', () => {
    const before = expandIcs(synthetic, AUTUMN);
    const after = expandIcs(scrubbed, AUTUMN);
    expect(
      after.map(({ start, end, allDay, changed }) => ({ start, end, allDay, changed })),
    ).toEqual(before.map(({ start, end, allDay, changed }) => ({ start, end, allDay, changed })));
    expect([...new Set(after.map((i) => i.title))]).toEqual([
      'Event 1',
      'Event 2',
      'Event 3',
      'Event 4',
    ]);
    expect(after[0]).toMatchObject({ uid: 'event-1@familywise.test', title: 'Event 1' });
  });
});

describe('the shape iCloud publishes (SPIKE-02)', () => {
  const detroit = { from: '2026-10-01', to: '2027-01-01', timeZone: 'America/Detroit' };
  const all = expandIcs(icloud, detroit);
  const of = (title: string) => all.filter((i) => i.title === title);

  it('[CAL-07] a weekly series from last year keeps 8 pm across the Nov 1 change; the moved one moves', () => {
    const weekly = of('Weekly evening');
    expect(weekly.find((i) => i.start === '2026-10-21T00:00:00.000Z')).toBeTruthy(); // Oct 20, 8 pm EDT
    expect(weekly.find((i) => i.start === '2026-11-04T01:00:00.000Z')).toBeTruthy(); // Nov 3, 8 pm EST
    expect(weekly.filter((i) => i.changed).map((i) => i.start)).toEqual([
      '2026-10-28T23:30:00.000Z', // Oct 28, 7:30 pm EDT instead of Oct 27
    ]);
    expect(weekly.some((i) => i.start === '2026-10-28T00:00:00.000Z')).toBe(false);
  });

  it('[CAL-07] yearly all-day events, ordinal and set-position monthly rules, and UTC times', () => {
    expect(of('Yearly day').map((i) => [i.start, i.end])).toEqual([['2026-11-12', '2026-11-13']]);
    expect(of('Every other month, second Monday').map((i) => i.start)).toEqual([
      '2026-11-09T23:00:00.000Z',
    ]);
    expect(of('Twice a year, first Saturday').map((i) => i.start)).toEqual([
      '2026-11-07T15:00:00.000Z',
    ]);
    expect(of('Set in UTC').map((i) => [i.start, i.end])).toEqual([
      ['2026-10-29T16:30:00.000Z', '2026-10-29T17:30:00.000Z'],
    ]);
    expect(of('Several days').map((i) => [i.start, i.end])).toEqual([['2026-12-26', '2026-12-30']]);
  });

  it('scrubbing drops everything personal Apple adds: place, travel, notes, people, links', () => {
    const scrubbed = scrubIcs(icloud);
    for (const gone of [
      'Example Place',
      'Example Street',
      'never reach',
      'person@example.com',
      'example.com/meeting',
      'X-APPLE-STRUCTURED-LOCATION',
      'X-APPLE-TRAVEL-START',
      'geo:',
    ]) {
      expect(scrubbed).not.toContain(gone);
    }
    expect(expandIcs(scrubbed, detroit)).toHaveLength(all.length);
  });
});
