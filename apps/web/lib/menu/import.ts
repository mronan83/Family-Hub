import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoDay } from '../format';
import {
  type MenuDay,
  type NutrisliceConfig,
  readSchools,
  readWeek,
  type School,
  schoolsUrl,
  weeksCovering,
  weekUrl,
} from './nutrislice';

// [MENU-02][MENU-04][MENU-05] The menu import (WP-27, `01` §5.5, D-79): fetch a Nutrislice feed's next
// 28 days and store them through save_menu_fetch, or record why it failed (its cached days stay).
// The menu_import job runs it daily for each feed due; saving a feed in the admin portal runs it at
// once, so a parent sees its first weeks (or what's wrong) straight away (US-801). Relative imports
// only: the e2e runner uses this.

/** The days kept ahead, today included (MENU-05). */
export const WINDOW_DAYS = 28;
/** Nutrislice answers in about a second; a slower district is tried again tomorrow. */
export const FETCH_TIMEOUT_MS = 15_000;
/** A week is about 250 KB, mostly nutrition data that is dropped. */
export const MAX_BYTES = 4 * 1024 * 1024;

/** What a parent reads on School menus when a fetch fails (US-803): what happened, what to do. */
export const MENU_ERRORS = {
  unreachable: 'Couldn’t reach Nutrislice. FamilyWise tries again tomorrow.',
  timeout: 'Nutrislice took more than 15 seconds to answer. FamilyWise tries again tomorrow.',
  notFound:
    'Nutrislice doesn’t know this district, school or menu any more. Check them under Change, then save.',
  unreadable: 'Nutrislice’s answer couldn’t be read as a menu. FamilyWise tries again tomorrow.',
  tooLarge: 'Nutrislice’s answer was larger than FamilyWise reads.',
  notStored: 'The menu couldn’t be stored. FamilyWise tries again tomorrow.',
} as const;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** The window for a household's zone on a day: today to 27 days on, both included. */
export function menuWindow(timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = Date.parse(`${isoDay(timeZone, now)}T00:00:00Z`);
  const day = (n: number) => new Date(today + n * 86_400_000).toISOString().slice(0, 10);
  return { from: day(0), to: day(WINDOW_DAYS - 1) };
}

/** GETs a Nutrislice address as JSON, or says why not in a parent's words. */
export async function getJson(
  url: string,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: 'application/json' },
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
          ? MENU_ERRORS.timeout
          : MENU_ERRORS.unreachable,
    };
  }
  if ([400, 401, 403, 404, 410].includes(response.status)) {
    return { ok: false, error: MENU_ERRORS.notFound };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `Nutrislice answered ${response.status}. FamilyWise tries again tomorrow.`,
    };
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return { ok: false, error: MENU_ERRORS.tooLarge };
  }
  const body = await response.text();
  if (body.length > MAX_BYTES) return { ok: false, error: MENU_ERRORS.tooLarge };
  try {
    return { ok: true, json: JSON.parse(body) };
  } catch {
    return { ok: false, error: MENU_ERRORS.unreadable };
  }
}

/** [US-801] A district's schools and their menus, for the admin portal's picker. */
export async function fetchSchools(
  district: string,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true; schools: School[] } | { ok: false; error: string }> {
  const got = await getJson(schoolsUrl(district), fetcher);
  if (!got.ok) return got;
  try {
    return { ok: true, schools: readSchools(got.json) };
  } catch {
    return { ok: false, error: MENU_ERRORS.unreadable };
  }
}

/** [MENU-02] A feed's days in the window, week by week. */
export async function fetchFeed(
  config: NutrisliceConfig,
  window: { from: string; to: string },
  fetcher: Fetcher = fetch,
): Promise<{ ok: true; days: MenuDay[] } | { ok: false; error: string }> {
  const days: MenuDay[] = [];
  for (const sunday of weeksCovering(window.from, window.to)) {
    const got = await getJson(weekUrl(config, sunday), fetcher);
    if (!got.ok) return got;
    try {
      days.push(...readWeek(got.json));
    } catch {
      return { ok: false, error: MENU_ERRORS.unreadable };
    }
  }
  return { ok: true, days: days.filter((d) => d.date >= window.from && d.date <= window.to) };
}

/** A feed to fetch: its settings and what its last good fetch read. */
export interface FeedSource {
  id: string;
  config: NutrisliceConfig;
  contentHash: string | null;
  timeZone: string;
}

export type FetchOutcome =
  | { status: 'fetched'; days: number; kept: number }
  | { status: 'unchanged' }
  | { status: 'error'; error: string };

/** The days as save_menu_fetch and save_menu_days take them. */
export function daysForDb(days: MenuDay[]) {
  return days.map((d) => ({
    date: d.date,
    items: d.items,
    no_service: d.noService,
    ...(d.note ? { note: d.note } : {}),
  }));
}

/**
 * Fetches one feed. A failure is the feed's own state (status and error, its cached days kept), not
 * the caller's: only a database that can't record it throws.
 */
export async function fetchSource(
  db: SupabaseClient,
  source: FeedSource,
  options: { fetch?: Fetcher; now?: Date } = {},
): Promise<FetchOutcome> {
  const store = (result: Record<string, unknown>) =>
    db.rpc('save_menu_fetch', { p_source: source.id, p_result: result });
  const fail = async (error: string): Promise<FetchOutcome> => {
    const saved = await store({ ok: false, error });
    if (saved.error) throw new Error(`record the menu's failure: ${saved.error.message}`);
    return { status: 'error', error };
  };
  const window = menuWindow(source.timeZone, options.now);
  const got = await fetchFeed(source.config, window, options.fetch);
  if (!got.ok) return fail(got.error);

  // The same window and menus as last time: nothing to write. A new day moves the window.
  const days = daysForDb(got.days);
  const contentHash = createHash('sha256')
    .update(`${window.from}\n`)
    .update(JSON.stringify(days))
    .digest('hex');
  if (contentHash === source.contentHash) {
    const saved = await store({ ok: true, unchanged: true, content_hash: contentHash });
    return saved.error ? fail(MENU_ERRORS.notStored) : { status: 'unchanged' };
  }
  const saved = await store({ ok: true, content_hash: contentHash, ...window, days });
  if (saved.error) return fail(MENU_ERRORS.notStored);
  const data = saved.data as { days?: number; kept?: number } | null;
  return { status: 'fetched', days: data?.days ?? days.length, kept: data?.kept ?? 0 };
}

/** [MENU-05] The menu_import job for one household: each feed due, one at a time. */
export async function runMenuImport(
  db: SupabaseClient,
  householdId: string,
  options: { fetch?: Fetcher; now?: Date } = {},
): Promise<{ due: number; fetched: number; unchanged: number; failed: number }> {
  const now = options.now ?? new Date();
  const { data, error } = await db.rpc('menu_sources_due', {
    p_household: householdId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`list the menus due: ${error.message}`);
  const due = (data ?? []) as {
    id: string;
    config: NutrisliceConfig;
    content_hash: string | null;
    timezone: string;
  }[];
  const stats = { due: due.length, fetched: 0, unchanged: 0, failed: 0 };
  for (const s of due) {
    const outcome = await fetchSource(
      db,
      { id: s.id, config: s.config, contentHash: s.content_hash, timeZone: s.timezone },
      { ...options, now },
    );
    stats[outcome.status === 'error' ? 'failed' : outcome.status] += 1;
  }
  return stats;
}
