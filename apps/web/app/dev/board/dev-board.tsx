'use client';

import { ThemeLock, type Theme } from '@familywise/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { boardHealth, type JobHealth } from '@/lib/board-health';
import { openBoardStore } from '@/lib/board-store';
import { day, isoDay, time } from '@/lib/format';
import { HealthLines } from '../../(board)/board/health-lines';
import { useMinute } from '../../(board)/board/use-minute';
import { useBarHeight } from '../../(board)/board/use-bar-height';
import { useOnline } from '../../(board)/board/use-online';
import { type QueueState, Today } from '../../(board)/board/today';
import type { BoardCalendar } from '@/lib/snapshot';
import type { BoardLayout } from '@/lib/board-layout';
import {
  fixtureAsk,
  fixtureCalendar,
  fixtureCancel,
  fixtureMark,
  fixturePin,
  fixturePost,
  fixtureSnapshot,
  reachedBike,
  TZ,
} from './fixture';

/**
 * The board's Today with a made-up family and a stand-in for the server (WP-11 UI suite). Like a
 * board, it keeps its outbox and what it shows ahead of the snapshot in IndexedDB (its own
 * database), and says when it is offline or its data is old (WP-13): `stale` makes the snapshot
 * 12 minutes old, `jobs` makes a job behind. Asking for a reward, calling it off and celebrating a
 * goal change the snapshot a moment later, as Realtime would (WP-20); `celebrate` opens on Leo
 * reaching their goal. The calendar (WP-23) reads any range from the made-up family's calendars;
 * `busy` adds 40 events this month, `calBehind` makes School's sync fail three hours ago.
 */
export function DevBoard({
  theme,
  stale,
  jobs,
  celebrate,
  busy = false,
  calBehind = false,
  layout,
}: {
  theme: Theme;
  stale: boolean;
  jobs: boolean;
  celebrate: boolean;
  busy?: boolean;
  calBehind?: boolean;
  /** [BRD-05] The household's home screen layout (WP-35); the defaults without one. */
  layout?: BoardLayout;
}) {
  // The family is made once, as of when the page opened; the clock ticks on like a board's.
  const [opened] = useState(() => new Date());
  const now = useMinute();
  const bar = useRef<HTMLElement>(null);
  useBarHeight(bar);
  // A School sync that failed three hours ago, when asked for.
  const withSchool = useCallback(
    (cal: BoardCalendar): BoardCalendar =>
      calBehind
        ? {
            ...cal,
            calendars: cal.calendars.map((c) =>
              c.id === 'cal-school'
                ? {
                    ...c,
                    status: 'error' as const,
                    lastSuccessAt: new Date(opened.getTime() - 3 * 3_600_000).toISOString(),
                  }
                : c,
            ),
          }
        : cal,
    [calBehind, opened],
  );
  const [snapshot, setSnapshot] = useState(() => {
    let s = fixtureSnapshot(isoDay(TZ, opened), opened, layout);
    if (busy || calBehind) {
      s = {
        ...s,
        calendar: withSchool(fixtureCalendar(s.today, opened, s.range.from, s.range.to, busy)),
      };
    }
    if (stale) s = { ...s, fetchedAt: new Date(opened.getTime() - 12 * 60_000).toISOString() };
    return celebrate ? reachedBike(s, opened) : s;
  });
  const post = useMemo(() => fixturePost(snapshot), [snapshot]);
  // As board_calendar() would answer, a moment later (offline: nothing).
  const loadCalendar = useCallback(
    async (from: string, to: string) => {
      if (!navigator.onLine) return null;
      await new Promise((r) => setTimeout(r, 30));
      return withSchool(fixtureCalendar(snapshot.today, opened, from, to, busy));
    },
    [snapshot.today, opened, busy, withSchool],
  );
  const pinWish = useMemo(() => fixturePin(snapshot), [snapshot]);
  const ask = useMemo(() => fixtureAsk(snapshot, setSnapshot), [snapshot]);
  const [cancelAsk] = useState(() => fixtureCancel(setSnapshot));
  const [markCelebrated] = useState(() => fixtureMark(setSnapshot));
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
      <header ref={bar} className="fw-board__bar">
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
        ask={ask}
        cancelAsk={cancelAsk}
        markCelebrated={markCelebrated}
        loadCalendar={loadCalendar}
      />
      <footer className="fw-board__foot">{snapshot.device.name}</footer>
    </main>
  );
}
