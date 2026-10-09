import { Banner, BootSplash } from '@familywise/ui';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/auth/session';
import { boardState } from '@/lib/board';
import { PAIRING_MESSAGES } from '@/lib/devices';
import { serverClient } from '@/lib/supabase/server';
import { PairForm } from './pair-form';

// [DEV-01] First boot, or after a board was disconnected: the boot surface (06 §9) with a keypad
// for the code an admin gets from Boards in the admin app.
export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<{ disconnected?: string }>;
}) {
  const db = await serverClient();
  if (db && (await boardState(db)).kind === 'paired') redirect('/board');
  const admin = db ? await signedIn(db) : null;
  const { disconnected } = await searchParams;

  return (
    <BootSplash message="Pair this board">
      {disconnected ? (
        <Banner kind="notice">
          This board was disconnected. Ask an admin for a new code to pair it again.
        </Banner>
      ) : null}
      {db ? <PairForm adminSignedIn={Boolean(admin)} /> : <p>{PAIRING_MESSAGES.off}</p>}
    </BootSplash>
  );
}
