'use client';

import { Avatar, BoardThemeController, Icon } from '@familywise/ui';
import { useEffect, useState } from 'react';
import { day, time } from '@/lib/format';
import { boardTables, coalesce, untilNextMinute } from '@/lib/live';
import { readSnapshot, type BoardSnapshot } from '@/lib/snapshot';
import { browserClient } from '@/lib/supabase/browser';

type Link = 'connecting' | 'live' | 'offline';

/** How often an open board reports in (the database keeps one write a minute at most). */
const HEARTBEAT_MS = 5 * 60_000;

/**
 * [DEV-05] Notify, then refetch (01 §7): Realtime says that a board-readable row changed, and the
 * board reads its snapshot again, straight from the database with its own session (no server
 * round trip). It also reads again whenever Realtime (re)connects or the network returns, so
 * nothing changed while it was away is missed. RLS applies to both, so a disconnected board hears
 * nothing and reads nothing; when it finds that out, the server takes it to the pairing screen.
 */
function useLiveSnapshot(initial: BoardSnapshot, appVersion: string) {
  const [snapshot, setSnapshot] = useState(initial);
  const [link, setLink] = useState<Link>('connecting');
  // Changes heard, shown as data-events for e2e (a disconnected board must hear none).
  const [events, setEvents] = useState(0);
  const householdId = initial.household.id;
  const deviceId = initial.device.id;

  useEffect(() => {
    const db = browserClient();
    if (!db) return;
    let cancelled = false;
    const leave = () => window.location.assign('/board');

    const reload = coalesce(async () => {
      const { data, error } = await db.rpc('board_snapshot');
      if (cancelled) return;
      // Offline or a passing error: keep what is on screen; the next change or reconnect reads again.
      if (error) return;
      const next = readSnapshot(data);
      if (next) setSnapshot(next);
      else leave();
    });

    // `wait`: report SUBSCRIBED only once the server streams changes. By default it reports on
    // joining, before the replication stream is up after a quiet spell, and a change made in that
    // gap would be lost after the catch-up read had already run.
    const channel = db.channel(`board:${householdId}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    void db.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      // Join with the board's token, so Realtime applies RLS as this board.
      if (data.session) db.realtime.setAuth(data.session.access_token);
      for (const { table, filter } of boardTables(householdId, deviceId)) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
          setEvents((n) => n + 1);
          void reload();
        });
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLink('live');
          // Changes stream from here on; catch up on anything changed while connecting or
          // disconnected (the first connection after a quiet spell takes seconds, SPIKE-01).
          void reload();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLink('offline');
        }
      });
    });

    // The board's sign-in ended (disconnected, or its session was lost): the server decides next.
    const { data: auth } = db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') leave();
    });
    const online = () => {
      // The socket may have survived the drop; if it did not, Realtime reconnects on its own.
      if (channel.state === 'joined') setLink('live');
      void reload();
    };
    const offline = () => setLink('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    const heartbeat = setInterval(() => {
      void db.rpc('device_heartbeat', { p_app_version: appVersion });
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      auth.subscription.unsubscribe();
      void db.removeChannel(channel);
    };
  }, [householdId, deviceId, appVersion]);

  return { snapshot, link, events };
}

/** The current minute, ticking on the minute. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = new Date();
      setNow(at);
      timer = setTimeout(tick, untilNextMinute(at));
    };
    timer = setTimeout(tick, untilNextMinute(new Date()));
    return () => clearTimeout(timer);
  }, []);
  return now;
}

function LiveStatus({ link, events }: { link: Link; events: number }) {
  return (
    <span className="fw-live" role="status" data-link={link} data-events={events}>
      <Icon name={link === 'offline' ? 'wifi-off' : 'wifi'} size={28} />
      {link === 'live' ? 'Live' : link === 'offline' ? 'Reconnecting…' : 'Connecting…'}
    </span>
  );
}

/** [DEV-05] The board shell: household, date and time, connection, and the family. */
export function Board({ initial, appVersion }: { initial: BoardSnapshot; appVersion: string }) {
  const { snapshot, link, events } = useLiveSnapshot(initial, appVersion);
  const now = useMinute();
  const { household, device, members } = snapshot;
  const tz = household.timezone;

  return (
    <main className="fw-board" data-fetched-at={snapshot.fetchedAt}>
      <BoardThemeController timeZone={tz} override={device.theme} />
      <header className="fw-board__bar">
        <div className="fw-board__title">
          <h1>{household.name}</h1>
          <p className="fw-board__date" suppressHydrationWarning>
            {day(now, tz)}
          </p>
        </div>
        <div className="fw-board__status">
          <time className="fw-board__clock" dateTime={now.toISOString()} suppressHydrationWarning>
            {time(now, tz)}
          </time>
          <LiveStatus link={link} events={events} />
        </div>
      </header>
      <ul className="fw-board-members" aria-label="Family">
        {members.map((m) => (
          <li key={m.id}>
            <Avatar
              name={m.displayName}
              avatarKey={m.avatarKey}
              color={m.color}
              size={128}
              decorative
            />
            <span className="fw-board-members__name">{m.displayName}</span>
          </li>
        ))}
      </ul>
      <footer className="fw-board__foot">{device.name}</footer>
    </main>
  );
}
