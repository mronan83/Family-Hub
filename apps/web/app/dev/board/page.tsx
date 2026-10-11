import type { Theme } from '@familywise/ui';
import type { Metadata } from 'next';
import { CARD_IDS, readLayout } from '@/lib/board-layout';
import { DevBoard } from './dev-board';

// The board's Today with a made-up family and no database (WP-11), for the UI suite: the screen,
// its taps and states, in Day or Evening (?theme=evening); old data (?stale=1) or a job behind
// (?jobs=1) for the board's health lines (WP-13); a goal just reached (?celebrate=1, WP-20); a busy
// month (?busy=1) or a calendar that can't sync (?calbehind=1) on the calendar (WP-23); the home
// screen's layout (WP-35): the calendar's span (?span=3|5|7|month) and the cards shown, in order
// (?cards=goals,coming; the others hidden).
export const metadata: Metadata = { title: 'Board Today', robots: { index: false } };

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    theme?: string;
    stale?: string;
    jobs?: string;
    celebrate?: string;
    busy?: string;
    calbehind?: string;
    span?: string;
    cards?: string;
  }>;
}) {
  const params = await searchParams;
  const theme: Theme = params.theme === 'evening' ? 'evening' : 'day';
  const shown = params.cards?.split(',') ?? [];
  const layout =
    params.span || params.cards
      ? (readLayout({
          ...(params.span ? { calendar: params.span } : {}),
          ...(params.cards
            ? {
                cards: [
                  ...shown.map((id) => ({ id, show: true })),
                  ...CARD_IDS.filter((id) => !shown.includes(id)).map((id) => ({
                    id,
                    show: false,
                  })),
                ],
              }
            : {}),
        }) ?? undefined)
      : undefined;
  // When the server drew this page: the same after a reload means it came from the service worker.
  const rendered = new Date().toISOString();
  return (
    <div className="board" data-rendered={rendered}>
      <DevBoard
        theme={theme}
        stale={params.stale === '1'}
        jobs={params.jobs === '1'}
        celebrate={params.celebrate === '1'}
        busy={params.busy === '1'}
        calBehind={params.calbehind === '1'}
        layout={layout}
      />
    </div>
  );
}
