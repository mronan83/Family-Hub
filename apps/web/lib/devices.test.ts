import { describe, expect, it } from 'vitest';
import {
  decodeCredential,
  encodeCredential,
  formatCode,
  isDeviceClaims,
  normalizeCode,
} from './devices';
import { day, dayAndTime, time } from './format';

const CREDENTIAL = {
  email: 'device-0de00000-0000-4000-8000-0000000000d1@devices.familywise.invalid',
  password: 'ab'.repeat(24),
};

describe('board credential cookie', () => {
  it('[DEV-02] round-trips the credential pairing made', () => {
    expect(decodeCredential(encodeCredential(CREDENTIAL))).toEqual(CREDENTIAL);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not base64 JSON', 'not-a-cookie'],
    ['an admin email', encodeCredential({ ...CREDENTIAL, email: 'parent@example.com' })],
    ['a short password', encodeCredential({ ...CREDENTIAL, password: 'secret' })],
    ['too long', 'x'.repeat(400)],
  ])('[DEV-02] refuses a cookie that is %s', (_name, value) => {
    expect(decodeCredential(value)).toBe(null);
  });
});

describe('pairing codes', () => {
  it('[DEV-01] keeps only digits and shows them in two groups of four', () => {
    expect(normalizeCode(' 1234-5678 ')).toBe('12345678');
    expect(normalizeCode(undefined)).toBe('');
    expect(formatCode('12345678')).toBe('1234 5678');
    expect(formatCode('123')).toBe('123');
  });
});

describe('isDeviceClaims', () => {
  it('[DEV-02] tells a board session from an admin one', () => {
    expect(isDeviceClaims({ app_metadata: { role: 'device' } })).toBe(true);
    expect(isDeviceClaims({ app_metadata: { provider: 'email' } })).toBe(false);
    expect(isDeviceClaims(null)).toBe(false);
  });
});

describe('format', () => {
  it('writes dates and times the brand way, in the household timezone (06 §2)', () => {
    const at = '2026-10-07T23:42:00Z';
    expect(day(at, 'America/Chicago')).toBe('Wed, Oct 7');
    expect(time(at, 'America/Chicago')).toBe('6:42 pm');
    expect(time('2026-10-07T12:05:00Z', 'UTC')).toBe('12:05 pm');
    expect(dayAndTime(at, 'Europe/London')).toBe('Thu, Oct 8 at 12:42 am');
  });
});
