'use client';

import { ThemeLock, type Theme } from '@familywise/ui';
import { useMemo, useState } from 'react';
import { boardHealth, type JobHealth } from '@/lib/board-health';
import { openBoardStore } from '@/lib/board-store';
import { day, isoDay, time } from '@/lib/format';
import { HealthLines } from '../../(board)/board/health-lines';
import { useMinute } from '../../(board)/board/use-minute';
import { useOnline } from '../../(board)/board/use-online';
import { type QueueState, Today } from '../../(board)/board/today';
import { fixturePin, fixturePost, fixtureSnapshot, TZ } from './fixture';

/**
 * The board's Today with a made-up family and a stand-in for the server (WP-11 UI suite). Like a
 * board, it keeps its outbox and what it shows ahead of the snapshot in IndexedDB (its own
 * database), and says when it is offline or its data is old (WP-13): `stale` makes the snapshot
 * 12 minutes old, `jobs` makes a job behind.
 */
export function DevBoard({ theme, stale, jobs }: { theme: Theme; stale: boolean; jobs: boolean }) {
  // The family is made once, as of when the page opened; the clock ticks on like a board's.
  const [opened] = useState(() => new Date());
  const now = useMinute();
  const snapshot = useMemo(() => {
    const s = fixtureSnapshot(isoDay(TZ, opened), opened);
    return stale ? { ...s, fetchedAt: new Date(opened.getTime() - 12 * 60_000).toISOString() } : s;
  }, [opened, stale]);
  const post = useMemo(() => fixturePost(snapshot), [snapshot]);
  const pinWish = useMemo(() => fixturePin(snapshot), [snapshot]);
  const [store] = useState(() =>
    typeof window === 'undefined'
      ? null
      : openBoardStore(snapshot.device.id, 'familywise-dev-board'),
  );
  const [queue, setQueue] = useState<QueueState>({ pending: 0, waiting: false });
  const online = useOnline();
  const behind: JobHealth[] = jobs ? [{ job_type: 'occurrence_gen', state: 'failing' }] : [];
  const health = boardHealth({
    fetchedAt: snapshot.fetchedAt,
    now,
    offline: !online || queue.waiting,
    jobs: behind,
  });
  return (
    <main className="fw-board">
      <ThemeLock theme={theme} />
      <header className="fw-board__bar">
        <div className="fw-board__title">
          <h1>{snapshot.household.name}</h1>
          <p className="fw-board__date">{day(now, TZ)}</p>
        </div>
        <div className="fw-board__status">
          <time className="fw-board__clock" dateTime={now.toISOString()}>
            {time(now, TZ)}
          </time>
          <HealthLines offline={health.offline} stale={health.stale} />
        </div>
      </header>
      <Today
        snapshot={snapshot}
        now={now}
        post={post}
        store={store}
        onQueue={setQueue}
        pinWish={pinWish}
      />
      <footer className="fw-board__foot">{snapshot.device.name}</footer>
    </main>
  );
}
