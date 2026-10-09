import type { SupabaseClient } from '@supabase/supabase-js';

export type JobContext = {
  db: SupabaseClient;
  householdId: string;
  /** When pg_cron asked for this run. */
  scheduledAt: Date;
  /** When the job last ran without error for this household: catch up from here (null: first run). */
  since: Date | null;
};

export type JobResult = { status: 'ok' | 'skipped'; stats?: Record<string, unknown> };

/** A job's work for one household. It must be idempotent: running it twice is harmless (01 §5.6). */
export type Job = (ctx: JobContext) => Promise<JobResult>;

/**
 * Every job the endpoint runs, keyed by its schedule name (schedule.json; a test keeps the two in
 * step). Later work packages add calendar_sync, reminders and the rest.
 */
export const JOBS: Record<string, Job> = {
  // [NFR-07] Sample job (WP-07): proves the path end to end and reports how late pg_cron's call
  // arrived. Reads only; repeating it changes nothing.
  async heartbeat({ db, householdId, scheduledAt }) {
    const { count, error } = await db
      .from('member')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId);
    if (error) throw new Error(`count members: ${error.message}`);
    return {
      status: 'ok',
      stats: { lag_ms: Math.max(0, Date.now() - scheduledAt.getTime()), members: count ?? 0 },
    };
  },

  // [CHR-03] The rolling window (WP-09): adds the occurrences from tomorrow to 14 days ahead that
  // are missing, in the database (generate_household_occurrences). Today is planned before it
  // begins and changes only through an item's own edit (D-24). Repeating it adds nothing.
  async occurrence_gen({ db, householdId }) {
    const { data, error } = await db.rpc('generate_household_occurrences', {
      p_household_id: householdId,
    });
    if (error) throw new Error(`generate occurrences: ${error.message}`);
    return { status: 'ok', stats: data as Record<string, unknown> };
  },

  // [CHR-07] Day close (WP-10): once the household's local day has ended, its routines are finalized
  // and those not done become missed; tasks carry over (D-31). Catches up every earlier day at once,
  // and repeating it changes nothing.
  async day_close({ db, householdId }) {
    const { data, error } = await db.rpc('close_household_day', { p_household_id: householdId });
    if (error) throw new Error(`close the day: ${error.message}`);
    return { status: 'ok', stats: data as Record<string, unknown> };
  },

  // [NFR-06] The nightly check (WP-10): re-folds the last 14 days of events and compares them with
  // the stored statuses, and (WP-16) the points each occurrence's members hold with what it owes them,
  // report-only. Any drift fails the run, so System Health shows it; correcting it is a parent's
  // explicit action.
  async status_check({ db, householdId }) {
    const { data, error } = await db.rpc('occurrence_status_drift', {
      p_household_id: householdId,
    });
    if (error) throw new Error(`check statuses: ${error.message}`);
    const report = data as {
      drift: number;
      sample: unknown[];
      points_drift?: number;
      points_sample?: unknown[];
    } & Record<string, unknown>;
    if (report.drift > 0) {
      throw new Error(
        `${report.drift} occurrence status(es) differ from their events: ${JSON.stringify(report.sample)}`,
      );
    }
    // [PTS-01] The ledger holds each occurrence's points for exactly those it rewards while done.
    if ((report.points_drift ?? 0) > 0) {
      throw new Error(
        `${report.points_drift} member point total(s) differ from their occurrences: ${JSON.stringify(report.points_sample)}`,
      );
    }
    return { status: 'ok', stats: report };
  },
};
