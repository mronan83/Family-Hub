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
 * step). Later work packages add calendar_sync, day_close, reminders and the rest.
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
};
