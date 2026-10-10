import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readIcs } from './ics';
import {
  fetchCalendar,
  httpError,
  MAX_BYTES,
  runCalendarSync,
  SYNC_ERRORS,
  syncSource,
  syncWindow,
  type Fetcher,
} from './sync';

// [CAL-02][CAL-06][CAL-07] The sync (WP-22, D-63) against a made-up family calendar in New York
// (family-sync.ics): a weekly series across the November clock change with one instance moved, one
// moved months ahead, one deleted (EXDATE) and one cancelled; a monthly series; all-day events with
// and without an end; a cancelled event; a UTC flight over the change; an event with personal details;
// one long ago. The database side is pinned by 260_calendar_sync.test.sql.
const ics = readFileSync(new URL('./__fixtures__/family-sync.ics', import.meta.url), 'utf8');
const NY = 'America/New_York';
// Tuesday, Oct 20 2026, noon in New York: the window is Oct 13 .. Feb 17 (Feb 18 exclusive).
const NOW = new Date('2026-10-20T16:00:00Z');
const window = syncWindow(NY, NOW);

type Call = { name: string; args: Record<string, unknown> };
function fakeDb(
  answer: (call: Call) => { data?: unknown; error?: { message: string } } = () => ({}),
) {
  const calls: Call[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const { data = null, error = null } = answer({ name, args });
      return { data, error };
    },
  } as unknown as SupabaseClient;
  return { db, calls, results: () => calls.map((c) => c.args.p_result as Record<string, unknown>) };
}
const serve =
  (body: string, init: ResponseInit = {}): Fetcher =>
  async () =>
    new Response(body, { status: 200, headers: { etag: '"v1"' }, ...init });
const source = (over: Partial<Parameters<typeof syncSource>[1]> = {}) => ({
  id: 'cal-1',
  url: 'https://calendar.familywise.test/family.ics',
  contentHash: null,
  timeZone: NY,
  ...over,
});

describe('the window', () => {
  it('[CAL-02] runs from a week back to 120 days ahead, by the household’s own day', () => {
    expect(window).toEqual({ from: '2026-10-13', to: '2027-02-18', timeZone: NY });
    // 11 pm in New York is already tomorrow in UTC; the household's day decides.
    expect(syncWindow(NY, new Date('2026-10-21T03:00:00Z')).from).toBe('2026-10-13');
  });
});

describe('reading the calendar', () => {
  const { events, instances } = readIcs(ics, window);
  const of = (uid: string) => instances.filter((i) => i.uid === `${uid}@familywise.test`);

  it('[CAL-07] a weekly series keeps 5 pm across the clock change; moved, deleted and cancelled instances', () => {
    expect(of('swim').map((i) => [i.start, i.title, i.changed])).toEqual([
      ['2026-10-13T21:00:00.000Z', 'Swim', false], // 5 pm EDT
      // Oct 20 moved to March: outside the window, and the series goes on after it.
      ['2026-10-28T22:00:00.000Z', 'Swim (Wednesday this week)', true], // moved from Tue 27th
      ['2026-11-03T22:00:00.000Z', 'Swim', false], // 5 pm EST, after Nov 1
      // Nov 10 cancelled, Nov 17 deleted (EXDATE).
      ['2026-11-24T22:00:00.000Z', 'Swim', false],
      ['2026-12-01T22:00:00.000Z', 'Swim', false],
      ['2026-12-08T22:00:00.000Z', 'Swim', false], // UNTIL is inclusive
    ]);
    expect(of('swim').find((i) => i.changed)?.recurrenceId).toBe('2026-10-27T21:00:00.000Z');
  });

  it('[CAL-07] a monthly series on the first Thursday at 7:30 pm, the UTC date a day later in winter', () => {
    expect(of('book-club').map((i) => i.start)).toEqual([
      '2026-11-06T00:30:00.000Z',
      '2026-12-04T00:30:00.000Z',
      '2027-01-08T00:30:00.000Z',
      '2027-02-05T00:30:00.000Z',
    ]);
  });

  it('[CAL-07] all-day events are dates, the end exclusive; a missing end means one day', () => {
    expect(instances.filter((i) => i.allDay).map((i) => [i.title, i.start, i.end])).toEqual([
      ['Field trip', '2026-10-23', '2026-10-24'],
      ['Grandparents visit', '2026-11-25', '2026-11-29'],
    ]);
  });

  it('[CAL-07] UTC times are kept as written, across the night the clocks change', () => {
    expect(of('flight').map((i) => [i.start, i.end])).toEqual([
      ['2026-11-01T05:30:00.000Z', '2026-11-01T07:30:00.000Z'],
    ]);
  });

  it('[CAL-07] cancelled events and those outside the window are left out', () => {
    expect(of('party')).toEqual([]);
    expect(of('old')).toEqual([]);
    expect(instances).toHaveLength(14);
  });

  it('[CAL-07] each event an instance belongs to is listed once: series, moved instance, single', () => {
    expect(
      events.map((e) => [e.uid.split('@')[0], e.recurrenceId, e.allDay, e.tz, e.rrule]),
    ).toEqual([
      ['swim', null, false, NY, 'FREQ=WEEKLY;UNTIL=20261208T220000Z'],
      ['swim', '2026-10-27T21:00:00.000Z', false, NY, null],
      ['book-club', null, false, NY, 'FREQ=MONTHLY;BYDAY=1TH'],
      ['field-trip', null, true, null, null],
      ['visit', null, true, null, null],
      ['flight', null, false, null, null],
      ['dentist', null, false, NY, null],
    ]);
    expect(events.find((e) => e.uid.startsWith('field-trip'))).toMatchObject({
      start: '2026-10-23',
      end: '2026-10-24',
    });
  });
});

describe('a sync', () => {
  it('[CAL-02] stores the events and instances with a hash of what it expanded', async () => {
    const { db, calls, results } = fakeDb(() => ({ data: { events: 7, instances: 14 } }));
    expect(await syncSource(db, source(), { fetch: serve(ics), now: NOW })).toEqual({
      status: 'synced',
      events: 7,
      instances: 14,
    });
    expect(calls.map((c) => [c.name, c.args.p_source])).toEqual([['save_calendar_sync', 'cal-1']]);
    const [sent] = results();
    expect(sent).toMatchObject({ ok: true, etag: '"v1"' });
    expect(sent!.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent!.instances).toContainEqual({
      uid: 'swim@familywise.test',
      recurrence_id: '2026-10-27T21:00:00.000Z',
      title: 'Swim (Wednesday this week)',
      start: '2026-10-28T22:00:00.000Z',
      end: '2026-10-28T23:00:00.000Z',
      all_day: false,
      changed: true,
    });
  });

  it('[NFR-05] keeps no place, note, person, link or alarm', async () => {
    const { db, results } = fakeDb();
    await syncSource(db, source(), { fetch: serve(ics), now: NOW });
    const sent = JSON.stringify(results()[0]);
    for (const personal of [
      'Made-up Street',
      'made-up form',
      'parent@example.com',
      'appointment',
    ]) {
      expect(sent).not.toContain(personal);
    }
  });

  it('[CAL-02] the same file on the same day is skipped; a new day or zone expands again', async () => {
    const first = fakeDb();
    await syncSource(first.db, source(), { fetch: serve(ics), now: NOW });
    const hash = first.results()[0]!.content_hash as string;

    const again = fakeDb();
    expect(
      await syncSource(again.db, source({ contentHash: hash }), {
        fetch: serve(ics),
        now: new Date('2026-10-20T23:00:00Z'),
      }),
    ).toEqual({ status: 'unchanged' });
    expect(again.results()).toEqual([
      { ok: true, unchanged: true, content_hash: hash, etag: '"v1"' },
    ]);

    const tomorrow = fakeDb();
    await syncSource(tomorrow.db, source({ contentHash: hash }), {
      fetch: serve(ics),
      now: new Date('2026-10-21T16:00:00Z'),
    });
    expect(tomorrow.results()[0]).toHaveProperty('instances');

    const elsewhere = fakeDb();
    await syncSource(elsewhere.db, source({ contentHash: hash, timeZone: 'Europe/London' }), {
      fetch: serve(ics),
      now: NOW,
    });
    expect(elsewhere.results()[0]).toHaveProperty('instances');
  });

  it('[CAL-06] a failure is recorded on the calendar, and nothing else is sent', async () => {
    const cases: [Fetcher, string][] = [
      [serve('Not here', { status: 404, statusText: 'Not Found' }), httpError(404, 'Not Found')],
      [serve('', { status: 503 }), httpError(503)],
      [
        async () => {
          throw new TypeError('fetch failed');
        },
        SYNC_ERRORS.unreachable,
      ],
      [
        async () => {
          throw new DOMException('The operation timed out.', 'TimeoutError');
        },
        SYNC_ERRORS.timeout,
      ],
      [serve('<html>Sign in</html>'), SYNC_ERRORS.notCalendar],
      [serve('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nnot a calendar'), SYNC_ERRORS.unreadable],
    ];
    for (const [fetcher, error] of cases) {
      const { db, results } = fakeDb();
      expect(await syncSource(db, source(), { fetch: fetcher, now: NOW })).toEqual({
        status: 'error',
        error,
      });
      expect(results()).toEqual([{ ok: false, error }]);
    }
  });

  it('[CAL-06] says what to do: a link no longer public, or a server to wait for', () => {
    expect(httpError(404, 'Not Found')).toBe(
      'The link answered 404 (Not Found): the calendar may no longer be public. Share it publicly again in Apple Calendar and replace the link.',
    );
    expect(httpError(503)).toBe(
      'The calendar’s server answered 503. FamilyWise tries again in 15 minutes.',
    );
  });

  it('[CAL-06] a calendar too large, or without its link, is refused before any parsing', async () => {
    const big = fakeDb();
    const huge = serve('BEGIN:VCALENDAR', {
      headers: { 'content-length': String(MAX_BYTES + 1) },
    });
    expect(await syncSource(big.db, source(), { fetch: huge, now: NOW })).toEqual({
      status: 'error',
      error: SYNC_ERRORS.tooLarge,
    });
    const none = fakeDb();
    expect(await syncSource(none.db, source({ url: null }), { now: NOW })).toEqual({
      status: 'error',
      error: SYNC_ERRORS.missing,
    });
  });

  it('[CAL-06] events the database refuses are recorded as a failure; a database that can’t record it throws', async () => {
    const refused = fakeDb(({ args }) =>
      (args.p_result as { ok: boolean }).ok ? { error: { message: 'bad_sync' } } : {},
    );
    expect(await syncSource(refused.db, source(), { fetch: serve(ics), now: NOW })).toEqual({
      status: 'error',
      error: SYNC_ERRORS.notStored,
    });
    expect(refused.results().at(-1)).toEqual({ ok: false, error: SYNC_ERRORS.notStored });

    const down = fakeDb(() => ({ error: { message: 'connection refused' } }));
    await expect(
      syncSource(down.db, source(), { fetch: serve('nope', { status: 500 }), now: NOW }),
    ).rejects.toThrow('connection refused');
  });

  it('[CAL-02] "unchanged" refused (the link was replaced meanwhile) records nothing more', async () => {
    const first = fakeDb();
    await syncSource(first.db, source(), { fetch: serve(ics), now: NOW });
    const hash = first.results()[0]!.content_hash as string;
    const replaced = fakeDb(() => ({ error: { message: 'unchanged since a different version' } }));
    expect(
      await syncSource(replaced.db, source({ contentHash: hash }), { fetch: serve(ics), now: NOW }),
    ).toEqual({ status: 'error', error: SYNC_ERRORS.notStored });
    expect(replaced.calls).toHaveLength(1);
  });
});

describe('fetching', () => {
  it('[CAL-01] asks for the file once, unconditionally, and gives up after 15 seconds', async () => {
    let seen: RequestInit | undefined;
    const got = await fetchCalendar(
      'https://calendar.familywise.test/a.ics',
      async (_url, init) => {
        seen = init;
        return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', { headers: { etag: '"x"' } });
      },
    );
    expect(got).toEqual({ ok: true, body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', etag: '"x"' });
    expect(new Headers(seen?.headers).has('if-none-match')).toBe(false);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the calendar_sync job', () => {
  it('[CAL-02] syncs each calendar due in turn; one failing does not stop the others', async () => {
    const { db, calls } = fakeDb(({ name }) =>
      name === 'calendar_sources_due'
        ? {
            data: [
              { id: 'a', content_hash: null, timezone: NY, url: 'https://a.familywise.test/a.ics' },
              { id: 'b', content_hash: null, timezone: NY, url: 'https://b.familywise.test/b.ics' },
              { id: 'c', content_hash: null, timezone: NY, url: null },
            ],
          }
        : { data: { events: 7, instances: 14 } },
    );
    const fetcher: Fetcher = async (url) =>
      url.includes('//a.') ? new Response(ics) : new Response('gone', { status: 410 });
    expect(await runCalendarSync(db, 'household-1', { fetch: fetcher, now: NOW })).toEqual({
      due: 3,
      synced: 1,
      unchanged: 0,
      failed: 2,
    });
    expect(calls[0]).toEqual({
      name: 'calendar_sources_due',
      args: { p_household: 'household-1', p_now: NOW.toISOString() },
    });
    expect(calls.slice(1).map((c) => c.args.p_source)).toEqual(['a', 'b', 'c']);
  });

  it('[NFR-07] fails the run only when it can’t list the calendars', async () => {
    const { db } = fakeDb(() => ({ error: { message: 'permission denied' } }));
    await expect(runCalendarSync(db, 'household-1', { now: NOW })).rejects.toThrow(
      'list the calendars due: permission denied',
    );
  });
});
