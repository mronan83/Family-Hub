import { Avatar, type AvatarKey, type MemberColor } from '@familywise/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { boardState } from '@/lib/board';
import { BOARD_CREDENTIAL_COOKIE } from '@/lib/devices';
import { serverClient } from '@/lib/supabase/server';
import { LiveRefresh } from './live';

// [DEV-01][DEV-02] The board for a paired device: its household and family, read through RLS with
// the board's own session, kept live by Realtime. WP-06 replaces this with the board shell.
export default async function BoardHome() {
  const db = await serverClient();
  if (!db) redirect('/board/pair');
  const state = await boardState(db);
  if (state.kind === 'unpaired') {
    // A board whose session lapsed signs in again with its stored credential.
    const credential = (await cookies()).get(BOARD_CREDENTIAL_COOKIE)?.value;
    redirect(credential ? '/board/resume' : '/board/pair');
  }
  if (state.kind === 'revoked') redirect('/board/resume?revoked=1');

  const { device } = state;
  await db.rpc('device_heartbeat', {
    p_app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  });
  const { data } = await db
    .from('member')
    .select('id, display_name, avatar_key, color')
    .is('archived_at', null)
    .order('role', { ascending: false })
    .order('display_name');
  const members = (data ?? []) as {
    id: string;
    display_name: string;
    avatar_key: AvatarKey | null;
    color: MemberColor;
  }[];

  return (
    <main className="fw-board-home">
      <header className="fw-bar">
        <h1>{device.householdName}</h1>
        <span className="fw-actions">
          <span className="fw-muted">{device.name}</span>
          <LiveRefresh householdId={device.householdId} />
        </span>
      </header>
      <ul className="fw-board-members" aria-label="Family">
        {members.map((m) => (
          <li key={m.id}>
            <Avatar
              name={m.display_name}
              avatarKey={m.avatar_key}
              color={m.color}
              size={128}
              decorative
            />
            <span>{m.display_name}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
