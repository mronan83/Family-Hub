import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoDay } from '../format';
import { readIcs, type Window } from './ics';

// [CAL-02][CAL-06][CAL-07] Calendar sync (WP-22, `01` §5.4, D-63): fetch a calendar's published file,
// expand it over the household-local window and store what the board shows through
// save_calendar_sync, or record why it failed (its last good events stay). The calendar_sync job runs
// it for each calendar due; saving a link in the admin portal runs it at once with the link just
// typed. Relative imports only: the e2e runner runs this against made-up calendars.

/** The window kept: a week back, 120 days ahead (`01` §5.4). */
export const DAYS_BEFORE = 7;
export const DAYS_AFTER = 120;
/** iCloud answers in under a second (SPIKE-02); a calendar slower than this tries again later. */
export const FETCH_TIMEOUT_MS = 15_000;
/** A decade of a family's events is about 57 KB (SPIKE-02). */
export const MAX_BYTES = 5 * 1024 * 1024;
/** As many events or instances as save_calendar_sync takes for one calendar. */
export const MAX_INSTANCES = 5000;

/** What an admin reads on Calendars when a sync fails (US-505): what happened and what to do. */
export const SYNC_ERRORS = {
  missing: 'The link is missing. Replace it with the calendar’s public link.',
  unreachable:
    'Couldn’t reach the link. Check it’s the whole public link from Apple Calendar, then replace it.',
  timeout:
    'The calendar’s server took more than 15 seconds to answer. FamilyWise tries again in 15 minutes.',
  notCalendar:
    'The link didn’t return a calendar. Use the public link from Apple Calendar (it starts with webcal://).',
  unreadable: 'The calendar couldn’t be read. Check the link is a calendar’s public link.',
  tooLarge: 'The calendar is larger than 5 MB, more than FamilyWise reads.',
  tooMany:
    'The calendar has more than 5,000 events in the next four months, more than FamilyWise keeps.',
  notStored: 'The events couldn’t be stored. FamilyWise tries again in 15 minutes.',
} as const;

/** "The link answered 404 (Not Found)…": no longer public, or the server's own trouble. */
export function httpError(status: number, statusText = ''): string {
  const said = `${status}${statusText ? ` (${statusText})` : ''}`;
  return [401, 403, 404, 410].includes(status)
    ? `The link answered ${said}: the calendar may no longer be public. Share it publicly again in Apple Calendar and replace the link.`
    : `The calendar’s server answered ${said}. FamilyWise tries again in 15 minutes.`;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** The window for a household's zone on a given day: [today − 7, today + 120], the end exclusive. */
export function syncWindow(timeZone: string, now: Date = new Date()): Window {
  const today = Date.parse(`${isoDay(timeZone, now)}T00:00:00Z`);
  const day = (n: number) => new Date(today + n * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-DAYS_BEFORE), to: day(DAYS_AFTER + 1), timeZone };
}

/**
 * Fetches a calendar's file. iCloud ignores conditional requests and sends the whole file each time
 * (SPIKE-02), so none is made; the sync compares a hash instead.
 */
export async function fetchCalendar(
  url: string,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true; body: string; etag: string | null } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: 'text/calendar, */*;q=0.5' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      error:
        name === 'TimeoutError' || name === 'AbortError'
          ? SYNC_ERRORS.timeout
          : SYNC_ERRORS.unreachable,
    };
  }
  if (!response.ok) return { ok: false, error: httpError(response.status, response.statusText) };
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return { ok: false, error: SYNC_ERRORS.tooLarge };
  }
  const body = await response.text();
  if (body.length > MAX_BYTES) return { ok: false, error: SYNC_ERRORS.tooLarge };
  if (!/^\s*BEGIN:VCALENDAR/i.test(body)) return { ok: false, error: SYNC_ERRORS.notCalendar };
  return { ok: true, body, etag: response.headers.get('etag') };
}

/** A calendar to sync: its link (null when Vault has none) and what its last good sync expanded. */
export interface SyncSource {
  id: string;
  url: string | null;
  contentHash: string | null;
  timeZone: string;
}

export type SyncOutcome =
  | { status: 'synced'; events: number; instances: number }
  | { status: 'unchanged' }
  | { status: 'error'; error: string };

async function store(db: SupabaseClient, source: string, result: Record<string, unknown>) {
  const { data, error } = await db.rpc('save_calendar_sync', {
    p_source: source,
    p_result: result,
  });
  return { data: data as { events?: number; instances?: number } | null, error };
}

/**
 * Syncs one calendar. A failure is the calendar's own state (status and error, its last good events
 * kept), not the caller's: only a database that can't record it throws.
 */
export async function syncSource(
  db: SupabaseClient,
  source: SyncSource,
  options: { fetch?: Fetcher; now?: Date } = {},
): Promise<SyncOutcome> {
  const fail = async (error: string): Promise<SyncOutcome> => {
    const saved = await store(db, source.id, { ok: false, error });
    if (saved.error) throw new Error(`record the calendar's failure: ${saved.error.message}`);
    return { status: 'error', error };
  };
  if (!source.url) return fail(SYNC_ERRORS.missing);
  const got = await fetchCalendar(source.url, options.fetch);
  if (!got.ok) return fail(got.error);

  // The same file, first day and zone expand to the same events: skip parsing and writing. A new
  // day changes the hash, so a quiet calendar's window still moves on daily.
  const window = syncWindow(source.timeZone, options.now);
  const contentHash = createHash('sha256')
    .update(`${window.from}\n${window.timeZone}\n`)
    .update(got.body)
    .digest('hex');
  if (contentHash === source.contentHash) {
    const saved = await store(db, source.id, {
      ok: true,
      unchanged: true,
      content_hash: contentHash,
      etag: got.etag,
    });
    // Refused when the link was replaced meanwhile: nothing is recorded, the new link's sync decides.
    return saved.error
      ? { status: 'error', error: SYNC_ERRORS.notStored }
      : { status: 'unchanged' };
  }

  let parsed: ReturnType<typeof readIcs>;
  try {
    parsed = readIcs(got.body, window);
  } catch {
    return fail(SYNC_ERRORS.unreadable);
  }
  if (parsed.events.length > MAX_INSTANCES || parsed.instances.length > MAX_INSTANCES) {
    return fail(SYNC_ERRORS.tooMany);
  }
  const saved = await store(db, source.id, {
    ok: true,
    content_hash: contentHash,
    etag: got.etag,
    events: parsed.events.map((e) => ({
      uid: e.uid,
      recurrence_id: e.recurrenceId,
      title: e.title,
      start: e.start,
      end: e.end,
      all_day: e.allDay,
      tz: e.tz,
      rrule: e.rrule,
    })),
    instances: parsed.instances.map((i) => ({
      uid: i.uid,
      recurrence_id: i.recurrenceId,
      title: i.title,
      start: i.start,
      end: i.end,
      all_day: i.allDay,
      changed: i.changed,
    })),
  });
  if (saved.error) return fail(SYNC_ERRORS.notStored);
  return {
    status: 'synced',
    events: saved.data?.events ?? parsed.events.length,
    instances: saved.data?.instances ?? parsed.instances.length,
  };
}

/** [CAL-02] The calendar_sync job for one household: each calendar due, one at a time. */
export async function runCalendarSync(
  db: SupabaseClient,
  householdId: string,
  options: { fetch?: Fetcher; now?: Date } = {},
): Promise<{ due: number; synced: number; unchanged: number; failed: number }> {
  const now = options.now ?? new Date();
  const { data, error } = await db.rpc('calendar_sources_due', {
    p_household: householdId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`list the calendars due: ${error.message}`);
  const due = (data ?? []) as {
    id: string;
    content_hash: string | null;
    timezone: string;
    url: string | null;
  }[];
  const stats = { due: due.length, synced: 0, unchanged: 0, failed: 0 };
  for (const s of due) {
    const outcome = await syncSource(
      db,
      { id: s.id, url: s.url, contentHash: s.content_hash, timeZone: s.timezone },
      { ...options, now },
    );
    stats[outcome.status === 'error' ? 'failed' : outcome.status] += 1;
  }
  return stats;
}
