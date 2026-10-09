import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleJob, TIME_BUDGET_MS, type JobDeps } from './run';
import type { Job } from './registry';
import type { JobStore, RunStatus } from './store';

vi.mock('../errors', () => ({ recordAppError: vi.fn(async () => {}) }));
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const SECRET = 'job-secret';
const db = {} as SupabaseClient;

function fakeStore(households = ['h1', 'h2'], last: Date | null = null) {
  const finished: {
    id: string;
    status: RunStatus;
    stats: Record<string, unknown>;
    error?: string;
  }[] = [];
  const store: JobStore = {
    households: async () => households,
    startRuns: async (_job, hs) => hs.map((h) => ({ householdId: h, id: `run-${h}` })),
    lastSuccess: async () => last,
    finishRun: async (id, status, stats, error) => {
      finished.push({ id, status, stats, error });
    },
  };
  return { store, finished };
}

function setup(jobs: Record<string, Job>, extra: Partial<JobDeps> = {}) {
  const { store, finished } = fakeStore();
  const deferred: (() => Promise<void>)[] = [];
  const deps: JobDeps = {
    db,
    store,
    jobs,
    secret: SECRET,
    defer: (t) => deferred.push(t),
    ...extra,
  };
  const runDeferred = async () => {
    for (const t of deferred) await t();
  };
  return { deps, finished, deferred, runDeferred };
}

const call = (body?: unknown, auth = `Bearer ${SECRET}`) =>
  new Request('https://example.invalid/api/jobs/sample', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('[NFR-07] job endpoint', () => {
  it('answers 202 before any work runs, then records each household', async () => {
    const job = vi.fn<Job>(async ({ householdId }) => ({
      status: 'ok',
      stats: { did: householdId },
    }));
    const { deps, finished, deferred, runDeferred } = setup({ sample: job });
    const res = await handleJob(call({ scheduled_at: '2026-10-09T01:17:00Z' }), 'sample', deps);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job: 'sample', runs: 2 });
    expect(job).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);

    await runDeferred();
    expect(job).toHaveBeenCalledTimes(2);
    expect(job.mock.calls[0]![0].scheduledAt.toISOString()).toBe('2026-10-09T01:17:00.000Z');
    expect(finished.map((f) => [f.id, f.status, f.stats.did])).toEqual([
      ['run-h1', 'ok', 'h1'],
      ['run-h2', 'ok', 'h2'],
    ]);
  });

  it('passes the last successful run so the job can catch up', async () => {
    const last = new Date('2026-10-08T23:17:00Z');
    const { store } = fakeStore(['h1'], last);
    const job = vi.fn<Job>(async () => ({ status: 'ok' }));
    const { deps, runDeferred } = setup({ sample: job }, { store });
    await handleJob(call({}), 'sample', deps);
    await runDeferred();
    expect(job.mock.calls[0]![0].since).toEqual(last);
  });

  it('records a failure in one household and still runs the others', async () => {
    const job: Job = async ({ householdId }) => {
      if (householdId === 'h1') throw new Error('upstream said no to parent@example.com');
      return { status: 'ok' };
    };
    const { deps, finished, runDeferred } = setup({ sample: job });
    await handleJob(call({}), 'sample', deps);
    await runDeferred();
    expect(finished.map((f) => [f.id, f.status])).toEqual([
      ['run-h1', 'error'],
      ['run-h2', 'ok'],
    ]);
    expect(finished[0]!.error).toBe('upstream said no to [email]');
  });

  it('fails every household on purpose with force_failure, without running the job', async () => {
    const job = vi.fn<Job>(async () => ({ status: 'ok' }));
    const { deps, finished, runDeferred } = setup({ sample: job });
    await handleJob(call({ force_failure: true }), 'sample', deps);
    await runDeferred();
    expect(job).not.toHaveBeenCalled();
    expect(
      finished.every(
        (f) => f.status === 'error' && f.error === 'forced failure (job-run workflow)',
      ),
    ).toBe(true);
  });

  it('skips the households left once the time budget is spent', async () => {
    let clock = 0;
    const job: Job = async () => {
      clock += TIME_BUDGET_MS + 1;
      return { status: 'ok' };
    };
    const { deps, finished, runDeferred } = setup({ sample: job }, { now: () => clock });
    await handleJob(call({}), 'sample', deps);
    await runDeferred();
    expect(finished.map((f) => f.status)).toEqual(['ok', 'skipped']);
    expect(finished[1]!.stats.reason).toMatch(/time budget/);
  });

  it('refuses without the job secret, and is off where no secret is set', async () => {
    const { deps } = setup({ sample: async () => ({ status: 'ok' }) });
    expect((await handleJob(call({}, ''), 'sample', deps)).status).toBe(401);
    expect((await handleJob(call({}, 'Bearer wrong'), 'sample', deps)).status).toBe(401);
    expect((await handleJob(call({}), 'sample', { ...deps, secret: undefined })).status).toBe(503);
  });

  it('answers 404 for an unknown job and 503 without the service key', async () => {
    const { deps } = setup({ sample: async () => ({ status: 'ok' }) });
    expect((await handleJob(call({}), 'nope', deps)).status).toBe(404);
    expect((await handleJob(call({}), 'constructor', deps)).status).toBe(404);
    expect((await handleJob(call({}), '../sample', deps)).status).toBe(404);
    expect((await handleJob(call({}), 'sample', { ...deps, db: null })).status).toBe(503);
  });

  it('answers 500 and starts nothing when the runs cannot be recorded', async () => {
    const { store } = fakeStore();
    store.startRuns = async () => {
      throw new Error('database unavailable');
    };
    const { deps, deferred } = setup({ sample: async () => ({ status: 'ok' }) }, { store });
    expect((await handleJob(call({}), 'sample', deps)).status).toBe(500);
    expect(deferred).toHaveLength(0);
  });
});
