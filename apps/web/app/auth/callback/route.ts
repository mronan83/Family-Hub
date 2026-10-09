import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/next';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

/**
 * [ACC-02] Where magic links and password-reset links land: trades the one-time code for a session
 * (PKCE, so the link works only in the browser that asked for it) and goes on to `next`.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const db = await serverClient();
  if (code && db) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    log('warn', 'sign-in link not accepted', { code: error.code, status: error.status });
  }
  return NextResponse.redirect(new URL('/sign-in?error=link', request.nextUrl.origin));
}
