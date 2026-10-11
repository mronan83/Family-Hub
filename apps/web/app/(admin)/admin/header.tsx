import { Icon } from '@familywise/ui';
import Link from 'next/link';
import { navCurrent, SETTINGS_HREF, settingsPage } from '@/lib/admin-nav';
import { signedIn } from '@/lib/auth/session';
import { serverClient } from '@/lib/supabase/server';
import { AdminNav, type NavWho } from './nav';

/**
 * Who is signed in and how many check-offs wait for a parent, through RLS; none without a session
 * (a dev page, or the project settings missing).
 */
async function headerFacts(): Promise<{ waiting: number; who: NavWho | null }> {
  const db = await serverClient();
  const user = db ? await signedIn(db) : null;
  if (!db || !user) return { waiting: 0, who: null };
  const [me, waiting] = await Promise.all([
    db
      .from('member')
      .select('display_name, avatar_key, color')
      .eq('user_id', user.userId)
      .is('archived_at', null)
      .maybeSingle(),
    db
      .from('chore_occurrence')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval'),
  ]);
  const m = me.data as {
    display_name: string;
    avatar_key: NavWho['avatarKey'];
    color: NavWho['color'];
  } | null;
  return {
    waiting: waiting.count ?? 0,
    who: m ? { name: m.display_name, avatarKey: m.avatar_key, color: m.color } : null,
  };
}

/**
 * [NFR-15][US-107] The admin app's menu (WP-51, D-81) and, on a page Settings holds, the way back to
 * Settings. `current` is the page you are on. A dev page gives `waiting` and `who` itself.
 */
export async function AdminHeader({
  current,
  waiting,
  who,
}: {
  current: string;
  waiting?: number;
  who?: NavWho | null;
}) {
  const facts = waiting === undefined ? await headerFacts() : { waiting, who: who ?? null };
  const back = settingsPage(current);
  return (
    <>
      <AdminNav current={navCurrent(current)} waiting={facts.waiting} who={facts.who} />
      {back ? (
        <Link href={SETTINGS_HREF} className="fw-crumb">
          <Icon name="chevron-left" size={18} />
          Settings
        </Link>
      ) : null}
    </>
  );
}
