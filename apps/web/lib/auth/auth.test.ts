import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccount } from './accounts';
import { DEMO_PERSONAS, demoEmail, demoPassword, demoSecret, isDemoPersona } from './demo';
import { accountMessage, GENERIC, hintMessage, PASSWORD_RULE } from './messages';
import { safeNext, signInPath } from './next';
import { requestOrigin } from './origin';

vi.spyOn(console, 'log').mockImplementation(() => {});

describe('demo sign-ins', () => {
  it('[ACC-02] derive the password scripts/preview-db.sh sets (shared test vector)', () => {
    // The same vector is asserted against the database in scripts/preview-db.test.sh.
    expect(demoPassword('test-secret', 'alex@demo.familywise.invalid')).toBe(
      '045626f96e2913b275eee7347abe26d196002e0fec0d237641b91979c093c14d',
    );
  });

  it('[ACC-02] are on for previews only, and only with the bypass secret', () => {
    expect(demoSecret({ VERCEL_ENV: 'preview', VERCEL_AUTOMATION_BYPASS_SECRET: 's' })).toBe('s');
    expect(demoSecret({ VERCEL_ENV: 'production', VERCEL_AUTOMATION_BYPASS_SECRET: 's' })).toBe(
      null,
    );
    expect(demoSecret({ VERCEL_AUTOMATION_BYPASS_SECRET: 's' })).toBe(null);
    expect(demoSecret({ VERCEL_ENV: 'preview' })).toBe(null);
  });

  it('[ACC-02] are exactly the four seeded personas', () => {
    const seed = readFileSync(new URL('../../../../supabase/seed.sql', import.meta.url), 'utf8');
    for (const p of DEMO_PERSONAS) expect(seed).toContain(`'${demoEmail(p.key)}'`);
    expect(isDemoPersona('alex')).toBe(true);
    expect(isDemoPersona('parent@example.com')).toBe(false);
  });
});

describe('safeNext', () => {
  it.each([
    ['/admin', '/admin'],
    ['/invite', '/invite'],
    ['/admin?tab=invites#x', '/admin?tab=invites#x'],
    ['/reset-password/new', '/reset-password/new'],
  ])('[ACC-02] follows a path on this site: %s', (raw, out) => {
    expect(safeNext(raw)).toBe(out);
  });

  it.each([
    'https://evil.example/admin',
    '//evil.example/admin',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/admin\nSet-Cookie: x',
    '',
    undefined,
    42,
    `/${'a'.repeat(600)}`,
  ])('[ACC-02] refuses anything else: %s', (raw) => {
    expect(safeNext(raw)).toBe('/admin');
  });

  it('[ACC-02] signInPath carries a safe next and drops the default', () => {
    expect(signInPath('/invite')).toBe('/sign-in?next=%2Finvite');
    expect(signInPath('/admin')).toBe('/sign-in');
    expect(signInPath('https://evil.example')).toBe('/sign-in');
  });
});

describe('messages', () => {
  it('[ACC-03] every error code the database raises has a line for the admin', () => {
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/20261009020000_admin_auth.sql', import.meta.url),
      'utf8',
    );
    const hints = [...sql.matchAll(/hint = '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(hints.length).toBeGreaterThan(8);
    for (const hint of hints) expect(hintMessage({ hint }), hint).not.toBe(GENERIC);
  });

  it('[ACC-02] unknown errors get the generic line; copy avoids alarm words (06 §2)', () => {
    expect(hintMessage({ hint: 'something_new' })).toBe(GENERIC);
    expect(hintMessage(null)).toBe(GENERIC);
    expect(hintMessage({ code: '22023' })).toMatch(/timezone/);
    for (const hint of ['invite_used', 'setup_code_invalid', 'not_admin']) {
      expect(hintMessage({ hint })).not.toMatch(/failed|wrong|error|!/i);
    }
  });

  it('[ACC-02] account errors map to next steps', () => {
    expect(accountMessage({ code: 'email_exists' })).toMatch(/Sign in/);
    expect(accountMessage({ code: 'weak_password' })).toBe(PASSWORD_RULE);
    expect(accountMessage({ code: 'unexpected_failure' })).toBe(GENERIC);
  });
});

describe('createAccount', () => {
  function fakeAdmin(error: { code: string; status: number } | null = null) {
    const createUser = vi.fn(async () => ({ data: { user: null }, error }));
    return { admin: { auth: { admin: { createUser } } } as unknown as SupabaseClient, createUser };
  }

  it('[ACC-02] creates a confirmed account, so the first sign-in needs no email (D-39)', async () => {
    const { admin, createUser } = fakeAdmin();
    expect(await createAccount(admin, 'pat@example.com', 'long enough')).toBe(null);
    expect(createUser).toHaveBeenCalledWith({
      email: 'pat@example.com',
      password: 'long enough',
      email_confirm: true,
    });
  });

  it('[ACC-02] refuses a short password before calling Supabase', async () => {
    const { admin, createUser } = fakeAdmin();
    expect(await createAccount(admin, 'pat@example.com', 'short')).toBe(PASSWORD_RULE);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('[ACC-02] says to sign in when the email already has an account', async () => {
    const { admin } = fakeAdmin({ code: 'email_exists', status: 422 });
    expect(await createAccount(admin, 'pat@example.com', 'long enough')).toMatch(/Sign in/);
  });
});

describe('requestOrigin', () => {
  it('uses the forwarded host and protocol, else the host', () => {
    expect(
      requestOrigin(
        new Headers({
          'x-forwarded-host': 'family-wise-topaz.vercel.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://family-wise-topaz.vercel.app');
    expect(requestOrigin(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });
});
