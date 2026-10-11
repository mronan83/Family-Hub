'use client';

import { BoardThemeController, Icon } from '@familywise/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardHealth, type JobHealth, laterSnapshot } from '@/lib/board-health';
import { type BoardStore, openBoardStore } from '@/lib/board-store';
import { day, isoDay, time } from '@/lib/format';
import { boardTables, coalesce } from '@/lib/live';
import { postCompletions } from '@/lib/outbox';
import { readCalendar, readSnapshot, type BoardCalendar, type BoardSnapshot } from '@/lib/snapshot';
import { browserClient } from '@/lib/supabase/browser';
import { postCelebrated } from '@/lib/board-goals';
import { postAsk, postCancelAsk } from '@/lib/shop';
import { postWish } from '@/lib/wishes';
import { effectiveLayout } from '@/lib/board-layout';
import { HealthLines } from './health-lines';
import type { PhotoUrl } from './picture';
import { type QueueState, Today } from './today';
import { useMinute } from './use-minute';
import { useBarHeight } from './use-bar-height';
import { useHydrated, useOnline } from './use-online';
import { WeatherNow } from './weather';

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

/** How long a signed photo link lasts, and how long before its end the board asks for a new one. */
const PHOTO_LINK_S = 3600;
const PHOTO_RENEW_MS = 10 * 60_000;

/**
 * [PTS-03] Signed links to the shop's and goals' photos (a private bucket the board reads by RLS),
 * asked for together and renewed before they lapse. Offline, or before they arrive, there are none
 * and the board shows icons.
 */
function usePhotos(snapshot: BoardSnapshot): PhotoUrl {
  const paths = useMemo(
    () =>
      [
        ...new Set(
          [...snapshot.shop.map((i) => i.photo), ...snapshot.goals.map((g) => g.photo)].filter(
            (p): p is string => typeof p === 'string',
          ),
        ),
      ].sort(),
    [snapshot.shop, snapshot.goals],
  );
  const key = paths.join('|');
  const [links, setLinks] = useState<{ urls: Map<string, string>; until: number }>({
    urls: new Map(),
    until: 0,
  });
  useEffect(() => {
    const db = browserClient();
    if (!db || !key) return;
    let cancelled = false;
    const wanted = key.split('|');
    const sign = async () => {
      const { data, error } = await db.storage
        .from('rewards')
        .createSignedUrls(wanted, PHOTO_LINK_S);
      if (cancelled || error || !data) return;
      const urls = new Map<string, string>();
      for (const s of data) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      setLinks({ urls, until: Date.now() + PHOTO_LINK_S * 1000 });
    };
    void sign();
    const renew = setInterval(() => void sign(), PHOTO_LINK_S * 1000 - PHOTO_RENEW_MS);
    return () => {
      cancelled = true;
      clearInterval(renew);
    };
  }, [key]);
  return useCallback(
    (path: string) => (links.until > Date.now() ? (links.urls.get(path) ?? null) : null),
    [links],
  );
}

/**
 * [CAL-04] A range of the board's calendar beyond its snapshot's window (WP-23), as this board may
 * see it (RLS); null offline or on an error, so the screen shows what the snapshot has.
 */
async function loadCalendar(from: string, to: string): Promise<BoardCalendar | null> {
  const db = browserClient();
  if (!db) return null;
  const { data, error } = await db.rpc('board_calendar', { p_from: from, p_to: to });
  return error ? null : readCalendar(data);
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
  const photoUrl = usePhotos(snapshot);
  const [queue, setQueue] = useState<QueueState>({ pending: 0, waiting: false });
  const online = useOnline();
  const hydrated = useHydrated();
  const now = useMinute();
  const bar = useRef<HTMLElement>(null);
  useBarHeight(bar);
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
      <header ref={bar} className="fw-board__bar">
        <div className="fw-board__title">
          <h1>{household.name}</h1>
          <p className="fw-board__date" suppressHydrationWarning>
            {day(now, tz)}
          </p>
        </div>
        <div className="fw-board__status">
          <div className="fw-board__now">
            {/* [BRD-04] The weather beside the clock (WP-45), unless the layout turns it off. */}
            {hydrated &&
            effectiveLayout(snapshot.layout.household, snapshot.layout.board).weather ? (
              <WeatherNow weather={snapshot.weather} today={localDay} />
            ) : null}
            <time className="fw-board__clock" dateTime={now.toISOString()} suppressHydrationWarning>
              {time(now, tz)}
            </time>
          </div>
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
        pinWish={postWish}
        ask={postAsk}
        cancelAsk={postCancelAsk}
        markCelebrated={postCelebrated}
        photoUrl={photoUrl}
        loadCalendar={loadCalendar}
      />
      <footer className="fw-board__foot">{device.name}</footer>
    </main>
  );
}
