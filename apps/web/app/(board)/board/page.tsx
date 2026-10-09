import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BOARD_CREDENTIAL_COOKIE, isDeviceClaims } from '@/lib/devices';
import { readSnapshot } from '@/lib/snapshot';
import { serverClient } from '@/lib/supabase/server';
import { Board } from './board';

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';

// [DEV-02][DEV-05] The board for a paired device. The server draws the first snapshot (one read,
// through RLS with the board's own session); the board then keeps it live in the browser.
export default async function BoardHome() {
  const db = await serverClient();
  if (!db) redirect('/board/pair');
  const { data } = await db.auth.getClaims();
  if (!isDeviceClaims(data?.claims)) {
    // A board whose session lapsed signs in again with its stored credential.
    const credential = (await cookies()).get(BOARD_CREDENTIAL_COOKIE)?.value;
    redirect(credential ? '/board/resume' : '/board/pair');
  }

  const [snapshot] = await Promise.all([
    db.rpc('board_snapshot'),
    db.rpc('device_heartbeat', { p_app_version: APP_VERSION }),
  ]);
  if (snapshot.error) throw new Error(`board snapshot: ${snapshot.error.message}`);
  const initial = readSnapshot(snapshot.data);
  // A board session with no snapshot was disconnected (RLS shows it nothing).
  if (!initial) redirect('/board/resume?revoked=1');

  return <Board initial={initial} appVersion={APP_VERSION} />;
}
