'use client';

import { BoardThemeController, Icon } from '@familywise/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { boardHealth, type JobHealth, laterSnapshot } from '@/lib/board-health';
import { type BoardStore, openBoardStore } from '@/lib/board-store';
import { day, isoDay, time } from '@/lib/format';
import { boardTables, coalesce } from '@/lib/live';
import { postCompletions } from '@/lib/outbox';
import { readSnapshot, type BoardSnapshot } from '@/lib/snapshot';
import { browserClient } from '@/lib/supabase/browser';
import { HealthLines } from './health-lines';
import { type QueueState, Today } from './today';
import { useMinute } from './use-minute';
import { useHydrated, useOnline } from './use-online';

type Link = 'connecting' | 'live' | 'offline';

/** How often an open board reports in (the database keeps one write a minute at most). */
const HEARTBEAT_MS = 5 * 60_000;
/**
 * [DEV-08] How often a board reads again with nothing heard: a quiet household's snapshot stays
 * under five minutes old, and a change Realtime missed is picked up. It also reads job health.
 */
const REFRESH_MS = 4 * 60_000;

/**
 * [DEV-05] Notify, then refetch (01 §7): Realtime says that a board-readable row changed, and the
 * board reads its snapshot again, straight from the database with its own session (no server
 * round trip). It also reads again whenever Realtime (re)connects or the network returns, so
 * nothing changed while it was away is missed. RLS applies to both, so a disconnected board hears
 * nothing and reads nothing; when it finds that out, the server takes it to the pairing screen.
 */
function useLiveSnapshot(initial: BoardSnapshot, appVersion: string, store: BoardStore | null) {
  const [snapshot, setSnapshot] = useState(initial);
  const [link, setLink] = useState<Link>('connecting');
  const [jobs, setJobs] = useState<JobHealth[]>([]);
  // [NFR-01] The saved snapshot is read back before this one is saved over it.
  const [restored, setRestored] = useState(!store);
  // Changes heard, shown as data-events for e2e (a disconnected board must hear none).
  const [events, setEvents] = useState(0);
  // Read again on demand (a new day), through the same coalesced read.
  const refresh = useRef<() => void>(() => undefined);
  const householdId = initial.household.id;
  const deviceId = initial.device.id;

  // [NFR-01] A page from the service worker's cache carries the snapshot of its day; a later one
  // this board saved shows instead. Each snapshot read is saved for the next start.
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void store.get('snapshot').then((saved) => {
      if (cancelled) return;
      setSnapshot((current) => laterSnapshot(current, saved));
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);
  useEffect(() => {
    if (store && restored) void store.set('snapshot', snapshot);
  }, [store, restored, snapshot]);

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
    refresh.current = () => void reload();
    // [DEV-08] The jobs that keep today's list right, as this board may see them (job_run's RLS).
    const readJobs = async () => {
      const { data, error } = await db.rpc('job_health', { p_household_id: householdId });
      if (!cancelled && !error && Array.isArray(data)) setJobs(data as JobHealth[]);
    };
    void readJobs();

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
    const again = setInterval(() => {
      void reload();
      void readJobs();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearInterval(again);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      auth.subscription.unsubscribe();
      void db.removeChannel(channel);
    };
  }, [householdId, deviceId, appVersion]);

  const again = useCallback(() => refresh.current(), []);
  return { snapshot, link, jobs, events, refresh: again };
}

function LiveStatus({ link, events }: { link: Link; events: number }) {
  return (
    <span className="fw-live" role="status" data-link={link} data-events={events}>
      <Icon name={link === 'offline' ? 'wifi-off' : 'wifi'} size={28} />
      {link === 'live' ? 'Live' : link === 'offline' ? 'Reconnecting…' : 'Connecting…'}
    </span>
  );
}

/** [DEV-05][BRD-01] The board: household, date and time, connection, and the family's Today. */
export function Board({ initial, appVersion }: { initial: BoardSnapshot; appVersion: string }) {
  // [DEV-06][NFR-01] This board's IndexedDB: its outbox and last snapshot (none on the server).
  const [store] = useState(() =>
    typeof window === 'undefined' ? null : openBoardStore(initial.device.id),
  );
  const { snapshot, link, jobs, events, refresh } = useLiveSnapshot(initial, appVersion, store);
  const [queue, setQueue] = useState<QueueState>({ pending: 0, waiting: false });
  const online = useOnline();
  const hydrated = useHydrated();
  const now = useMinute();
  const health = boardHealth({
    fetchedAt: snapshot.fetchedAt,
    now,
    offline: !online || queue.waiting,
    jobs,
  });
  const { household, device } = snapshot;
  const tz = household.timezone;
  // A new day in the household: read today's items (nothing changed in the database to say so).
  // Checked each minute, so a read that reached the server a moment before its midnight tries again.
  const localDay = isoDay(tz, now);
  useEffect(() => {
    if (localDay !== snapshot.today) refresh();
  }, [now, localDay, snapshot.today, refresh]);

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
          {hydrated ? <HealthLines offline={health.offline} stale={health.stale} /> : null}
        </div>
      </header>
      <Today
        snapshot={snapshot}
        now={now}
        post={postCompletions}
        store={store}
        onQueue={setQueue}
      />
      <footer className="fw-board__foot">{device.name}</footer>
    </main>
  );
}
