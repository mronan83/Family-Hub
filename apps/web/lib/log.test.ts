import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, scrub } from './log';

describe('[NFR-07] structured logs without PII', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON object per line with level, message and time', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'job finished', { job: 'heartbeat', households: 2 });
    const entry = JSON.parse(out.mock.calls[0]![0] as string);
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'job finished',
      job: 'heartbeat',
      households: 2,
    });
    expect(new Date(entry.time).toString()).not.toBe('Invalid Date');
  });

  it('sends errors to stderr and keeps only the name and a scrubbed message', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    log('error', 'job failed', { error: new Error('no reply for mum@example.com') });
    expect(JSON.parse(err.mock.calls[0]![0] as string).error).toEqual({
      name: 'Error',
      message: 'no reply for [email]',
    });
  });

  it('redacts fields that could hold secrets or personal data, at any depth', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'x', {
      authorization: 'Bearer abc',
      user: { email: 'a@b.co', displayName: 'Maya', id: 7 },
    });
    expect(JSON.parse(out.mock.calls[0]![0] as string)).toMatchObject({
      authorization: '[redacted]',
      user: { email: '[redacted]', displayName: '[redacted]', id: 7 },
    });
  });

  it('scrubs emails, bearer tokens and long keys, but keeps UUIDs', () => {
    const uuid = '0de00000-0000-4000-8000-000000000001';
    expect(scrub(`for a.b+c@example.co.uk in ${uuid}`)).toBe(`for [email] in ${uuid}`);
    expect(scrub('Authorization: Bearer sb_secret_abc.def')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(scrub('key ' + 'A1b2'.repeat(10))).toBe('key [redacted]');
    expect(scrub('word '.repeat(1000))).toHaveLength(1000);
  });
});
