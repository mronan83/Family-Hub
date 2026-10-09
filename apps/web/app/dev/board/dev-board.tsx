'use client';

import { ThemeLock, type Theme } from '@familywise/ui';
import { useMemo, useState } from 'react';
import { day, isoDay, time } from '@/lib/format';
import { Today } from '../../(board)/board/today';
import { fixturePost, fixtureSnapshot, TZ } from './fixture';

/** The board's Today with a made-up family and a stand-in for the server (WP-11 UI suite). */
export function DevBoard({ theme }: { theme: Theme }) {
  const [now] = useState(() => new Date());
  const snapshot = useMemo(() => fixtureSnapshot(isoDay(TZ, now), now), [now]);
  const post = useMemo(() => fixturePost(snapshot), [snapshot]);
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
        </div>
      </header>
      <Today snapshot={snapshot} now={now} post={post} />
      <footer className="fw-board__foot">{snapshot.device.name}</footer>
    </main>
  );
}
