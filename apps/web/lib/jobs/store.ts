import type { SupabaseClient } from '@supabase/supabase-js';

export type RunStatus = 'ok' | 'error' | 'skipped';

/** What the job wrapper needs from the database, so it can be tested without one. */
export type JobStore = {
  households(): Promise<string[]>;
  /** Inserts one `running` job_run row per household. */
  startRuns(job: string, households: string[]): Promise<{ householdId: string; id: string }[]>;
  /** When this job last ran without error for the household (catch-up starts there). */
  lastSuccess(job: string, household: string): Promise<Date | null>;
  finishRun(
    id: string,
    status: RunStatus,
    stats: Record<string, unknown>,
    error?: string,
  ): Promise<void>;
};

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

export function supabaseJobStore(db: SupabaseClient): JobStore {
  return {
    async households() {
      const { data, error } = await db.from('household').select('id').order('id');
      fail('list households', error);
      return (data ?? []).map((h) => h.id as string);
    },
    async startRuns(job, households) {
      if (households.length === 0) return [];
      const rows = households.map((household_id) => ({
        household_id,
        job_type: job,
        status: 'running',
      }));
      const { data, error } = await db.from('job_run').insert(rows).select('id, household_id');
      fail('start job runs', error);
      return (data ?? []).map((r) => ({
        householdId: r.household_id as string,
        id: r.id as string,
      }));
    },
    async lastSuccess(job, household) {
      const { data, error } = await db
        .from('job_run')
        .select('started_at')
        .eq('household_id', household)
        .eq('job_type', job)
        .in('status', ['ok', 'skipped'])
        .order('started_at', { ascending: false })
        .limit(1);
      fail('read the last run', error);
      return data?.[0] ? new Date(data[0].started_at as string) : null;
    },
    async finishRun(id, status, stats, message) {
      const { error } = await db
        .from('job_run')
        .update({ status, stats, error: message ?? null, finished_at: new Date().toISOString() })
        .eq('id', id);
      fail('finish the job run', error);
    },
  };
}
