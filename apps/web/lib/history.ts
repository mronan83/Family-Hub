import {
  ENGINE_VERSION,
  evaluateHistory,
  type DailySummary,
  type DayClass,
  type HistoryEvaluation,
  type OccurrenceFact,
  type StreakSegment,
} from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * [RWD-11] A member's stored history (WP-17, D-55): every closed day and the raw runs of good and bad
 * days, as the rules engine reads the member's facts (02 §5), through yesterday. The day-close job
 * rebuilds each member whose occurrences changed, and the Insights page rebuilds a stale member before
 * it reads, both through rebuildMemberHistory. The database keeps the facts and the rows; the engine
 * runs here, so the board and the server always read a day the same way.
 */

/** The day `n` days after an ISO date (YYYY-MM-DD); before it when `n` is negative. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day before an ISO date (YYYY-MM-DD). */
export const dayBefore = (iso: string) => addDays(iso, -1);

/** What save_member_history stores: the days and runs through `through`. */
export interface HistoryRows {
  through: string;
  days: DailySummary[];
  segments: StreakSegment[];
}

/**
 * [RWD-11] The engine's reading of a member's facts through `through` (a closed day): one row a day
 * from their first day, and their runs. Today is never stored, so the runs end on a closed day. The
 * days are judged as of the day after `through` (today), so a miss on `through` makes it bad: as of
 * `through` itself it would be today, which is never bad, and the run would carry on through it.
 */
export function historyRows(
  memberId: string,
  facts: OccurrenceFact[],
  through: string,
): HistoryRows {
  const h: HistoryEvaluation = evaluateHistory({
    memberId,
    occurrences: facts,
    asOf: addDays(through, 1),
    through,
  });
  return { through, days: h.days, segments: h.segments };
}

/**
 * [RWD-11] Rebuilds one member's history from all their facts and saves it. Safe to run any time and
 * as often as needed: the same facts give the same rows, and a row that did not change is left alone.
 * `db` is the job's (service role) or a parent's session; the database checks which.
 */
export async function rebuildMemberHistory(
  db: SupabaseClient,
  memberId: string,
  through: string,
): Promise<{ days: number; segments: number }> {
  const read = await db.rpc('member_history_facts', { p_member: memberId, p_through: through });
  if (read.error) throw new Error(`read history facts: ${read.error.message}`);
  const { read_at: readAt, facts } = read.data as { read_at: string; facts: OccurrenceFact[] };
  const rows = historyRows(memberId, facts, through);
  const saved = await db.rpc('save_member_history', {
    p_member: memberId,
    p_through: through,
    p_days: rows.days,
    p_segments: rows.segments,
    p_engine_version: ENGINE_VERSION,
    p_read_at: readAt,
  });
  if (saved.error) throw new Error(`save history: ${saved.error.message}`);
  return saved.data as { days: number; segments: number };
}

/** A parent's insights for a member (member_insights, RWD-12). */
export interface Insights {
  member_id: string;
  from: string;
  to: string;
  streaks: {
    current_kind: 'good' | 'bad' | null;
    current_length: number;
    best_good: number;
    longest_bad: number;
    through: string | null;
  };
  days: { date: string; class: DayClass; scheduled: number; done: number; missed: number }[];
  rate: { done: number; counted: number };
  most_missed: { chore_id: string; title: string; missed: number }[];
  by_tag: { tag_id: string; name: string; done: number; counted: number }[];
  trust: {
    checkoffs: number;
    unchecked: number;
    approved: number;
    sent_back: number;
    median_verify_seconds: number | null;
  };
}

/** "84%" of done over counted; "—" when nothing counted. */
export function percent(done: number, counted: number): string {
  return counted === 0 ? '—' : `${Math.round((done / counted) * 100)}%`;
}

/** "2 hours", "35 minutes", "a minute"; "—" when nothing was verified. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 6) / 10;
  if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
  const days = Math.round(hours / 2.4) / 10;
  return days === 1 ? 'a day' : `${days} days`;
}

/** "6 days" or "1 day". */
export const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The heatmap's weeks: each a row of 7 cells (null before the first day and after the last). */
export function heatmapWeeks<T extends { date: string }>(
  days: T[],
  from: string,
  to: string,
  weekStart: number,
): (T | { date: string; empty: true } | null)[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // Back to the household's first day of the week.
  const lead = (start.getUTCDay() - weekStart + 7) % 7;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - lead);
  const weeks: (T | { date: string; empty: true } | null)[][] = [];
  while (cursor <= end) {
    const week: (T | { date: string; empty: true } | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push(
        cursor < start || cursor > end ? null : (byDate.get(iso) ?? { date: iso, empty: true }),
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}
