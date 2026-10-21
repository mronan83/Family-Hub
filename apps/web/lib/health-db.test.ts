import { describe, expect, it } from 'vitest';
import { dbHealth } from './health-db';

const preview = { VERCEL_ENV: 'preview' };
/** A clock that moves `step` ms each time it is read. */
const clock = (step: number) => {
  let t = 1_000;
  return () => (t += step);
};

describe('[NFR-12-b] GET /api/health/db: the preview’s own path to the database, timed', () => {
  it('[NFR-12-b] on a preview: one call, its time, 200 when it answered', async () => {
    let calls = 0;
    const out = await dbHealth(
      async () => {
        calls++;
        return { error: null };
      },
      preview,
      clock(2_345),
    );
    expect(calls).toBe(1);
    expect(out).toEqual({ status: 200, body: { status: 'ok', ms: 2_345 } });
  });

  it('[NFR-12-b] a call that fails, or throws, is 503 with its error and its time', async () => {
    expect(
      await dbHealth(
        async () => ({ error: { message: 'canceling statement due to statement timeout' } }),
        preview,
        clock(8_000),
      ),
    ).toEqual({
      status: 503,
      body: { status: 'failed', ms: 8_000, error: 'canceling statement due to statement timeout' },
    });
    expect(
      await dbHealth(
        async () => {
          throw new TypeError('fetch failed');
        },
        preview,
        clock(5),
      ),
    ).toEqual({ status: 503, body: { status: 'failed', ms: 5, error: 'fetch failed' } });
  });

  it('[NFR-12-b] nowhere but a preview, and off without the database settings', async () => {
    let calls = 0;
    const probe = async () => {
      calls++;
      return { error: null };
    };
    for (const env of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, {}]) {
      expect(await dbHealth(probe, env)).toEqual({ status: 404, body: { error: 'not found' } });
    }
    expect(calls).toBe(0);
    expect(await dbHealth(null, preview)).toEqual({
      status: 503,
      body: { status: 'off', error: 'no database settings' },
    });
  });
});
