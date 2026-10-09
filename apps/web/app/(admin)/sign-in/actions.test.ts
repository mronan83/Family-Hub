import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_SENT, SIGN_IN_FAILED } from '@/lib/auth/messages';

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

const auth = {
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
};

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      'x-forwarded-host': 'family-wise-topaz.vercel.app',
      'x-forwarded-proto': 'https',
    }),
}));
vi.mock('@/lib/supabase/server', () => ({ serverClient: async () => ({ auth }) }));
vi.spyOn(console, 'log').mockImplementation(() => {});

const { demoSignIn, sendMagicLink, signInWithPassword } = await import('./actions');

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  return '';
}

beforeEach(() => {
  vi.unstubAllEnvs();
  auth.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe('sign-in actions', () => {
  it('[ACC-02] a magic link never creates an account and comes back through /auth/callback', async () => {
    const state = await sendMagicLink({}, form({ email: ' Pat@Example.com ', next: '/invite' }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'pat@example.com',
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'https://family-wise-topaz.vercel.app/auth/callback?next=%2Finvite',
      },
    });
    expect(state).toEqual({ sent: true, message: LINK_SENT });
  });

  it('[ACC-02] a magic link request reads the same whether or not the account exists', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
    });
    expect(await sendMagicLink({}, form({ email: 'nobody@example.com' }))).toEqual({
      sent: true,
      message: LINK_SENT,
    });
  });

  it('[ACC-02] a refused password gets one neutral line', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    expect(await signInWithPassword({}, form({ email: 'a@b.co', password: 'x' }))).toEqual({
      message: SIGN_IN_FAILED,
    });
  });

  it('[ACC-02] a good password goes to a safe next only', async () => {
    expect(
      await redirectOf(
        signInWithPassword({}, form({ email: 'a@b.co', password: 'x', next: '//evil.example' })),
      ),
    ).toBe('/admin');
  });

  it('[ACC-02] demo sign-in does nothing outside a preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'test-secret');
    expect(await redirectOf(demoSignIn(form({ persona: 'alex' })))).toBe('/sign-in');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('[ACC-02] demo sign-in on a preview uses the derived password, for personas only', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'test-secret');
    expect(await redirectOf(demoSignIn(form({ persona: 'parent@example.com' })))).toBe('/sign-in');
    expect(await redirectOf(demoSignIn(form({ persona: 'alex' })))).toBe('/admin');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'alex@demo.familywise.invalid',
      password: '045626f96e2913b275eee7347abe26d196002e0fec0d237641b91979c093c14d',
    });
  });
});
