import { Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import { signedIn } from '@/lib/auth/session';
import { adminClient } from '@/lib/supabase/admin';
import { serverClient } from '@/lib/supabase/server';
import { InviteClient } from './client';

export const metadata: Metadata = { title: 'Your invite', referrer: 'no-referrer' };

// [ACC-03] Invite links look like /invite#<token>. The page reads the token in the browser.
export default async function InvitePage() {
  const db = await serverClient();
  const user = db ? await signedIn(db) : null;
  return (
    <main className="fw-page">
      <Logo lockup="stacked" width={160} />
      <h1>You’re invited</h1>
      <InviteClient
        signedInEmail={user?.email ?? null}
        canCreateAccount={!user && adminClient() !== null}
      />
    </main>
  );
}
