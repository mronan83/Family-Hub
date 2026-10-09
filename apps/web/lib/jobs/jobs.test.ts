import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobAuthError } from './auth';
import { PROBE_MAX_SECONDS, probeAuthError, probeSeconds } from './probe';
import { POST } from '@/app/api/jobs/spike/route';

const SECRET = 'job-secret-for-tests';
const call = (authorization?: string, path = '/api/jobs/spike', body?: unknown) =>
  new Request(`https://example.invalid${path}`, {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('[NFR-07] job endpoint authentication', () => {
  it('refuses every call when the job secret is not set (previews, local)', async () => {
    const res = jobAuthError(call(`Bearer ${SECRET}`), undefined);
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: 'jobs are off' });
  });

  it.each([
    ['no header', undefined],
    ['wrong secret', 'Bearer not-the-secret'],
    ['a prefix of the secret', `Bearer ${SECRET.slice(0, 5)}`],
    ['the secret plus more', `Bearer ${SECRET}x`],
    ['no Bearer scheme', SECRET],
    ['empty token', 'Bearer '],
  ])('refuses %s with 401', (_, header) => {
    expect(jobAuthError(call(header), SECRET)?.status).toBe(401);
  });

  it('lets the job secret through', () => {
    expect(jobAuthError(call(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });
});

describe('[NFR-07] SPIKE-05 probe', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('needs the job secret in production and refuses locally', () => {
    const prod = { VERCEL_ENV: 'production', JOB_SIGNING_SECRET: SECRET };
    expect(probeAuthError(call(), prod)?.status).toBe(401);
    expect(probeAuthError(call(`Bearer ${SECRET}`), prod)).toBeNull();
    expect(probeAuthError(call(), { VERCEL_ENV: 'production' })?.status).toBe(503);
    expect(probeAuthError(call(), {})?.status).toBe(503);
  });

  it('answers on a preview, which deployment protection guards', () => {
    expect(probeAuthError(call(), { VERCEL_ENV: 'preview' })).toBeNull();
  });

  it.each([
    ['', 0],
    ['?seconds=30', 30],
    ['?seconds=2.9', 2],
    ['?seconds=-5', 0],
    ['?seconds=abc', 0],
    ['?seconds=Infinity', 0],
    [`?seconds=${PROBE_MAX_SECONDS + 100}`, PROBE_MAX_SECONDS],
  ])('reads seconds from "%s" as %d', (query, expected) => {
    expect(probeSeconds(new URL(`https://example.invalid/api/jobs/spike${query}`))).toBe(expected);
  });

  it('refuses before doing any work when the caller is not allowed', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('JOB_SIGNING_SECRET', SECRET);
    expect((await POST(call(undefined, '/api/jobs/spike?seconds=300'))).status).toBe(401);
  });

  it('sleeps as asked and reports the instance, cold start, CPU and tag', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = POST(call(undefined, '/api/jobs/spike?seconds=30', { tag: 'duration' }));
    // The sleep starts once the body is read; setImmediate stays real.
    while (vi.getTimerCount() === 0) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(30_000);
    const first = await (await pending).json();
    expect(first).toMatchObject({ tag: 'duration', seconds: 30, cold: true, region: 'local' });
    expect(first.instance).toMatch(/^[0-9a-f]{8}$/);
    expect(first.bootCpuMs).toBeGreaterThan(0);
    expect(first.cpuMs).toBeGreaterThanOrEqual(0);

    vi.useRealTimers();
    const second = await (await POST(call())).json();
    expect(second).toMatchObject({ tag: null, seconds: 0, cold: false, bootCpuMs: null });
    expect(second.instance).toBe(first.instance);
  });
});
