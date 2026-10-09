import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { BOARD_CREDENTIAL_COOKIE, decodeCredential } from '@/lib/devices';
import { log } from '@/lib/log';
import { serverClient } from '@/lib/supabase/server';

/**
 * [DEV-02] A board whose session lapsed signs in again with the credential it kept from pairing,
 * unattended. A disconnected board cannot (its sign-in is banned): it forgets the credential and
 * goes back to the pairing screen. `?revoked=1` skips straight to that.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const store = await cookies();
  const credential = decodeCredential(store.get(BOARD_CREDENTIAL_COOKIE)?.value);
  const db = await serverClient();
  const revoked = request.nextUrl.searchParams.get('revoked') === '1';

  if (db && credential && !revoked) {
    const { error } = await db.auth.signInWithPassword(credential);
    if (!error) return NextResponse.redirect(new URL('/board', origin));
    log('warn', 'board could not sign in again', { code: error.code, status: error.status });
  }
  store.delete({ name: BOARD_CREDENTIAL_COOKIE, path: '/board' });
  if (db) await db.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(
    new URL(credential || revoked ? '/board/pair?disconnected=1' : '/board/pair', origin),
  );
}
