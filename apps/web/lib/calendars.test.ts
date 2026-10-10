import { describe, expect, it } from 'vitest';
import {
  calendarSaveMessage,
  LINK_HELP,
  parseCalendar,
  syncStatus,
  whenWords,
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
          memberId: '',
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
        memberId: null,
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
      form({ name: 'Family', color: 'member-1', memberId: 'f1000000-0000-4000-8000-000000000001' }),
      false,
    );
    expect(kept).toMatchObject({
      ok: true,
      value: { url: null, memberId: 'f1000000-0000-4000-8000-000000000001', showOnBoard: false },
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
    expect(parseCalendar(form({ ...good, name: 'A', memberId: 'Ava' }), true)).toEqual({
      ok: false,
      message: 'Choose whose calendar it is.',
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
