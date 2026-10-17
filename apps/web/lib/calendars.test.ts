import { describe, expect, it } from 'vitest';
import {
  calendarFacts,
  calendarSaveMessage,
  LINK_HELP,
  parseCalendar,
  syncStatus,
  whenWords,
  whoFor,
  type UpcomingEvent,
} from './calendars';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const NY = 'America/New_York';

describe('the calendar form', () => {
  it('[CAL-01] takes the webcal link Apple shares, as the https address to fetch', () => {
    expect(
      parseCalendar(
        form({
          name: '  Family   calendar ',
          url: ' webcal://p01-caldav.icloud.com/published/2/made-up ',
          color: 'member-3',
          wholeFamily: 'on',
          showOnBoard: 'on',
        }),
        true,
      ),
    ).toEqual({
      ok: true,
      value: {
        name: 'Family calendar',
        url: 'https://p01-caldav.icloud.com/published/2/made-up',
        color: 'member-3',
        memberIds: [],
        showOnBoard: true,
      },
    });
  });

  it('[CAL-01] a new calendar needs its link; an edit without one keeps the old', () => {
    expect(parseCalendar(form({ name: 'Family', color: 'member-1' }), true)).toEqual({
      ok: false,
      message: LINK_HELP,
    });
    const kept = parseCalendar(
      form({
        name: 'Family',
        color: 'member-1',
        memberIds: 'f1000000-0000-4000-8000-000000000001',
      }),
      false,
    );
    expect(kept).toMatchObject({
      ok: true,
      value: { url: null, memberIds: ['f1000000-0000-4000-8000-000000000001'], showOnBoard: false },
    });
  });

  it('[CAL-01] refuses what isn’t a published link, a bad name, color or person', () => {
    for (const url of ['http://example.com/a.ics', 'not a link', 'https://192.168.1.4/cal.ics']) {
      expect(parseCalendar(form({ name: 'A', url, color: 'member-1' }), true)).toEqual({
        ok: false,
        message: LINK_HELP,
      });
    }
    const good = { url: 'webcal://example.com/a.ics', color: 'member-1' };
    expect(parseCalendar(form({ ...good, name: '' }), true)).toMatchObject({ ok: false });
    expect(parseCalendar(form({ ...good, name: 'x'.repeat(41) }), true)).toMatchObject({
      ok: false,
    });
    expect(parseCalendar(form({ ...good, name: 'A', color: '#ff0000' }), true)).toEqual({
      ok: false,
      message: 'Choose a color.',
    });
    expect(parseCalendar(form({ ...good, name: 'A', memberIds: 'Ava' }), true)).toEqual({
      ok: false,
      message: 'Choose who it’s for.',
    });
  });

  it('[CAL-09-d] any number of people, a tick each; The whole family ticked is no one', () => {
    const f = form({ name: 'Kids', color: 'member-8' });
    f.append('memberIds', 'f1000000-0000-4000-8000-000000000001');
    f.append('memberIds', 'f1000000-0000-4000-8000-000000000002');
    f.append('memberIds', 'f1000000-0000-4000-8000-000000000001');
    expect(parseCalendar(f, false)).toMatchObject({
      ok: true,
      value: {
        memberIds: ['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002'],
      },
    });
    f.set('wholeFamily', 'on');
    expect(parseCalendar(f, false)).toMatchObject({ ok: true, value: { memberIds: [] } });
    expect(parseCalendar(form({ name: 'Kids', color: 'member-8' }), false)).toMatchObject({
      ok: true,
      value: { memberIds: [] },
    });
  });

  it('says what the database refused in plain words', () => {
    expect(calendarSaveMessage({ hint: 'bad_link' })).toBe(LINK_HELP);
    expect(calendarSaveMessage({ hint: 'not_found' })).toBe(
      'That calendar was removed. Reload the page.',
    );
    expect(calendarSaveMessage({ code: '23503' })).toBe(
      'Choose someone who is still in the family.',
    );
    expect(calendarSaveMessage({ code: '42501' })).toBe('That didn’t save. Try again in a moment.');
  });
});

describe('a calendar’s sync, in words', () => {
  it('[US-505] synced, with when', () => {
    expect(
      syncStatus(
        {
          status: 'ok',
          lastSyncedAt: '2026-10-20T16:03:00Z',
          lastSuccessAt: '2026-10-20T16:03:00Z',
          lastError: null,
        },
        NY,
      ),
    ).toEqual({
      kind: 'ok',
      label: 'Synced',
      detail: 'Last synced Tue, Oct 20 at 12:03 pm. It syncs every 15 minutes.',
    });
  });

  it('[CAL-06][US-505] failing: the error, and that the board keeps the last good events', () => {
    const failing = {
      status: 'error' as const,
      lastSyncedAt: '2026-10-20T16:03:00Z',
      lastError: 'Couldn’t reach the link.',
    };
    expect(syncStatus({ ...failing, lastSuccessAt: '2026-10-19T21:48:00Z' }, NY)).toEqual({
      kind: 'error',
      label: 'Can’t sync',
      detail:
        'Couldn’t reach the link. Last good sync Mon, Oct 19 at 5:48 pm: the board keeps showing its events.',
    });
    expect(syncStatus({ ...failing, lastSuccessAt: null }, NY).detail).toBe(
      'Couldn’t reach the link. No events yet.',
    );
  });

  it('[CAL-01] not synced yet', () => {
    expect(
      syncStatus(
        { status: 'pending', lastSyncedAt: null, lastSuccessAt: null, lastError: null },
        NY,
      ),
    ).toEqual({ kind: 'pending', label: 'Not synced yet', detail: 'It syncs within 15 minutes.' });
  });
});

describe('when an event is', () => {
  const event = (over: Partial<UpcomingEvent>): UpcomingEvent => ({
    id: 'e',
    title: 'E',
    allDay: false,
    start: '2026-11-03T22:00:00Z',
    end: '2026-11-03T23:00:00Z',
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    changed: false,
    ...over,
  });

  it('[CAL-07] a timed event at its household-local time', () => {
    expect(whenWords(event({}), NY)).toBe('Tue, Nov 3 · 5:00 pm');
  });

  it('[CAL-07] an all-day event on its own dates, in any zone', () => {
    const trip = event({ allDay: true, startDate: '2026-11-25', endDate: '2026-11-28' });
    expect(whenWords(trip, NY)).toBe('Wed, Nov 25 – Sat, Nov 28 · All day');
    expect(whenWords(trip, 'Pacific/Kiritimati')).toBe('Wed, Nov 25 – Sat, Nov 28 · All day');
    expect(
      whenWords(event({ allDay: true, startDate: '2026-10-23', endDate: '2026-10-23' }), NY),
    ).toBe('Fri, Oct 23 · All day');
  });
});

// [CAL-09][US-508] Who a calendar is for, in words (WP-50).
describe('who a calendar is for', () => {
  const members = [
    { id: 'maya', displayName: 'Maya' },
    { id: 'leo', displayName: 'Leo' },
    { id: 'alex', displayName: 'Alex' },
    { id: 'kit', displayName: 'Kit', archived: true },
  ];

  it('[CAL-09-d] the whole family, one person’s, or a list in the family’s order', () => {
    expect(whoFor([], members)).toBe('The whole family');
    expect(whoFor(['alex'], members)).toBe('Alex’s');
    expect(whoFor(['leo', 'maya'], members)).toBe('Maya and Leo');
    expect(whoFor(['alex', 'leo', 'maya'], members)).toBe('Maya, Leo and Alex');
  });

  it('[CAL-09-d] someone archived is named so; someone gone is left out', () => {
    expect(whoFor(['maya', 'kit'], members)).toBe('Maya and Kit (archived)');
    expect(whoFor(['gone'], members)).toBe('The whole family');
  });
});

// [NFR-18][D-120] A calendar's folded header on Calendars (WP-93).
describe('a calendar’s folded header', () => {
  const members = [
    { id: 'maya', displayName: 'Maya' },
    { id: 'leo', displayName: 'Leo' },
    { id: 'kit', displayName: 'Kit', archived: true },
  ];
  /** Tue, Oct 20, 2026, 12:15 pm in New York. */
  const NOW = Date.parse('2026-10-20T16:15:00Z');
  const base = {
    memberIds: [] as string[],
    showOnBoard: true,
    status: 'ok' as const,
    lastSyncedAt: '2026-10-20T16:03:00Z',
    lastSuccessAt: '2026-10-20T16:03:00Z',
    upcomingCount: 23,
  };

  it('[NFR-18-a][CAL-06][CAL-09] who it’s for, its sync and how many events are coming up', () => {
    expect(calendarFacts(base, members, NOW, NY)).toEqual({
      meta: 'The whole family · Synced 12 min ago · 23 events coming up',
      warning: null,
    });
    expect(
      calendarFacts({ ...base, memberIds: ['maya'], upcomingCount: 1 }, members, NOW, NY).meta,
    ).toBe('Maya’s · Synced 12 min ago · 1 event coming up');
    expect(
      calendarFacts(
        { ...base, lastSyncedAt: '2026-10-20T16:14:40Z', upcomingCount: 0 },
        members,
        NOW,
        NY,
      ).meta,
    ).toBe('The whole family · Synced just now · nothing coming up');
    expect(
      calendarFacts({ ...base, lastSyncedAt: '2026-10-18T21:48:00Z' }, members, NOW, NY).meta,
    ).toBe('The whole family · Synced Sun, Oct 18 at 5:48 pm · 23 events coming up');
  });

  it('[NFR-18-a][CAL-05] one hidden from the boards says so; one not synced yet says that', () => {
    expect(
      calendarFacts(
        {
          ...base,
          memberIds: ['maya', 'kit'],
          showOnBoard: false,
          status: 'pending',
          lastSyncedAt: null,
          lastSuccessAt: null,
          upcomingCount: 0,
        },
        members,
        NOW,
        NY,
      ),
    ).toEqual({
      meta: 'Maya and Kit (archived) · Not on the boards · Not synced yet · nothing coming up',
      warning: null,
    });
  });

  it('[NFR-18-b][CAL-06][US-505] one that can’t sync has the warning and says when it last synced', () => {
    expect(
      calendarFacts(
        {
          ...base,
          memberIds: ['maya', 'leo'],
          status: 'error',
          lastSuccessAt: '2026-10-20T13:15:00Z',
          upcomingCount: 2,
        },
        members,
        NOW,
        NY,
      ),
    ).toEqual({
      meta: 'Maya and Leo · last synced 3 h ago · 2 events coming up',
      warning: 'Can’t sync',
    });
    expect(
      calendarFacts(
        { ...base, status: 'error', lastSuccessAt: null, upcomingCount: 0 },
        members,
        NOW,
        NY,
      ),
    ).toEqual({
      meta: 'The whole family · never synced · nothing coming up',
      warning: 'Can’t sync',
    });
  });

  it('[NFR-18-e] its times across midnight UTC and the end of daylight saving', () => {
    // 11:30 pm in New York is 3:30 am UTC: a sync a day ago is named by New York's day and time.
    expect(
      calendarFacts(
        { ...base, lastSyncedAt: '2026-10-20T03:30:00Z' },
        members,
        Date.parse('2026-10-21T04:00:00Z'),
        NY,
      ).meta,
    ).toBe('The whole family · Synced Mon, Oct 19 at 11:30 pm · 23 events coming up');
    // Sunday, Nov 1, 2026: 1:30 am EDT to 7:00 am EST is six and a half hours, not five and a half.
    expect(
      calendarFacts(
        { ...base, lastSyncedAt: '2026-11-01T05:30:00Z' },
        members,
        Date.parse('2026-11-01T12:00:00Z'),
        NY,
      ).meta,
    ).toBe('The whole family · Synced 6 h ago · 23 events coming up');
  });
});
