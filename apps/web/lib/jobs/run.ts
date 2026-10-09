import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jobAuthError } from './auth';
import { JOBS, type Job } from './registry';
import { supabaseJobStore, type JobStore } from './store';
import { adminClient } from '../supabase/admin';
import { recordAppError } from '../errors';
import { log, scrub } from '../log';

/** Work per call stays well inside Vercel Hobby's 300 s; households left over wait for the next call. */
export const TIME_BUDGET_MS = 60_000;

export type JobDeps = {
  db: SupabaseClient | null;
  store?: JobStore;
  jobs?: Record<string, Job>;
  now?: () => number;
  defer?: (task: () => Promise<void>) => void;
  secret?: string;
};

const json = (status: number, body: unknown) => Response.json(body, { status });

/**
 * [NFR-07] The job endpoint pattern (01 §5.6, D-38). Checks the bearer secret, writes one `running`
 * job_run row per household, answers 202 at once (pg_net holds every queued call until its slowest
 * one ends, SPIKE-05), then runs the job household by household after the response and records each
 * outcome. A failure in one household does not stop the others. `force_failure` in the body makes
 * the run fail on purpose (job-run workflow), to check that failures show in job health.
 */
export async function handleJob(request: Request, name: string, deps?: JobDeps): Promise<Response> {
  const secret = deps && 'secret' in deps ? deps.secret : process.env.JOB_SIGNING_SECRET;
  const refused = jobAuthError(request, secret);
  if (refused) return refused;

  const jobs = deps?.jobs ?? JOBS;
  const job = Object.hasOwn(jobs, name) ? jobs[name] : undefined;
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !job) return json(404, { error: 'unknown job' });

  const db = deps ? deps.db : adminClient();
  if (!db) return json(503, { error: 'jobs are off' });
  const store = deps?.store ?? supabaseJobStore(db);
  const now = deps?.now ?? Date.now;
  const defer = deps?.defer ?? ((task) => after(task));

  const body = (await request.json().catch(() => ({}))) as {
    scheduled_at?: unknown;
    force_failure?: unknown;
  };
  const scheduled =
    typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : new Date(now());
  const scheduledAt = Number.isNaN(scheduled.getTime()) ? new Date(now()) : scheduled;
  const forceFailure = body.force_failure === true;
  const requestId = request.headers.get('x-vercel-id') ?? undefined;

  let runs: { householdId: string; id: string }[];
  try {
    runs = await store.startRuns(name, await store.households());
  } catch (error) {
    await recordAppError({
      requestId,
      method: 'POST',
      route: `/api/jobs/${name}`,
      kind: 'job',
      error,
    });
    return json(500, { error: 'could not start the job' });
  }

  const started = now();
  defer(async () => {
    for (const { householdId, id } of runs) {
      if (now() - started > TIME_BUDGET_MS) {
        await store.finishRun(id, 'skipped', { reason: 'time budget; the next call catches up' });
        continue;
      }
      try {
        if (forceFailure) throw new Error('forced failure (job-run workflow)');
        const since = await store.lastSuccess(name, householdId);
        const result = await job({ db, householdId, scheduledAt, since });
        await store.finishRun(id, result.status, { ...result.stats, ms: now() - started });
      } catch (error) {
        const message = scrub(error instanceof Error ? error.message : String(error));
        log('error', 'job failed', { job: name, householdId, error });
        await store.finishRun(id, 'error', { ms: now() - started }, message).catch((e) => {
          log('error', 'could not record the job failure', { job: name, householdId, error: e });
        });
        await recordAppError({
          requestId,
          method: 'POST',
          route: `/api/jobs/${name}`,
          kind: 'job',
          error,
        });
      }
    }
    log('info', 'job finished', { job: name, households: runs.length, ms: now() - started });
  });

  return json(202, { job: name, runs: runs.length });
}
