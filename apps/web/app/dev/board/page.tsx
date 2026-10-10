import type { Theme } from '@familywise/ui';
import type { Metadata } from 'next';
import { DevBoard } from './dev-board';

// The board's Today with a made-up family and no database (WP-11), for the UI suite: the screen,
// its taps and states, in Day or Evening (?theme=evening); old data (?stale=1) or a job behind
// (?jobs=1) for the board's health lines (WP-13); a goal just reached (?celebrate=1, WP-20).
export const metadata: Metadata = { title: 'Board Today', robots: { index: false } };

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; stale?: string; jobs?: string; celebrate?: string }>;
}) {
  const params = await searchParams;
  const theme: Theme = params.theme === 'evening' ? 'evening' : 'day';
  // When the server drew this page: the same after a reload means it came from the service worker.
  const rendered = new Date().toISOString();
  return (
    <div className="board" data-rendered={rendered}>
      <DevBoard
        theme={theme}
        stale={params.stale === '1'}
        jobs={params.jobs === '1'}
        celebrate={params.celebrate === '1'}
      />
    </div>
  );
}
