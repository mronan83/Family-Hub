'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

type Link = 'connecting' | 'live' | 'offline';

/**
 * [DEV-05] Notify, then refetch (01 §7): Realtime only says something changed in this household;
 * the page then reloads its data from the server. Realtime applies RLS with the board's session,
 * so a disconnected board stops hearing anything (SPIKE-01).
 */
export function LiveRefresh({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [link, setLink] = useState<Link>('connecting');

  useEffect(() => {
    const db = browserClient();
    if (!db) return;
    let cancelled = false;
    const channel = db.channel(`board:${householdId}`);
    db.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      const refresh = () => router.refresh();
      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'member',
            filter: `household_id=eq.${householdId}`,
          },
          refresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'household', filter: `id=eq.${householdId}` },
          refresh,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setLink('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
            setLink('offline');
        });
    });
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [householdId, router]);

  return (
    <span className="fw-live" role="status" data-link={link}>
      {link === 'live' ? 'Live' : link === 'offline' ? 'Reconnecting…' : 'Connecting…'}
    </span>
  );
}
